document.addEventListener("DOMContentLoaded", () => {

  const detailsContainer = document.getElementById('details-container');
  const message = document.getElementById('message');
  const loading = document.getElementById('loading');
  const pageTitle = document.getElementById('page-title');
  const copyButton = document.getElementById('copy-button');
  const beLink = document.getElementById('be-link');

  let settingsJson = null;
  let projectId = 0;
  let pinnedEnvironment = null; // Stores the pinned environment key (e.g., "projectId-envIndex")
  let lastKnownUid = null; // Store last known UID for re-rendering
  let lastKnownUrl = null; // Store last known URL for re-rendering
  let lastKnownTab = null; // Store last known tab for re-rendering

  // Helper: set copy button content (text + optional clipboard icon)
  function setButtonContent(text, showIcon = true) {
    copyButton.textContent = text;
    if (showIcon) {
      const icon = document.createElement('span');
      icon.className = 'icon icon-clipboard';
      copyButton.prepend(icon);
    }
  }

  // Helper: toggle popup DOM state between 'message', 'details', or 'loading'
  function setPopupState(state) {
    loading.classList.add('hidden');
    message.classList.toggle('hidden', state !== 'message');
    detailsContainer.classList.toggle('hidden', state !== 'details');
    copyButton.classList.toggle('hidden', state !== 'details');
  }

  // Single click listener for copy button (uses lastKnownUid)
  copyButton.addEventListener('click', () => {
    if (!lastKnownUid) return;
    navigator.clipboard.writeText(lastKnownUid).then(() => {
      setButtonContent('UID ' + lastKnownUid + ' copied!', false);
      setTimeout(() => setButtonContent('Page-UID ' + lastKnownUid), 1000);
    }).catch(err => console.error('Failed to copy UID: ', err));
  });

  // Single click listener for backend link
  beLink.addEventListener('click', (event) => {
    openUrlInTabOrCreate(beLink.href, event);
  });

  // Set keyboard hint text (static, only needs to run once)
  const keyboardHint = document.querySelector('.popup-footer .keyboard-hint');
  if (keyboardHint) {
    keyboardHint.innerText = 'Hold "Alt" key to open links in the current tab';
  }

  // Helper: open or focus an existing settings tab (avoids duplicates)
  function openOrFocusSettings(params = '') {
    const baseUrl = chrome.runtime.getURL('settings.html');
    const targetUrl = baseUrl + (params ? '?' + params : '');
    chrome.tabs.query({}, (tabs) => {
      const existing = tabs.find(t => t.url && t.url.startsWith(baseUrl));
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: targetUrl });
        chrome.windows.update(existing.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  }

  // Helper function to open URL in existing tab or create new one
  function openUrlInTabOrCreate(targetUrl, event) {
    event.preventDefault();
    if (event.altKey) {
      // Alt key pressed: Update current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.update(tabs[0].id, { url: targetUrl });
      });
    } else {
      // Normal click: Find existing tab or create new one
      chrome.tabs.query({}, (tabs) => {
        const existingTab = tabs.find(tab => tab.url === targetUrl);
        if (existingTab) {
          chrome.tabs.update(existingTab.id, { active: true });
          chrome.windows.update(existingTab.windowId, { focused: true });
          chrome.tabs.reload(existingTab.id);
        } else {
          chrome.tabs.create({ url: targetUrl });
        }
      });
    }
  }

  // Load pinned environment from storage
  chrome.storage.sync.get(['pinnedEnvironment'], (result) => {
    pinnedEnvironment = result.pinnedEnvironment || null;

    chrome.runtime.sendMessage({ type: "GET_DOMAIN_CONFIG" }, (response) => {
      if (response && response.settingsJson) {
        settingsJson = response.settingsJson;
        projectId = settingsJson.selectedProjectIndex ?? 0;
        fetchAndUpdateUid();
      } else {
        console.log('No settings found');
      }
    });
  });

  // Function to toggle pin for an environment
  function togglePin(envKey) {
    if (pinnedEnvironment === envKey) {
      pinnedEnvironment = null;
    } else {
      pinnedEnvironment = envKey;
    }
    chrome.storage.sync.set({ pinnedEnvironment }, () => {
      // Re-render with stored values instead of re-fetching
      if (lastKnownUrl && lastKnownTab) {
        updateLinks(lastKnownUid, lastKnownUrl, lastKnownTab);
      } else {
        fetchAndUpdateUid();
      }
    });
  }

  // Function to make title wrapper clickable for pinning
  function setupPinTrigger(titleWrapper, envKey, isPinned) {
    titleWrapper.title = isPinned ? 'Unpin this environment' : 'Pin this environment';
    titleWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(envKey);
    });
  }

  // Listen for settings changes and update popup in real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.settingsJson) {
      // Settings changed, updating popup
      settingsJson = changes.settingsJson.newValue;
      projectId = settingsJson.selectedProjectIndex ?? 0;
      fetchAndUpdateUid();
    }
  });

  // Detect which project/environment matches the current URL
  // Returns project object with id, environmentName, and environmentIndex
  function detectProject(url) {
    // 'detectedProject in popup: url;
    for (let i = 0; i < settingsJson.projects.length; i++) {
      const proj = settingsJson.projects[i];
      for (let envIdx = 0; envIdx < proj.environments.length; envIdx++) {
        const env = proj.environments[envIdx];
        if (url.hostname.endsWith(env.domain + '.' + env.tld)) {
          const project = { ...proj, id: i, environmentName: env.name, environmentIndex: envIdx };
          settingsJson.selectedProjectIndex = i;
          return project;
        }
      }
    }
  }

  function updateLinks(uid, url, tab) {
    const detectedProject = detectProject(url);
    // detectedProject: detectedProject

    const environmentsContainer = document.getElementById('environments');
    while (environmentsContainer.firstChild) environmentsContainer.firstChild.remove();

    // Hide infobox and footer on extension pages (e.g. settings)
    const footer = document.querySelector('.popup-footer');
    if (url.protocol === 'chrome-extension:') {
      footer.classList.add('hidden');
      copyButton.classList.add('hidden');
      message.innerHTML = 'Extension page detected - no environments available.';
      message.classList.remove('hidden');
      return false;
    }

    if (detectedProject === undefined) {
      const missingEnvironmentInfo = document.createElement('div');
      missingEnvironmentInfo.className = 'infobox';
      // Note: url.hostname comes from the browser's URL API (trusted)
      missingEnvironmentInfo.innerHTML = 'No Project matches <strong>' + url.hostname + '</strong>. Add the domain in <a href="#" id="open-settings-link">Settings</a>.';
      copyButton.classList.add('hidden');
      environmentsContainer.appendChild(missingEnvironmentInfo);

      // Add event listener to the settings link
      document.getElementById('open-settings-link').addEventListener('click', (e) => {
        e.preventDefault();

        // Parse domain and TLD from hostname
        const hostname = url.hostname;
        const parts = hostname.split('.');
        const tld = parts[parts.length - 1];
        const domain = parts.slice(0, -1).join('.');

        const envTitle = tld === 'test' ? 'ddev' : (tld === 'local' ? 'local' : (tld === 'ch' ? 'live' : '??'));
        const title = encodeURIComponent(envTitle);

        openOrFocusSettings(`project=new&domain=${domain}&tld=${tld}&title=${title}`);
      });

      projectId = 0;
      detailsContainer.classList.add('hidden');
      message.classList.remove('hidden');
      return false;
    } else {

      const isBackend = url.pathname.includes('/typo3/module/');
      projectId = detectedProject.id;

      if (isBackend) {
        message.classList.remove('hidden');
        const pageTitle = document.getElementById('page-title');
        footer.classList.add('hidden');
        beLink.classList.add('hidden');
        return;
      }

      detailsContainer.classList.remove('hidden');
      beLink.parentElement.classList.remove('hidden');
      beLink.innerText = url.hostname + '/typo3';
      beLink.title = 'Open TYPO3 backend';
      beLink.href = url.protocol + '//' + url.hostname + '/typo3';

    }

    // Use environmentIndex from detectProject instead of a second loop
    const currentEnvIndex = detectedProject.environmentIndex;
    const environments = settingsJson.projects[projectId].environments;
    const currentEnvKey = `${projectId}-${currentEnvIndex}`;
    const isCurrentPinned = pinnedEnvironment === currentEnvKey;

    const currentEnvColumn = document.createElement('div');
    currentEnvColumn.className = 'column active' + (isCurrentPinned ? ' pinned' : '');

    const currentEnvTitleWrapper = document.createElement('div');
    currentEnvTitleWrapper.className = 'link-title-wrapper';

    const currentEnvTitle = document.createElement('div');
    currentEnvTitle.className = 'link-title';
    currentEnvTitle.textContent = detectedProject ? detectedProject.environmentName : url.hostname;
    currentEnvTitleWrapper.appendChild(currentEnvTitle);

    setupPinTrigger(currentEnvTitleWrapper, currentEnvKey, isCurrentPinned);

    currentEnvColumn.appendChild(currentEnvTitleWrapper);

    // Add "current" tooltip
    const currentTooltip = document.createElement('span');
    currentTooltip.className = 'current-tooltip';
    currentTooltip.textContent = 'current';
    currentEnvColumn.appendChild(currentTooltip);

    // Create same page link (domain link)
    const samePageLink = document.createElement('a');
    samePageLink.className = 'link link-same-page';
    samePageLink.textContent = url.hostname;

    const isBackend = url.pathname.includes('/typo3/module/');
    samePageLink.href = (isBackend && uid) ? `${url.protocol}//${url.hostname}/index.php?id=${uid}` : url.href;
    samePageLink.title = 'Current page';
    samePageLink.addEventListener('click', (event) => {
      openUrlInTabOrCreate(samePageLink.href, event);
    });
    currentEnvColumn.appendChild(samePageLink);

    if (uid) {
      // Create "Page" link
      const pageLink = document.createElement('a');
      pageLink.className = 'link link-page-module';
      pageLink.textContent = 'Page';
      pageLink.href = `${url.protocol}//${url.hostname}/typo3/module/web/layout?id=${uid}`;
      pageLink.title = 'Open Page module';
      pageLink.addEventListener('click', (event) => {
        openUrlInTabOrCreate(pageLink.href, event);
      });
      currentEnvColumn.appendChild(pageLink);

      // Create "List" link
      const listLink = document.createElement('a');
      listLink.className = 'link link-list-module';
      listLink.textContent = 'List';
      listLink.href = `${url.protocol}//${url.hostname}/typo3/module/web/list?id=${uid}`;
      listLink.title = 'Open List module';
      listLink.addEventListener('click', (event) => {
        openUrlInTabOrCreate(listLink.href, event);
      });
      currentEnvColumn.appendChild(listLink);
    } else {
      message.textContent = '';
      message.append('No UID found - ');
      const retryLink = document.createElement('a');
      retryLink.href = '#';
      retryLink.textContent = 'retry';
      retryLink.addEventListener('click', (e) => {
        e.preventDefault();
        fetchAndUpdateUid();
      });
      message.appendChild(retryLink);
      message.classList.remove('hidden');
      copyButton.classList.add('hidden');
    }

    // Build array of environment cards (excluding current)
    const envCards = [];
    for (let envIndex = 0; envIndex < environments.length; envIndex++) {
      const environment = environments[envIndex];
      const testDomain = `${environment.domain}.${environment.tld}`;

      // Skip the current environment (it's handled separately as currentEnvColumn)
      if (`${url.protocol}//${testDomain}` === url.origin) {
        continue;
      }

      const envKey = `${projectId}-${envIndex}`;
      const isPinned = pinnedEnvironment === envKey;

      const columnDiv = document.createElement('div');
      columnDiv.className = 'column' + (isPinned ? ' pinned' : '');

      const titleWrapper = document.createElement('div');
      titleWrapper.className = 'link-title-wrapper';

      const linkTitleDiv = document.createElement('div');
      linkTitleDiv.className = 'link-title';
      linkTitleDiv.textContent = environment.name;
      titleWrapper.appendChild(linkTitleDiv);

      setupPinTrigger(titleWrapper, envKey, isPinned);

      columnDiv.appendChild(titleWrapper);

      const links = [
        {
          id: `link-${environment.name}-same-page`,
          text: 'Test',
          href: `${testDomain}`,
          target: '_blank'
        },
      ];

      if (uid) {
        links.push({
          id: `link-${environment.name}-page-module`,
          text: 'Page-Module',
          href: `#`,
          target: '_blank',
          class: 'link-page-module'
        });
        links.push({
          id: `link-${environment.name}-list-module`,
          text: 'List-Module',
          href: `#`,
          target: '_blank',
          class: 'link-list-module'
        });
      }

      links.forEach(link => {
        const a = document.createElement('a');
        a.id = link.id;
        a.className = 'link' + (link.class ? ' ' + link.class : '');
        a.textContent = link.text;
        a.href = link.href;
        a.target = link.target;
        columnDiv.appendChild(a);
      });

      envCards.push({
        element: columnDiv,
        isPinned,
        environment,
        testDomain
      });
    }

    // Render cards in settings order, with pinned card at the end
    // Find the pinned card (if any, and not the current environment)
    const pinnedCard = envCards.find(c => c.isPinned);
    const nonPinnedCards = envCards.filter(c => !c.isPinned);

    // Render all environments in their natural order from settings
    // Current environment is rendered in its position, pinned at the end
    for (let envIndex = 0; envIndex < environments.length; envIndex++) {
      const env = environments[envIndex];
      const testDomain = `${env.domain}.${env.tld}`;
      const isCurrentEnv = `${url.protocol}//${testDomain}` === url.origin;
      const envKey = `${projectId}-${envIndex}`;
      const isPinnedEnv = pinnedEnvironment === envKey;

      if (isCurrentEnv) {
        // Render current environment in its natural position
        environmentsContainer.appendChild(currentEnvColumn);
      } else if (!isPinnedEnv) {
        // Render non-pinned, non-current environments in order
        const card = nonPinnedCards.find(c => c.environment === env);
        if (card) {
          environmentsContainer.appendChild(card.element);
        }
      }
      // Skip pinned env here - it will be added at the end
    }

    // Add pinned card at the end (if exists and not the current environment)
    if (pinnedCard) {
      environmentsContainer.appendChild(pinnedCard.element);
    }

    // If current environment is also pinned, it's already rendered in position
    // but we need to move it to the end
    if (isCurrentPinned) {
      environmentsContainer.appendChild(currentEnvColumn);
    }

    // Set up click handlers for environment links
    envCards.forEach(card => {
      const environment = card.environment;
      const testDomain = card.testDomain;

      const linkPageModule = document.getElementById(`link-${environment.name}-page-module`);
      const linkListModule = document.getElementById(`link-${environment.name}-list-module`);
      const LinkSamePage = document.getElementById(`link-${environment.name}-same-page`);

      LinkSamePage.href = url.href.replace(url.hostname, `${environment.domain}.${environment.tld}`);
      LinkSamePage.innerText = `${environment.domain}.${environment.tld}`;
      LinkSamePage.title = `Open this page on ${environment.name}`;

      // Add click handler with existing tab detection
      LinkSamePage.addEventListener('click', (event) => {
        openUrlInTabOrCreate(LinkSamePage.href, event);
      });

      if (uid != null) {
        linkListModule.href = `${url.protocol}//${testDomain}/typo3/module/web/list?id=${uid}`;
        linkListModule.innerText = 'List';
        linkListModule.title = `${environment.name} List module`;
        linkListModule.classList.add('link-list-module');

        // Add click handler with existing tab detection
        linkListModule.addEventListener('click', (event) => {
          openUrlInTabOrCreate(linkListModule.href, event);
        });

        linkPageModule.href = `${url.protocol}//${testDomain}/typo3/module/web/layout?id=${uid}`;
        linkPageModule.innerText = 'Page';
        linkPageModule.title = `${environment.name} Page module`;
        linkPageModule.classList.add('link-page-module');

        // Add click handler with existing tab detection
        linkPageModule.addEventListener('click', (event) => {
          openUrlInTabOrCreate(linkPageModule.href, event);
        });
      }
    });

  }

  function fetchAndUpdateUid() {
    // fetchAndUpdateUid called popup:fetchAndUpdateUid()
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = new URL(tab.url);

      // Check if in TYPO3 backend
      if (url.href.includes("/typo3/module/")) {
        const backendLinkContainer = document.getElementById('backend-link');
        let uid = null;
        if (url.pathname.includes("/typo3/module/web/layout") || url.pathname.includes("/typo3/module/web/list")) {
          uid = url.searchParams.get('id');
        }
        if (uid) {
          lastKnownUid = uid;
          lastKnownUrl = url;
          lastKnownTab = tab;
          updateLinks(uid, url, tab);
          setPopupState('details');
          setButtonContent('Page-UID ' + uid);
          copyButton.classList.remove('hidden');

          // set page title and add copy url button
          const tabTitleArray = tab.title.split(/\s*[·•‧⋅|–—]\s*/);
          pageTitle.innerText = tabTitleArray.length > 2
            ? `${tabTitleArray[1]}`
            : tabTitleArray.length > 1
              ? tabTitleArray[0]
              : tab.title;
          backendLinkContainer.textContent = '';
          const urlText = document.createElement('span');
          urlText.textContent = url.href;
          urlText.setAttribute('title', 'Copy URL to clipboard');

          const keyboardHint = document.getElementsByClassName('keyboard-hint')[0];
          if (keyboardHint) {
            keyboardHint.innerText = 'Open backend URL in other environments';
          }

          const clipIcon = document.createElement('span');
          clipIcon.className = 'icon icon-clipboard';
          backendLinkContainer.append(clipIcon, urlText);
          backendLinkContainer.classList.remove('hidden');
          backendLinkContainer.style.cursor = 'pointer';
          backendLinkContainer.onclick = () => {
            navigator.clipboard.writeText(url.href).then(() => {
              urlText.textContent = 'URL copied!';
              setTimeout(() => { urlText.textContent = url.href; }, 1000);
            });
          };

          // Add backend links for other environments
          const detectedProject = detectProject(url);
          if (detectedProject) {
            const environments = settingsJson.projects[detectedProject.id].environments;
            const backendEnvContainer = document.getElementById('environments');

            const footer = document.querySelector('.popup-footer');
            footer.classList.remove('hidden');

            backendEnvContainer.textContent = '';
            let hasOtherEnvs = false;

            for (let envIndex = 0; envIndex < environments.length; envIndex++) {
              if (envIndex === detectedProject.environmentIndex) continue;
              const env = environments[envIndex];
              const envDomain = `${env.domain}.${env.tld}`;
              const envUrl = url.href.replace(url.hostname, envDomain);

              const link = document.createElement('a');
              link.className = 'backend-env-link';
              link.href = envUrl;
              link.textContent = `${env.name}`;
              link.title = `Open on ${env.name}`;
              link.addEventListener('click', (event) => {
                openUrlInTabOrCreate(link.href, event);
              });
              backendEnvContainer.appendChild(link);
              hasOtherEnvs = true;
            }

            if (hasOtherEnvs) {
              backendEnvContainer.classList.remove('hidden');
            }
          }

        } else {
          setPopupState('message');
          message.innerText = 'No links available in this backend module';
          const footer = document.querySelector('.popup-footer');
          footer.classList.add('hidden');
          const backendLink = document.getElementById('additional-links');
          backendLink.classList.add('hidden');
        }
        return false;
      }

      // Extract UID directly from the page DOM (fresh read, not cached)
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          let uid = document.body.getAttribute("data-uid");
          if (!uid) uid = document.head.getAttribute("data-uid");
          if (!uid) uid = document.querySelector("meta[name=pageid]")?.getAttribute("content");
          return uid;
        }
      }, (results) => {
        const uid = results?.[0]?.result || null;

        // Keep service worker in sync
        if (uid) {
          chrome.runtime.sendMessage({ type: "SET_UID", uid });
        }

        // Store values for re-rendering on pin toggle
        lastKnownUid = uid;
        lastKnownUrl = url;
        lastKnownTab = tab;

        updateLinks(uid, url, tab);

        if (uid) {
          setPopupState('details');
          pageTitle.innerText = `${tab.title}`;
          setButtonContent('Page-UID ' + uid);
          copyButton.classList.remove('hidden');
        } else {
          loading.classList.add('hidden');
          copyButton.classList.add('hidden');
        }
      });
    });
  }

  // Settings button handler
  document.getElementById('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    openOrFocusSettings(`project=${projectId}`);
  });

});
