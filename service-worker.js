importScripts('permissions.js');

let currentUid = null;

chrome.runtime.onInstalled.addListener(async (details) => {
  // On install or update, sync content scripts for granted origins
  const result = await chrome.storage.sync.get(['settingsJson']);
  const settingsJson = result.settingsJson;

  if (details.reason === 'update' && settingsJson) {
    // Migration: if upgrading from old version that had <all_urls>,
    // narrow permissions to only configured hosts
    const current = await chrome.permissions.getAll();
    const hasAllUrls = (current.origins || []).some(
      o => o === '<all_urls>' || o === '*://*/*'
    );
    if (hasAllUrls) {
      const needed = Permissions.buildOriginPatterns(settingsJson);
      // Remove the blanket permission
      try {
        await chrome.permissions.remove({ origins: ['<all_urls>', '*://*/*'] });
      } catch (e) { /* may not exist */ }
      // Re-request only what's needed (non-interactive in service worker,
      // but origins previously granted stay granted after narrowing)
      if (needed.length > 0) {
        try {
          await chrome.permissions.request({ origins: needed });
        } catch (e) { /* expected in non-interactive context */ }
      }
    }
  }

  await Permissions.syncContentScripts();
});

// Re-sync content scripts whenever permissions change
chrome.permissions.onAdded.addListener(() => Permissions.syncContentScripts());
chrome.permissions.onRemoved.addListener(() => Permissions.syncContentScripts());

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SET_UID") {
    currentUid = request.uid;
    chrome.action.setBadgeText({ text: request.uid });
    chrome.action.setBadgeTextColor({ color: "white" }); // Set badge text color to white
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    sendResponse({ status: "success" });
  }
  else if (request.type === "CLEAR_UID") {
    currentUid = null;
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ status: "success" });
  }
  else if (request.type === "GET_UID") {
    sendResponse({ uid: currentUid });
  }
  else if (request.type === "SAVE_DOMAIN_CONFIG") {
    const data = request.data;
    chrome.storage.sync.set({ settingsJson: data }, () => {
      sendResponse({ status: "success" });
    });
    return true; // Indicates async response
  }
  else if (request.type === "GET_DOMAIN_CONFIG") {
    chrome.storage.sync.get(['settingsJson'], (result) => {
      const settingsJson = result.settingsJson || {
        "selectedProjectIndex": 0,
        "projects": [
          {
            "name": "Project 1",
            "color": "#ffffff",
            "environments": [
            ]
          }
        ]
      };
      sendResponse({ settingsJson });
    });
    return true; // Indicates async response
  }
  else if (request.type === "GET_COLOR_BADGE_INFO") {
    chrome.storage.sync.get(['showColorBadge', 'settingsJson'], (result) => {
      const showBadge = result.showColorBadge || false;
      if (!showBadge) {
        sendResponse({ showBadge: false, reason: 'setting disabled' });
        return;
      }

      // Get the sender tab URL to detect environment
      const tabUrl = sender.tab?.url;
      if (!tabUrl) {
        sendResponse({ showBadge: false, reason: 'no tab url' });
        return;
      }

      const settingsJson = result.settingsJson;
      if (!settingsJson || !settingsJson.projects) {
        sendResponse({ showBadge: false, reason: 'no settings' });
        return;
      }

      // Find matching environment
      try {
        const url = new URL(tabUrl);
        for (const project of settingsJson.projects) {
          for (const env of project.environments) {
            const expectedHost = env.domain + '.' + env.tld;
            if (url.hostname.endsWith(expectedHost)) {
              sendResponse({
                showBadge: true,
                color: env.color || '#ffffff'
              });
              return;
            }
          }
        }
      } catch (e) {
        console.error('[EnvSwitcher] Error parsing URL:', e);
      }

      sendResponse({ showBadge: false, reason: 'no matching environment' });
    });
    return true; // Indicates async response
  }
  else if (request.type === "SYNC_CONTENT_SCRIPTS") {
    Permissions.syncContentScripts().then(() => {
      sendResponse({ status: "success" });
    });
    return true; // Indicates async response
  }
  else {
    sendResponse({status: "error", message: "Unknown message type"});
  }
});
