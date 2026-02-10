document.addEventListener("DOMContentLoaded", () => {

  const projectSelect = document.getElementById('project-select');
  const addEnvironmentButton = document.getElementById('add-environment');
  const inputNewName = document.getElementById('new-env-name');
  const inputNewDomain = document.getElementById('new-env-domain');
  const inputNewTld = document.getElementById('new-env-tld');

  let settingsJson = null;
  let projectId = 0;

  // Drag and drop state
  const dragState = {
    isDragging: false,
    draggedElement: null,
    draggedIndex: null,
    ghostElement: null,
    dropIndicator: null,
    targetIndex: null,
    offsetX: 0,
    offsetY: 0,
    itemRects: []
  };

  // Check for project parameter in URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlProjectId = urlParams.get('project');
  const urlDomain = urlParams.get('domain');
  const urlTld = urlParams.get('tld');
  const urlTitle = urlParams.get('title');

  // Load settings on page load
  chrome.runtime.sendMessage({ type: "GET_DOMAIN_CONFIG" }, (response) => {
    if (response && response.settingsJson) {
      settingsJson = response.settingsJson;

      // Check if we need to create a new project from URL parameters
      if (urlProjectId === 'new' && urlDomain && urlTld && urlTitle) {
        // Auto-create new project with prepopulated environment
        const nextProjectNumber = settingsJson.projects ? settingsJson.projects.length : 0;
        const newProject = {
          "name": "Project " + (nextProjectNumber + 1),
          "environments": [
            {
              "name": decodeURIComponent(urlTitle),
              "domain": urlDomain,
              "tld": urlTld,
              "color": "#ffffff"
            }
          ]
        };

        if (settingsJson.projects != null) {
          settingsJson.projects.push(newProject);
        } else {
          settingsJson.projects = [newProject];
        }

        projectId = nextProjectNumber;
        settingsJson.selectedProjectIndex = projectId;

        // Save the new project
        saveSettings();
      } else if (urlProjectId !== null && urlProjectId !== 'new') {
        // Use URL parameter if provided, otherwise use selected project
        projectId = parseInt(urlProjectId);
        // Update the selected project in settings
        settingsJson.selectedProjectIndex = projectId;
      } else {
        projectId = settingsJson.selectedProjectIndex ?? 0;
      }

      renderProjectDetails(projectId);
    } else {
      console.log('No settings found');
    }
  });

  function createEnvironmentDiv(projectIndex, env, index) {
    const envDiv = document.createElement('div');
    envDiv.className = 'environment';
    envDiv.dataset.index = index;

    // Create drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Drag to reorder';
    const dragIcon = document.createElement('span');
    dragIcon.className = 'icon icon-grip';
    dragHandle.appendChild(dragIcon);
    envDiv.appendChild(dragHandle);

    // Create color input
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color';
    colorInput.value = env.color || '#ffffff';
    colorInput.id = `color-${index}`;
    envDiv.appendChild(colorInput);

    // Create name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'name';
    nameInput.placeholder = 'Name';
    nameInput.value = env.name || '';
    nameInput.id = `name-${index}`;
    nameInput.dataset.project = projectIndex;
    envDiv.appendChild(nameInput);

    // Create domain input
    const domainInput = document.createElement('input');
    domainInput.type = 'text';
    domainInput.className = 'domain';
    domainInput.placeholder = 'Domain';
    domainInput.value = env.domain || '';
    domainInput.id = `domain-${index}`;
    envDiv.appendChild(domainInput);

    // Create TLD input
    const tldInput = document.createElement('input');
    tldInput.type = 'text';
    tldInput.className = 'tld';
    tldInput.placeholder = 'TLD';
    tldInput.value = env.tld || '';
    tldInput.id = `tld-${index}`;
    envDiv.appendChild(tldInput);

    // Create remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn destructive';
    removeBtn.id = `remove-${index}`;
    removeBtn.textContent = 'Remove';
    envDiv.appendChild(removeBtn);

    // Attach event listeners
    removeBtn.addEventListener('click', function() {
      envDiv.remove();
      settingsJson.projects[projectIndex].environments.splice(index, 1);
      saveSettings();
      renderProjectDetails(projectId);
    });

    nameInput.addEventListener('input', (e) => {
      settingsJson.projects[projectIndex].environments[index].name = e.target.value;
      saveSettings();
    });

    domainInput.addEventListener('input', (e) => {
      settingsJson.projects[projectIndex].environments[index].domain = e.target.value;
      saveSettings();
    });

    colorInput.addEventListener('input', (e) => {
      settingsJson.projects[projectIndex].environments[index].color = e.target.value;
      saveSettings();
    });

    tldInput.addEventListener('input', (e) => {
      settingsJson.projects[projectIndex].environments[index].tld = e.target.value;
      saveSettings();
    });

    return envDiv;
  }

  // Drag and Drop Functions
  function initDragAndDrop(container, projectIndex) {
    const handles = container.querySelectorAll('.drag-handle');

    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const envRow = handle.closest('.environment');
        handleDragStart(e, envRow, container, projectIndex);
      });
    });
  }

  function handleDragStart(e, envRow, container, projectIndex) {
    dragState.isDragging = true;
    dragState.draggedElement = envRow;
    dragState.draggedIndex = parseInt(envRow.dataset.index);

    // Store positions of all items
    const items = container.querySelectorAll('.environment');
    dragState.itemRects = Array.from(items).map(item => item.getBoundingClientRect());

    // Calculate offset from mouse to element top-left
    const rect = envRow.getBoundingClientRect();
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;

    // Create ghost element
    dragState.ghostElement = createGhostElement(envRow);
    document.body.appendChild(dragState.ghostElement);

    // Position ghost at cursor
    dragState.ghostElement.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.ghostElement.style.top = (e.clientY - dragState.offsetY) + 'px';

    // Create drop indicator
    dragState.dropIndicator = document.createElement('div');
    dragState.dropIndicator.className = 'drop-indicator';
    container.appendChild(dragState.dropIndicator);

    // Mark original element
    envRow.classList.add('is-dragging');
    container.classList.add('is-dragging');

    // Add document listeners
    const moveHandler = (e) => handleDragMove(e, container);
    const upHandler = (e) => {
      handleDragEnd(e, container, projectIndex);
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  }

  function handleDragMove(e, container) {
    if (!dragState.isDragging) return;

    // Move ghost
    dragState.ghostElement.style.left = (e.clientX - dragState.offsetX) + 'px';
    dragState.ghostElement.style.top = (e.clientY - dragState.offsetY) + 'px';

    // Calculate target index based on mouse Y position
    const items = container.querySelectorAll('.environment:not(.is-dragging)');
    let targetIndex = dragState.draggedIndex;

    for (let i = 0; i < dragState.itemRects.length; i++) {
      const rect = dragState.itemRects[i];
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        targetIndex = i;
        break;
      }
      targetIndex = i + 1;
    }

    dragState.targetIndex = targetIndex;
    updateDropIndicator(container, targetIndex);
  }

  function handleDragEnd(e, container, projectIndex) {
    if (!dragState.isDragging) return;

    const fromIndex = dragState.draggedIndex;
    const toIndex = dragState.targetIndex;

    // Cleanup
    if (dragState.ghostElement) {
      dragState.ghostElement.remove();
    }
    if (dragState.dropIndicator) {
      dragState.dropIndicator.remove();
    }
    if (dragState.draggedElement) {
      dragState.draggedElement.classList.remove('is-dragging');
    }
    container.classList.remove('is-dragging');

    // Reorder if position changed
    if (toIndex !== null && toIndex !== fromIndex && toIndex !== fromIndex + 1) {
      reorderEnvironments(projectIndex, fromIndex, toIndex);
    }

    // Reset state
    dragState.isDragging = false;
    dragState.draggedElement = null;
    dragState.draggedIndex = null;
    dragState.ghostElement = null;
    dragState.dropIndicator = null;
    dragState.targetIndex = null;
    dragState.itemRects = [];
  }

  function createGhostElement(envRow) {
    const ghost = envRow.cloneNode(true);
    ghost.className = 'environment-ghost';

    // Match width of original
    const rect = envRow.getBoundingClientRect();
    ghost.style.width = rect.width + 'px';

    return ghost;
  }

  function updateDropIndicator(container, targetIndex) {
    if (!dragState.dropIndicator) return;

    const items = container.querySelectorAll('.environment');

    if (targetIndex <= 0) {
      // Above first item
      const firstItem = items[0];
      if (firstItem) {
        const rect = firstItem.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        dragState.dropIndicator.style.top = (rect.top - containerRect.top - 5) + 'px';
      }
    } else if (targetIndex >= items.length) {
      // Below last item
      const lastItem = items[items.length - 1];
      if (lastItem) {
        const rect = lastItem.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        dragState.dropIndicator.style.top = (rect.bottom - containerRect.top + 3) + 'px';
      }
    } else {
      // Between items
      const item = items[targetIndex];
      if (item) {
        const rect = item.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        dragState.dropIndicator.style.top = (rect.top - containerRect.top - 5) + 'px';
      }
    }
  }

  function reorderEnvironments(projectIndex, fromIndex, toIndex) {
    const environments = settingsJson.projects[projectIndex].environments;

    // Remove from old position
    const [movedItem] = environments.splice(fromIndex, 1);

    // Adjust target index if moving down
    const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;

    // Insert at new position
    environments.splice(adjustedToIndex, 0, movedItem);

    // Save and re-render
    saveSettings();
    renderProjectDetails(projectIndex);
  }

  function renderProjectsDropdown(selectedProjectIndex = 0) {
    const projectOptionsCount = projectSelect.options.length;
    if (projectOptionsCount > 0) {
      for (let i = projectOptionsCount - 1; i >= 0; i--) {
        projectSelect.options[i] = null;
      }
    }

    if (settingsJson.projects && settingsJson.projects.length > 0) {
      settingsJson.projects.forEach((project, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = project.name;
        option.selected = index === parseInt(selectedProjectIndex);
        projectSelect.appendChild(option);
      });
    }

    projectSelect.addEventListener('change', () => {
      projectId = projectSelect.value;
      settingsJson["selectedProjectIndex"] = projectId;
      saveSettings();
      renderProjectDetails(projectSelect.value);
    });
  }

  function renderProjectDetails(projectIndex) {
    const projectDetails = document.getElementById('project-details');
    const environmentsEditContainer = document.getElementById('environments-edit-container');
    const projectDetailsWrap = document.getElementById('project-detailswrap');
    projectDetails.textContent = "";

    let project = null;

    if (settingsJson.projects != null && settingsJson.projects[projectIndex]) {
      project = settingsJson.projects[projectIndex];
    }

    renderProjectsDropdown(projectIndex);

    if (!project) {
      projectDetailsWrap.style.display = 'none';
      return;
    }
    projectDetailsWrap.style.display = '';

    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Project';
    titleLabel.htmlFor = `project-title-${projectIndex}`;
    projectDetails.appendChild(titleLabel);

    const titleInput = document.createElement('input');
    titleInput.id = `project-title-${projectIndex}`;
    titleInput.type = 'text';
    titleInput.classList = 'project-title';
    titleInput.value = project.name;
    titleInput.addEventListener('input', (e) => {
      settingsJson.projects[projectIndex].name = e.target.value;
      saveSettings();
      renderProjectsDropdown(projectIndex);
    });
    projectDetails.appendChild(titleInput);

    environmentsEditContainer.innerHTML = '';
    const environmentsList = document.createElement('div');
    environmentsList.className = 'environments-list';
    settingsJson.projects[projectIndex].environments.forEach((env, envIndex) => {
      const envItem = createEnvironmentDiv(projectIndex, env, envIndex);
      environmentsList.appendChild(envItem);
    });
    environmentsEditContainer.appendChild(environmentsList);

    // Initialize drag and drop for this environments list
    initDragAndDrop(environmentsList, projectIndex);
  }

  function addEnvironment() {
    const projectIndex = projectSelect.value;

    if (!settingsJson.projects || !settingsJson.projects[projectIndex]) {
      return;
    }

    const newEnvironment = {
      name: inputNewName.value,
      domain: inputNewDomain.value,
      color: "#ffffff",
      tld: inputNewTld.value
    };

    if (newEnvironment.name != '' && newEnvironment.domain != '' && newEnvironment.tld != '') {
      inputNewName.value = '';
      inputNewDomain.value = '';
      inputNewTld.value = '';
      settingsJson.projects[projectIndex].environments.push(newEnvironment);
      saveSettings();
      renderProjectDetails(projectIndex);
    } else {
      alert('Please fill in all fields');
    }
  }

  function addProject() {
      // todo: delete this function if not used
    const nextProjectNumber = projectSelect.options.length;
    const newProject = {
      "name": "New Project " + (nextProjectNumber + 1),
      "color": "#ddff00",
      "environments": []
    };

    if (settingsJson.projects != null) {
      settingsJson.projects.push(newProject);
    } else {
      settingsJson = { "projects": [newProject] };
    }

    saveSettings();
    renderProjectsDropdown(nextProjectNumber);
    renderProjectDetails(nextProjectNumber);
    return newProject;
  }

  function saveSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'SAVE_DOMAIN_CONFIG', data: settingsJson }, (response) => {
        // Settings saved
      });
    } catch (error) {
      console.error('Failed to serialize settingsJson:', error);
    }
  }

  function removeProject() {
    const projectOptionsCount = projectSelect.options.length;
    const projectIndex = projectSelect.value;
    if (projectOptionsCount === 1) {
      //alert('You cannot remove the last project');
      //return;
    }
    settingsJson.projects.splice(projectIndex, 1);
    saveSettings();
    renderProjectsDropdown(0);
    renderProjectDetails(0);
  }

  function watchNewInputFields() {
    if (inputNewName.value != '' && inputNewDomain.value != '' && inputNewTld.value != '') {
      addEnvironmentButton.classList.remove('disabled');
      addEnvironmentButton.removeAttribute('disabled');
    } else {
      addEnvironmentButton.classList.add('disabled');
      addEnvironmentButton.setAttribute('disabled', 'disabled');
    }
  }

  // Event listeners
  document.getElementById('remove-project').addEventListener('click', removeProject);
  document.getElementById('add-project').addEventListener('click', addProject);

  inputNewName.addEventListener('input', watchNewInputFields);
  inputNewDomain.addEventListener('input', watchNewInputFields);
  inputNewTld.addEventListener('input', watchNewInputFields);
  inputNewTld.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      addEnvironment();
      inputNewName.focus();
    }
  });

  addEnvironmentButton.addEventListener('click', addEnvironment);

  // Import/Export functionality
  function exportSettings() {
    chrome.storage.sync.get(['settingsJson'], (result) => {
      const settings = result.settingsJson;
      if (!settings) {
        showMessage('No settings to export', 'error');
        return;
      }

      const dataStr = JSON.stringify(settings, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'environment-switcher-settings.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showMessage('Settings exported successfully!', 'success');
    });
  }

  function importSettings() {
    document.getElementById('import-file-input').click();
  }

  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedSettings = JSON.parse(event.target.result);

        // Validate structure
        if (!importedSettings.projects || !Array.isArray(importedSettings.projects)) {
          showMessage('Invalid settings file format', 'error');
          return;
        }

        // Save to storage
        chrome.storage.sync.set({ settingsJson: importedSettings }, () => {
          settingsJson = importedSettings;
          projectId = importedSettings.selectedProjectIndex ?? 0;
          renderProjectDetails(projectId);
          showMessage('Settings imported successfully!', 'success');
        });

      } catch (error) {
        console.error('Import error:', error);
        showMessage('Failed to import settings: Invalid JSON', 'error');
      }
    };
    reader.readAsText(file);

    // Reset file input
    e.target.value = '';
  });

  function showMessage(text, type) {
    const messageDiv = document.getElementById('import-export-message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.remove('hidden');

    setTimeout(() => {
      messageDiv.classList.add('hidden');
    }, 3000);
  }

  document.getElementById('export-settings').addEventListener('click', exportSettings);
  document.getElementById('import-settings').addEventListener('click', importSettings);

  // Navigation handling
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('.content-section');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSection = link.dataset.section;

      // Update active nav link
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Show target section, hide others
      sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `section-${targetSection}`) {
          section.classList.add('active');
        }
      });

      // Re-render project details when returning to Projects section
      if (targetSection === 'projects' && settingsJson) {
        renderProjectDetails(projectId);
      }
    });
  });

  // Close settings button
  document.getElementById('close-settings').addEventListener('click', () => {
    window.close();
  });

  // Color badge toggle functionality
  const colorBadgeToggle = document.getElementById('show-color-badge');
  let showColorBadge = false;

  // Load color badge setting from storage
  chrome.storage.sync.get(['showColorBadge'], (result) => {
    showColorBadge = result.showColorBadge || false;
    updateToggleIcon();
  });

  function updateToggleIcon() {
    const img = colorBadgeToggle.querySelector('img');
    if (showColorBadge) {
      img.src = 'icons/toggle-right.svg';
      img.alt = 'On';
    } else {
      img.src = 'icons/toggle-left.svg';
      img.alt = 'Off';
    }
  }

  colorBadgeToggle.addEventListener('click', () => {
    showColorBadge = !showColorBadge;
    chrome.storage.sync.set({ showColorBadge }, () => {
      // update setting
      updateToggleIcon();
    });
  });

});
