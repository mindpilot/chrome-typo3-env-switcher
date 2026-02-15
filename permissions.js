/**
 * permissions.js — Shared permission utilities for dynamic host permissions.
 *
 * Used by service-worker.js (importScripts) and settings.js (script tag).
 * Converts configured environments to Chrome origin patterns, requests/removes
 * host permissions, and registers content scripts dynamically.
 */

const Permissions = {

  /**
   * Build deduplicated origin patterns from configured environments.
   * E.g. "dev.myproject" + "local" → "*://dev.myproject.local/*"
   *
   * @param {object} settingsJson - The stored settings object with .projects[]
   * @returns {string[]} Array of unique origin patterns
   */
  buildOriginPatterns(settingsJson) {
    const patterns = new Set();
    if (!settingsJson?.projects) return [];

    for (const project of settingsJson.projects) {
      if (!project.environments) continue;
      for (const env of project.environments) {
        if (env.domain && env.tld) {
          patterns.add(`*://${env.domain}.${env.tld}/*`);
        }
      }
    }
    return [...patterns];
  },

  /**
   * Request missing host permissions and remove stale ones.
   * Must be called from a user-gesture context (click handler, etc.).
   *
   * @param {object} settingsJson - The stored settings object
   * @returns {Promise<{granted: string[], removed: string[], failed: string[]}>}
   */
  async syncPermissions(settingsJson) {
    const needed = this.buildOriginPatterns(settingsJson);
    const current = await chrome.permissions.getAll();
    const currentOrigins = current.origins || [];

    // Determine what to add and what to remove
    const toAdd = needed.filter(p => !currentOrigins.includes(p));
    const toRemove = currentOrigins.filter(p => !needed.includes(p));

    const result = { granted: [], removed: [], failed: [] };

    // Request new permissions (batched in one prompt)
    if (toAdd.length > 0) {
      try {
        const wasGranted = await chrome.permissions.request({ origins: toAdd });
        if (wasGranted) {
          result.granted = toAdd;
        } else {
          result.failed = toAdd;
        }
      } catch (e) {
        console.warn('[EnvSwitcher] Permission request failed:', e);
        result.failed = toAdd;
      }
    }

    // Remove stale permissions
    if (toRemove.length > 0) {
      try {
        await chrome.permissions.remove({ origins: toRemove });
        result.removed = toRemove;
      } catch (e) {
        console.warn('[EnvSwitcher] Permission removal failed:', e);
      }
    }

    return result;
  },

  /**
   * Unregister all dynamic content scripts, then re-register for
   * currently granted host origins.
   */
  async syncContentScripts() {
    // Unregister existing dynamic scripts
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts();
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({
          ids: existing.map(s => s.id)
        });
      }
    } catch (e) {
      // Ignore — may have none registered
    }

    // Get currently granted origins
    const perms = await chrome.permissions.getAll();
    const origins = perms.origins || [];

    if (origins.length === 0) return;

    // Register content.js for granted origins
    try {
      await chrome.scripting.registerContentScripts([{
        id: 'env-switcher-content',
        matches: origins,
        js: ['content.js'],
        runAt: 'document_idle'
      }]);
    } catch (e) {
      console.warn('[EnvSwitcher] Failed to register content scripts:', e);
    }

    // Inject into already-open tabs matching the granted origins
    try {
      const tabs = await chrome.tabs.query({ url: origins });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
        } catch (e) { /* tab may not be scriptable */ }
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * Revoke all currently granted host origins.
   * Used when the color badge feature is toggled off.
   */
  async revokeAllHostPermissions() {
    const current = await chrome.permissions.getAll();
    const origins = current.origins || [];
    if (origins.length > 0) {
      await chrome.permissions.remove({ origins });
    }
  },

  /**
   * Check if a specific origin has been granted permission.
   * @param {string} hostname - e.g. "dev.myproject.local"
   * @returns {Promise<boolean>}
   */
  async hasHostPermission(hostname) {
    try {
      return await chrome.permissions.contains({
        origins: [`*://${hostname}/*`]
      });
    } catch {
      return false;
    }
  }
};

// Make available in service worker context (importScripts) and page context
if (typeof self !== 'undefined') {
  self.Permissions = Permissions;
}
