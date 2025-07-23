// Robot Army Module for Ready To Review
export const Robots = (() => {
  "use strict";

  const robotDefinitions = [
    {
      id: "autoassign",
      name: "AutoAssign 2000",
      icon: "🤖",
      description: "Finds the best people to review pull requests by looking at who recently worked on the same files. No more wondering who to ask for reviews!",
      config: {
        type: "select",
        label: "Number of reviewers to auto-assign",
        options: [
          { value: "1", label: "1 reviewer" },
          { value: "2", label: "2 reviewers" },
          { value: "3", label: "3 reviewers" },
          { value: "4", label: "4 reviewers" }
        ],
        default: "2"
      }
    },
    {
      id: "autoapprove",
      name: "AutoApprove 2001",
      icon: "✅",
      description: "Saves time by automatically approving small, safe changes like dependency updates. Perfect for routine updates that don't need human review.",
      config: [
        {
          type: "checkboxes",
          label: "Automatically approve PRs from these trusted sources:",
          options: [
            { id: "dependabot", label: "Dependabot (automated dependency updates)", default: true },
            { id: "owners", label: "Project owners", default: false },
            { id: "contributors", label: "Regular contributors", default: false }
          ]
        },
        {
          type: "select",
          label: "Only if changes are smaller than:",
          options: [
            { value: "1", label: "1 line" },
            { value: "2", label: "2 lines" },
            { value: "3", label: "3 lines" },
            { value: "4", label: "4 lines" },
            { value: "5", label: "5 lines" },
            { value: "6", label: "6 lines" },
            { value: "7", label: "7 lines" },
            { value: "8", label: "8 lines" }
          ],
          default: "3"
        }
      ]
    },
    {
      id: "compliancebot",
      name: "ComplianceBot 3000",
      icon: "📋",
      description: "Helps meet compliance requirements by tracking when code gets merged without proper review. Essential for audits and security standards like SOC 2.",
      config: {
        type: "text",
        label: "Only monitor repositories tagged with this topic:",
        placeholder: "e.g., soc2-required"
      }
    },
    {
      id: "slackchan",
      name: "SlackChan 4000",
      icon: "📢",
      description: "Posts new pull requests to your team's Slack channels. Keep everyone in the loop without manual notifications.",
      config: [
        {
          type: "mappings",
          label: "Connect your GitHub repos to Slack channels:",
          placeholder1: "GitHub project (e.g., myorg/myrepo)",
          placeholder2: "Slack channel (e.g., #dev-reviews)"
        },
        {
          type: "checkbox",
          label: "Only notify after tests pass (reduces noise)",
          default: true
        }
      ]
    },
    {
      id: "slackdm",
      name: "SlackDM 4001",
      icon: "💬",
      description: "Sends personal Slack messages when someone is assigned to review code. No more missed review requests!",
      config: [
        {
          type: "mappings",
          label: "Match GitHub users to their Slack accounts:",
          placeholder1: "GitHub username",
          placeholder2: "Slack user ID or @username"
        },
        {
          type: "checkbox",
          label: "Only notify after tests pass (reduces noise)",
          default: true
        }
      ]
    },
    {
      id: "reassign",
      name: "ReAssign 5000",
      icon: "🔄",
      description: "Prevents reviews from getting stuck by finding new reviewers when the original ones haven't responded. Keeps pull requests moving forward.",
      config: {
        type: "select",
        label: "Find new reviewers after:",
        options: [
          { value: "3", label: "3 days of waiting" },
          { value: "5", label: "5 days of waiting" },
          { value: "7", label: "7 days of waiting" },
          { value: "10", label: "10 days of waiting" }
        ],
        default: "5"
      }
    },
    {
      id: "testbot",
      name: "TestBot 6000",
      icon: "🧪",
      description: "Helps developers fix failing tests by providing helpful suggestions and common solutions. Like having a senior engineer guide you through test failures.",
      config: {
        type: "toggle",
        label: "Enable TestBot assistance"
      }
    },
    {
      id: "autoclose",
      name: "AutoClose 9000",
      icon: "🗑️",
      description: "Keeps your repository clean by closing abandoned pull requests. Gives warning before closing so nothing important gets lost.",
      config: {
        type: "select",
        label: "Close inactive PRs after:",
        options: [
          { value: "60", label: "60 days of inactivity" },
          { value: "90", label: "90 days of inactivity" },
          { value: "120", label: "120 days of inactivity" }
        ],
        default: "90"
      }
    }
  ];

  let robotConfigs = {};
  let selectedOrg = null;

  // DOM helpers
  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.removeAttribute("hidden");
  const hide = (el) => el && el.setAttribute("hidden", "");

  const showNotificationsPage = () => {
    hide($("prSections"));
    hide($("statsPage"));
    hide($("settingsPage"));
    show($("notificationsPage"));
    
    document.title = "Notifications - Ready to Review";
    
    // Add click handler for "Configure in Robot Army" button
    const goToRobotArmyBtn = $("goToRobotArmy");
    if (goToRobotArmyBtn) {
      goToRobotArmyBtn.onclick = () => {
        window.location.href = '/robot-army';
      };
    }
  };
  
  const showSettingsPage = async (state, setupHamburgerMenu, githubAPI) => {
    console.log("[showSettingsPage] Starting with path:", window.location.pathname);
    try {
      hide($("prSections"));
      hide($("statsPage"));
      hide($("notificationsPage"));
      
      const settingsPage = $("settingsPage");
      console.log("[showSettingsPage] Settings page element found:", !!settingsPage);
      show(settingsPage);
      
      const settingsContent = settingsPage?.querySelector('.settings-content');
      if (settingsContent) {
        console.log("[showSettingsPage] settings-content element:", settingsContent);
        show(settingsContent);
      }
      
      setupHamburgerMenu();
      
      const path = window.location.pathname;
      const match = path.match(/^\/robot-army(?:\/([^\/]+))?$/);
      
      if (!match) {
        console.error("[showSettingsPage] Invalid robot-army URL:", path);
        return;
      }
      
      const org = match[1];
      console.log("[showSettingsPage] Parsed org from URL:", org || "(none - root page)");
      
      const orgSelection = document.querySelector('.org-selection');
      const robotConfig = $("robotConfig");
      
      console.log("[showSettingsPage] Elements found:", {
        orgSelection: !!orgSelection,
        robotConfig: !!robotConfig,
        robotConfigInitiallyHidden: robotConfig?.hasAttribute("hidden")
      });
      
      if (org) {
        selectedOrg = org;
        document.title = `${org}'s Robot Army`;
        
        const settingsTitle = settingsPage?.querySelector('.settings-title');
        const settingsSubtitle = settingsPage?.querySelector('.settings-subtitle');
        if (settingsTitle) {
          settingsTitle.textContent = `🤖 ${org}'s Robot Army`;
          console.log("[showSettingsPage] Updated h1 title to:", settingsTitle.textContent);
        }
        if (settingsSubtitle) {
          settingsSubtitle.textContent = `Configure automated helpers to handle repetitive GitHub tasks`;
        }
        
        if (orgSelection) {
          console.log("[showSettingsPage] Hiding org selection");
          hide(orgSelection);
        }
        if (robotConfig) {
          console.log("[showSettingsPage] Showing robot config");
          show(robotConfig);
        }
        
        const settingsContentDiv = settingsPage?.querySelector('.settings-content');
        if (settingsContentDiv && settingsContentDiv.hasAttribute('hidden')) {
          console.log("[showSettingsPage] Removing hidden from settings-content");
          settingsContentDiv.removeAttribute('hidden');
        }
        
        console.log("[showSettingsPage] Current robotConfigs:", Object.keys(robotConfigs));
        if (Object.keys(robotConfigs).length === 0) {
          console.log("[showSettingsPage] Initializing robot configs with defaults");
          robotDefinitions.forEach(robot => {
            robotConfigs[robot.id] = {
              enabled: false,
              config: {}
            };
          });
          console.log("[showSettingsPage] Initialized configs for", robotDefinitions.length, "robots");
        }
        
        const yamlPath = `${selectedOrg}/.github/.github/codegroove.yaml`;
        console.log("[showSettingsPage] Updating YAML path to:", yamlPath);
        const yamlPathEl = $("yamlPath");
        const yamlPathModalEl = $("yamlPathModal");
        if (yamlPathEl) yamlPathEl.textContent = yamlPath;
        if (yamlPathModalEl) yamlPathModalEl.textContent = yamlPath;
        
        console.log("[showSettingsPage] Calling renderRobotCards...");
        renderRobotCards();
        console.log("[showSettingsPage] Completed org-specific setup");
        
      } else {
        document.title = "Robot Army Configuration";
        
        const settingsTitle = settingsPage?.querySelector('.settings-title');
        if (settingsTitle) {
          settingsTitle.textContent = "🤖 Robot Army Configuration";
          console.log("[showSettingsPage] Reset h1 title to default");
        }
        
        if (orgSelection) {
          console.log("[showSettingsPage] Showing org selection");
          show(orgSelection);
        }
        if (robotConfig) {
          console.log("[showSettingsPage] Hiding robot config");
          hide(robotConfig);
        }
        
        console.log("[showSettingsPage] Loading organizations for settings...");
        await loadOrganizationsForSettings(state, githubAPI);
      }
      console.log("[showSettingsPage] Completed successfully");
    } catch (error) {
      console.error("[showSettingsPage] Error:", error);
      console.error("[showSettingsPage] Stack trace:", error.stack);
    }
  };

  const loadOrganizationsForSettings = async (state, githubAPI) => {
    const orgSelect = $("orgSelectSettings");
    if (!orgSelect) return;
    
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const user = state.currentUser || state.viewingUser;
      if (!user) {
        orgSelect.innerHTML = '<option value="">Please login to view organizations</option>';
        return;
      }
      
      const events = await githubAPI(`/users/${user.login}/events/public?per_page=100`);
      
      const orgSet = new Set();
      events.forEach(event => {
        if (event.created_at < thirtyDaysAgo.toISOString()) return;
        
        if (
          event.type === "PullRequestEvent" ||
          event.type === "PullRequestReviewEvent" ||
          event.type === "PullRequestReviewCommentEvent" ||
          event.type === "PushEvent" ||
          event.type === "IssuesEvent"
        ) {
          const org = event.repo.name.split('/')[0];
          orgSet.add(org);
        }
      });
      
      try {
        const userOrgs = await githubAPI('/user/orgs');
        userOrgs.forEach(org => orgSet.add(org.login));
      } catch (e) {
        // User might not have org access
      }
      
      const orgs = Array.from(orgSet).sort();
      
      if (orgs.length === 0) {
        orgSelect.innerHTML = '<option value="">No organizations found</option>';
        return;
      }
      
      orgSelect.innerHTML = '<option value="">Select an organization</option>';
      orgs.forEach(org => {
        const option = document.createElement("option");
        option.value = org;
        option.textContent = org;
        orgSelect.appendChild(option);
      });
      
      orgSelect.addEventListener("change", onOrgSelected);
    } catch (error) {
      console.error("Failed to load organizations:", error);
      orgSelect.innerHTML = '<option value="">Failed to load organizations</option>';
    }
  };

  const onOrgSelected = (e) => {
    selectedOrg = e.target.value;
    if (!selectedOrg) {
      hide($("robotConfig"));
      return;
    }
    
    window.location.href = `/robot-army/${selectedOrg}`;
  };

  const renderRobotCards = () => {
    console.log("[renderRobotCards] Starting...");
    const container = $("robotCards");
    if (!container) {
      console.error("[renderRobotCards] ERROR: robotCards container not found");
      return;
    }
    
    console.log("[renderRobotCards] Found container, rendering", robotDefinitions.length, "robots");
    
    try {
      console.log("[renderRobotCards] Creating robot cards HTML...");
      const cardsHtml = robotDefinitions.map(robot => {
        console.log("[renderRobotCards] Creating card for robot:", robot.id);
        return createRobotCard(robot);
      }).join("");
      
      console.log("[renderRobotCards] Setting container innerHTML, length:", cardsHtml.length);
      container.innerHTML = cardsHtml;
      
      console.log("[renderRobotCards] Adding event listeners...");
      robotDefinitions.forEach(robot => {
        const toggle = $(`toggle-${robot.id}`);
        if (toggle) {
          toggle.addEventListener("change", (e) => {
            onRobotToggle(robot.id, e.target.checked);
          });
        }
        
        const previewBtn = $(`preview-${robot.id}`);
        if (previewBtn) {
          previewBtn.addEventListener("click", () => showRobotPreview(robot));
        }
        
        if (robot.id === "slackchan" || robot.id === "slackdm") {
          const addBtn = $(`add-mapping-${robot.id}`);
          if (addBtn) {
            addBtn.addEventListener("click", (e) => {
              e.preventDefault();
              addMapping(robot.id);
            });
          }
        }
      });
      
      const exportBtn = $("exportConfig");
      if (exportBtn) {
        exportBtn.addEventListener("click", exportConfiguration);
      }
    } catch (error) {
      console.error("Error in renderRobotCards:", error);
    }
  };

  const createRobotCard = (robot) => {
    console.log(`[createRobotCard] Creating card for robot: ${robot.id}`);
    const isEnabled = robotConfigs[robot.id]?.enabled || false;
    console.log(`[createRobotCard] Robot ${robot.id} enabled:`, isEnabled);
    
    const configHtml = renderRobotConfig(robot);
    console.log(`[createRobotCard] Config HTML length for ${robot.id}:`, configHtml.length);
    
    return `
      <div class="robot-card ${isEnabled ? 'robot-enabled' : ''}">
        <div class="robot-header">
          <div class="robot-main">
            <div class="robot-icon">${robot.icon}</div>
            <div class="robot-info">
              <div class="robot-title-row">
                <h3 class="robot-name">${robot.name}</h3>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-${robot.id}" ${isEnabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <p class="robot-description">${robot.description}</p>
            </div>
          </div>
        </div>
        
        <div class="robot-content">
          <div class="robot-config ${isEnabled ? '' : 'robot-config-disabled'}">
            ${configHtml}
          </div>
          <div class="robot-actions">
            <button id="preview-${robot.id}" class="btn-preview" title="Dry-run mode: See what actions this bot would take if enabled">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Preview Actions
            </button>
          </div>
        </div>
      </div>
    `;
  };

  const renderRobotConfig = (robot) => {
    if (!robot.config) return '';
    
    const configs = Array.isArray(robot.config) ? robot.config : [robot.config];
    
    return configs.map(config => {
      switch (config.type) {
        case 'select':
          return `
            <div class="robot-option">
              <label>${config.label}</label>
              <select id="config-${robot.id}-select">
                ${config.options.map(opt => 
                  `<option value="${opt.value}" ${opt.value === config.default ? 'selected' : ''}>${opt.label}</option>`
                ).join('')}
              </select>
            </div>
          `;
          
        case 'checkboxes':
          return `
            <div class="robot-option">
              <label>${config.label}</label>
              <div class="robot-checkbox-group">
                ${config.options.map(opt => `
                  <div class="robot-checkbox">
                    <input type="checkbox" id="config-${robot.id}-${opt.id}" ${opt.default ? 'checked' : ''}>
                    <label for="config-${robot.id}-${opt.id}">${opt.label}</label>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          
        case 'checkbox':
          return `
            <div class="robot-option">
              <div class="robot-checkbox">
                <input type="checkbox" id="config-${robot.id}-checkbox" ${config.default ? 'checked' : ''}>
                <label for="config-${robot.id}-checkbox">${config.label}</label>
              </div>
            </div>
          `;
          
        case 'text':
          return `
            <div class="robot-option">
              <label>${config.label}</label>
              <input type="text" id="config-${robot.id}-text" placeholder="${config.placeholder || ''}">
            </div>
          `;
          
        case 'mappings':
          return `
            <div class="robot-option">
              <label>${config.label}</label>
              <div id="mappings-${robot.id}" class="robot-mappings">
                <!-- Mappings will be added here -->
              </div>
              <a href="#" id="add-mapping-${robot.id}" class="add-mapping">
                Add mapping
              </a>
            </div>
          `;
          
        case 'toggle':
          return '';
          
        default:
          return '';
      }
    }).join('');
  };

  const onRobotToggle = (robotId, enabled) => {
    console.log(`[onRobotToggle] Robot ${robotId} toggled to:`, enabled);
    
    if (!robotConfigs[robotId]) {
      robotConfigs[robotId] = {};
    }
    robotConfigs[robotId].enabled = enabled;
    console.log(`[onRobotToggle] Updated config for ${robotId}:`, robotConfigs[robotId]);
    
    const card = document.querySelector(`#toggle-${robotId}`).closest('.robot-card');
    const config = card.querySelector('.robot-config');
    
    if (enabled) {
      card.classList.add('robot-enabled');
      config.classList.remove('robot-config-disabled');
    } else {
      card.classList.remove('robot-enabled');
      config.classList.add('robot-config-disabled');
    }
  };

  const addMapping = (robotId) => {
    const container = $(`mappings-${robotId}`);
    if (!container) return;
    
    const mappingId = `mapping-${robotId}-${Date.now()}`;
    const robot = robotDefinitions.find(r => r.id === robotId);
    const config = Array.isArray(robot.config) ? robot.config.find(c => c.type === 'mappings') : null;
    
    if (!config) return;
    
    const mappingHtml = `
      <div class="robot-mapping" id="${mappingId}">
        <input type="text" placeholder="${config.placeholder1}">
        <input type="text" placeholder="${config.placeholder2}">
        <button onclick="window.App.removeMapping('${mappingId}')" aria-label="Remove mapping"></button>
      </div>
    `;
    
    container.insertAdjacentHTML('beforeend', mappingHtml);
  };

  const removeMapping = (mappingId) => {
    const mapping = $(mappingId);
    if (mapping) mapping.remove();
  };

  const showRobotPreview = (robot) => {
    const previewSteps = generatePreviewSteps(robot);
    const message = `
${robot.name} Preview:

${previewSteps.join('\n')}
    `;
    alert(message);
  };

  const generatePreviewSteps = (robot) => {
    switch (robot.id) {
      case 'autoassign':
        const reviewerCount = document.getElementById(`config-${robot.id}-select`)?.value || '2';
        return [
          `1. Analyze changed files in the PR`,
          `2. Find contributors who have recently modified the same files`,
          `3. Calculate expertise score based on commit frequency and recency`,
          `4. Select top ${reviewerCount} reviewer(s) based on expertise`,
          `5. Automatically assign selected reviewer(s) to the PR`
        ];
        
      case 'autoapprove':
        return [
          `1. Check if PR author matches approval criteria`,
          `2. Calculate total lines changed (additions + deletions)`,
          `3. If criteria met and changes are within limit, add approval`,
          `4. Add comment explaining automatic approval`
        ];
        
      case 'compliancebot':
        return [
          `1. Monitor for merged pull requests`,
          `2. Check if PR had required approvals`,
          `3. If merged without approval, add "TBR" label`,
          `4. Find suitable reviewers for post-merge review`,
          `5. Notify reviewers and create audit trail`
        ];
        
      case 'slackchan':
        return [
          `1. Detect new pull request or review request`,
          `2. Match repository to configured Slack channel`,
          `3. Wait for CI tests to pass (if enabled)`,
          `4. Send formatted message to Slack channel`,
          `5. Include PR title, author, and review link`
        ];
        
      case 'slackdm':
        return [
          `1. Detect when user is assigned as reviewer`,
          `2. Look up user's Slack handle in mapping`,
          `3. Wait for CI tests to pass (if enabled)`,
          `4. Send direct message on Slack`,
          `5. Include PR details and direct review link`
        ];
        
      case 'reassign':
        const days = document.getElementById(`config-${robot.id}-select`)?.value || '5';
        return [
          `1. Check age of all open PRs with pending reviews`,
          `2. Identify PRs blocked for more than ${days} days`,
          `3. Remove inactive reviewers`,
          `4. Find and assign new suitable reviewers`,
          `5. Notify both old and new reviewers of the change`
        ];
        
      case 'testbot':
        return [
          `1. Monitor PRs for failing tests`,
          `2. Analyze test failure patterns`,
          `3. Suggest common fixes based on error type`,
          `4. Add helpful comments with debugging steps`,
          `5. Link to relevant documentation or similar fixes`
        ];
        
      case 'autoclose':
        const closeDays = document.getElementById(`config-${robot.id}-select`)?.value || '90';
        return [
          `1. Scan all open pull requests`,
          `2. Check last activity date on each PR`,
          `3. Identify PRs with no activity for ${closeDays} days`,
          `4. Add warning comment 7 days before closing`,
          `5. Close PR and add explanation comment`
        ];
        
      default:
        return ['No preview available'];
    }
  };

  const exportConfiguration = () => {
    const config = generateYAMLConfig();
    const yamlContent = $("yamlContent");
    if (yamlContent) {
      yamlContent.textContent = config;
    }
    show($("yamlModal"));
  };

  const generateYAMLConfig = () => {
    const enabledRobots = robotDefinitions.filter(robot => 
      robotConfigs[robot.id]?.enabled
    );
    
    if (enabledRobots.length === 0) {
      return '# No robots enabled\n';
    }
    
    let yaml = `# CodeGroove Configuration
# Generated by Ready to Review Dashboard
# Organization: ${selectedOrg}

version: 1
robots:
`;
    
    enabledRobots.forEach(robot => {
      yaml += `\n  ${robot.id}:\n`;
      yaml += `    enabled: true\n`;
      
      const configs = Array.isArray(robot.config) ? robot.config : [robot.config];
      
      configs.forEach(config => {
        switch (config.type) {
          case 'select':
            const selectValue = document.getElementById(`config-${robot.id}-select`)?.value;
            if (selectValue) {
              yaml += `    ${robot.id === 'autoassign' ? 'reviewers' : robot.id === 'reassign' ? 'days' : robot.id === 'autoclose' ? 'days' : 'value'}: ${selectValue}\n`;
            }
            break;
            
          case 'checkboxes':
            if (config.options) {
              const selected = config.options.filter(opt => 
                document.getElementById(`config-${robot.id}-${opt.id}`)?.checked
              );
              if (selected.length > 0) {
                yaml += `    approve_authors:\n`;
                selected.forEach(opt => {
                  yaml += `      - ${opt.id}\n`;
                });
              }
            }
            break;
            
          case 'checkbox':
            const isChecked = document.getElementById(`config-${robot.id}-checkbox`)?.checked;
            yaml += `    wait_for_tests: ${isChecked}\n`;
            break;
            
          case 'text':
            const textValue = document.getElementById(`config-${robot.id}-text`)?.value;
            if (textValue) {
              yaml += `    topic_filter: ${textValue}\n`;
            }
            break;
            
          case 'mappings':
            const mappingsContainer = $(`mappings-${robot.id}`);
            if (mappingsContainer) {
              const mappings = mappingsContainer.querySelectorAll('.robot-mapping');
              if (mappings.length > 0) {
                yaml += `    mappings:\n`;
                mappings.forEach(mapping => {
                  const inputs = mapping.querySelectorAll('input');
                  if (inputs.length === 2 && inputs[0].value && inputs[1].value) {
                    yaml += `      ${inputs[0].value}: ${inputs[1].value}\n`;
                  }
                });
              }
            }
            break;
        }
      });
    });
    
    return yaml;
  };

  const closeYAMLModal = () => {
    hide($("yamlModal"));
  };

  const copyYAML = () => {
    const yamlContent = $("yamlContent");
    if (yamlContent) {
      navigator.clipboard.writeText(yamlContent.textContent).then(() => {
        const copyBtn = $("copyYAML");
        if (copyBtn) {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        }
      });
    }
  };

  const saveRobotConfig = () => {
    robotDefinitions.forEach(robot => {
      if (!robotConfigs[robot.id]) {
        robotConfigs[robot.id] = { enabled: false, config: {} };
      }
      
      const configs = Array.isArray(robot.config) ? robot.config : [robot.config];
      
      configs.forEach(config => {
        switch (config.type) {
          case 'select':
            const selectEl = document.getElementById(`config-${robot.id}-select`);
            if (selectEl) {
              robotConfigs[robot.id].config.select = selectEl.value;
            }
            break;
            
          case 'checkboxes':
            robotConfigs[robot.id].config.checkboxes = {};
            config.options.forEach(opt => {
              const checkEl = document.getElementById(`config-${robot.id}-${opt.id}`);
              if (checkEl) {
                robotConfigs[robot.id].config.checkboxes[opt.id] = checkEl.checked;
              }
            });
            break;
            
          case 'checkbox':
            const checkEl = document.getElementById(`config-${robot.id}-checkbox`);
            if (checkEl) {
              robotConfigs[robot.id].config.checkbox = checkEl.checked;
            }
            break;
            
          case 'text':
            const textEl = document.getElementById(`config-${robot.id}-text`);
            if (textEl) {
              robotConfigs[robot.id].config.text = textEl.value;
            }
            break;
            
          case 'mappings':
            const mappingsContainer = $(`mappings-${robot.id}`);
            if (mappingsContainer) {
              const mappings = [];
              const mappingEls = mappingsContainer.querySelectorAll('.robot-mapping');
              mappingEls.forEach(mapping => {
                const inputs = mapping.querySelectorAll('input');
                if (inputs.length === 2 && inputs[0].value && inputs[1].value) {
                  mappings.push({
                    from: inputs[0].value,
                    to: inputs[1].value
                  });
                }
              });
              robotConfigs[robot.id].config.mappings = mappings;
            }
            break;
        }
      });
    });
  };

  const resetRobotConfig = () => {
    robotConfigs = {};
    robotDefinitions.forEach(robot => {
      robotConfigs[robot.id] = {
        enabled: false,
        config: {}
      };
    });
    renderRobotCards();
  };

  return {
    showNotificationsPage,
    showSettingsPage,
    removeMapping,
    closeYAMLModal,
    copyYAML,
    saveRobotConfig,
    resetRobotConfig,
    robotDefinitions,
    robotConfigs,
  };
})();