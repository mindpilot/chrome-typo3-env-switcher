
function extractAndSendUid() {
  let uid = document.body.getAttribute("data-uid");

  if (!uid) {
    // If UID is not found in the body, try to get it from the head
    uid = document.head.getAttribute("data-uid");
  }
  if (!uid) {
    // page.meta.pageID.data = TSFE:id
    uid = document.querySelector("meta[name=pageid]")?.getAttribute("content");
  }
  if (!uid) {
    // lets see, if whe're in an appropriate backend module
    const url = new URL(document.location.href);
    if (
        url.pathname.includes("/typo3/module/web/layout") ||
        url.pathname.includes("/typo3/module/web/list") ||
        url.pathname.includes("/typo3/module/web/viewpage")
    ) {
      uid = url.searchParams.get('id');
    } else if (url.pathname.includes("/typo3/main")) {
      // TYPO3 v12+ routing: /typo3/main?redirect=web_layout&redirectParams=id%3D19833
      const redirectParams = url.searchParams.get('redirectParams');
      if (redirectParams) {
        const match = redirectParams.match(/(?:^|&)id=(\d+)/);
        if (match) {
          uid = match[1];
        }
      }
    }
  }

  if (!chrome.runtime?.id) return; // Extension context invalidated (e.g. after reload)

  if (uid) {
    chrome.runtime.sendMessage({ type: "SET_UID", uid: uid });
  } else {
    chrome.runtime.sendMessage({ type: "CLEAR_UID" });
  }
}

function handleDOMContentLoaded() {
  extractAndSendUid();
  // Handle color badge overlay
  overlayColorBadge();
}

function overlayColorBadge() {
  // Check if badge already exists
  if (document.getElementById('env-switcher-color-badge')) {
    return;
  }

  if (!chrome.runtime?.id) return;
  chrome.runtime.sendMessage({ type: "GET_COLOR_BADGE_INFO" }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }

    if (!response || !response.showBadge || !response.color) {
      return;
    }

    const color = response.color.toLowerCase();
    // Don't show badge if color is white
    if (color === '#ffffff' || color === '#fff' || color === 'white') {
      return;
    }

    // create the color badge
    createColorBadge(response.color);
  });
}

function createColorBadge(color) {
  const badge = document.createElement('div');
  badge.id = 'env-switcher-color-badge';
  badge.style.position = 'fixed';
  badge.style.top = '0';
  badge.style.left = '0';
  badge.style.width = '0';
  badge.style.height = '0';
  badge.style.borderStyle = 'solid';
  badge.style.borderWidth = '40px 40px 0 0';
  badge.style.borderColor = color + ' transparent transparent transparent';
  badge.style.zIndex = '2147483647';
  badge.style.pointerEvents = 'none';
  document.body.appendChild(badge);
}

if (!window.__envSwitcherLoaded) {
  window.__envSwitcherLoaded = true;

  // Listen for storage changes to update badge in real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!chrome.runtime?.id) return;
    if (areaName !== 'sync') return;

    if (changes.showColorBadge) {
      const existingBadge = document.getElementById('env-switcher-color-badge');
      if (changes.showColorBadge.newValue === false && existingBadge) {
        existingBadge.remove();
      } else if (changes.showColorBadge.newValue === true) {
        overlayColorBadge();
      }
    }

    // Re-render badge when environments change (color edits, add/remove)
    if (changes.settingsJson) {
      const existingBadge = document.getElementById('env-switcher-color-badge');
      if (existingBadge) existingBadge.remove();
      overlayColorBadge();
    }
  });

  if (document.readyState === 'loading') {
    // The document is still loading, wait for the DOMContentLoaded event
    document.addEventListener("DOMContentLoaded", handleDOMContentLoaded, { passive: true });
  } else {
    // The document has already finished loading
    handleDOMContentLoaded();
  }

  // TYPO3 backend uses client-side navigation (SPA), so we need to
  // detect URL changes and re-extract the UID.
  if (typeof navigation !== 'undefined') {
    // Modern Navigation API
    navigation.addEventListener('navigatesuccess', () => extractAndSendUid());
  } else {
    // Fallback: intercept pushState/replaceState and listen for popstate
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = function(...args) {
      originalPushState(...args);
      extractAndSendUid();
    };
    history.replaceState = function(...args) {
      originalReplaceState(...args);
      extractAndSendUid();
    };
    window.addEventListener('popstate', () => extractAndSendUid());
  }
} else {
  // Re-injected: just refresh the badge
  const existing = document.getElementById('env-switcher-color-badge');
  if (existing) existing.remove();
  overlayColorBadge();
}
