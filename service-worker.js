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

// load project settings
chrome.storage.sync.get(['settingsJson'], (result) => {
  Env.settingsJson = result.settingsJson;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SET_UID") {
    currentUid = request.uid;
    // Current UID set to: currentUid
    chrome.action.setBadgeText({ text: request.uid });
    chrome.action.setBadgeTextColor({ color: "white" }); // Set badge text color to white
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    sendResponse({ status: "success" });
  }
  else if (request.type === "CLEAR_UID") {
    currentUid = null;
    // Current UID cleared
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ status: "success" });
  }
  else if (request.type === "GET_UID") {
    // Sending current UID
    sendResponse({ uid: currentUid });
  }
  else if (request.type === "SAVE_DOMAIN_CONFIG") {
    const data = request.data;
    chrome.storage.sync.set({ settingsJson: data }, () => {
      // Projects configuration saved;
      sendResponse({ status: "success" });
    });
    return true; // Indicates async response
  }
  else if (request.type === "GET_DOMAIN_CONFIG") {
    chrome.storage.sync.get(['settingsJson'], (result) => {
      // Test domain configuration retrieved;
      Env.settingsJson = result.settingsJson;
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
      //console.log('Project configuration retrieved:', settingsJson);
      sendResponse({ settingsJson });
    });
    return true; // Indicates async response
  }
  else if (request.type === "GET_COLOR_BADGE_INFO") {
    chrome.storage.sync.get(['showColorBadge', 'settingsJson'], (result) => {
      const showBadge = result.showColorBadge || false;
      // [EnvSwitcher] GET_COLOR_BADGE_INFO - showBadge
      if (!showBadge) {
        sendResponse({ showBadge: false, reason: 'setting disabled' });
        return;
      }

      // Get the sender tab URL to detect environment
      const tabUrl = sender.tab?.url;
      // [EnvSwitcher] Tab URL: tabUrl;
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
        // [EnvSwitcher] Checking hostname: url.hostname
        for (const project of settingsJson.projects) {
          for (const env of project.environments) {
            const expectedHost = env.domain + '.' + env.tld;
            // [EnvSwitcher] Comparing with: expectedHost
            if (url.hostname.endsWith(expectedHost)) {
              // [EnvSwitcher] Match found! Color: env.color
              sendResponse({
                showBadge: true,
                color: env.color || '#ffffff'
              });
              return;
            }
          }
        }
      } catch (e) {
        console.log('[EnvSwitcher] Error parsing URL:', e);
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
      //'Unknown message type: request.type
      sendResponse({status: "error", message: "Unknown message type"});
  }
});

let Env = {
  settingsJson: [],

  detectEnvironment: function (tab) {
    if(tab.url === undefined || tab.url === '') {
      // tab.url is null/empty: tab
      return false ;
    }
    // no action on chrome internal pages
    if (tab.url.indexOf('chrome://') !== -1) {
        // chrome://: tab.url
        return false;
    }
    // no action on new tab page
    if (tab.url.indexOf('chrome://new-tab-page') !== -1) {
        return false ;
    }

    // Auto detect project setting for current page
    const url = new URL(tab.url);

    for (let i= 0; i < Env.settingsJson.projects.length; i++) {
      const proj = Env.settingsJson.projects[i];
      for (let indexEnv= 0; indexEnv < proj.environments.length; indexEnv++) {
        let environment = proj.environments[indexEnv];
        if (url.hostname.endsWith(environment.domain + '.' + environment.tld)) {
          return environment;
        }
      }
    }
  }
};
