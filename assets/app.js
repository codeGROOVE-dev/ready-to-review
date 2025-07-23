// Ready To Review - Modern ES6+ Application
console.log('[App] Starting module imports...');
import { $, $$, show, hide, showToast } from './utils.js';
import { Auth } from './auth.js';
console.log('[App] Auth module imported:', Auth);
import { User } from './user.js';
console.log('[App] User module imported:', User);
import { Stats } from './stats.js';
console.log('[App] Stats module imported:', Stats);
import { Robots } from './robots.js';
console.log('[App] Robots module imported:', Robots);

const App = (() => {
  "use strict";
  console.log('[App] Initializing App module...');

  // State Management
  const state = {
    currentUser: null,
    viewingUser: null,
    accessToken: Auth.getStoredToken(),
    organizations: [],
    pullRequests: {
      incoming: [],
      outgoing: [],
    },
    isDemoMode: false,
  };

  // Parse URL to get viewing context
  const parseURL = () => {
    const path = window.location.pathname;

    // Check for robot page patterns: /robots or /robots/gh/org
    if (path === '/robots') {
      return {
        org: null,
        username: state.currentUser?.login,
        isSettings: true,
      };
    }
    const robotsMatch = path.match(/^\/robots\/gh\/([^\/]+)$/);
    if (robotsMatch) {
      const [, org] = robotsMatch;
      return {
        org: org === '*' ? null : org,
        username: state.currentUser?.login,
        isSettings: true,
      };
    }

    // Check for stats page patterns: /stats or /stats/gh/org
    if (path === '/stats') {
      return {
        org: null,
        username: state.viewingUser?.login || state.currentUser?.login,
        isStats: true,
      };
    }
    const statsMatch = path.match(/^\/stats\/gh\/([^\/]+)$/);
    if (statsMatch) {
      const [, org] = statsMatch;
      return {
        org: org === '*' ? null : org,
        username: state.viewingUser?.login || state.currentUser?.login,
        isStats: true,
      };
    }

    // Check for notifications page patterns: /notifications or /notifications/gh/org
    if (path === '/notifications') {
      return {
        org: null,
        username: state.currentUser?.login,
        isNotifications: true,
      };
    }
    const notificationsMatch = path.match(/^\/notifications\/gh\/([^\/]+)$/);
    if (notificationsMatch) {
      const [, org] = notificationsMatch;
      return {
        org: org === '*' ? null : org,
        username: state.currentUser?.login,
        isNotifications: true,
      };
    }

    // Check for user dashboard pattern: /u/gh/org/username
    const userMatch = path.match(/^\/u\/gh\/([^\/]+)\/([^\/]+)$/);
    if (userMatch) {
      const [, org, username] = userMatch;
      return {
        org: org === '*' ? null : org,
        username: username,
        isStats: false,
      };
    }

    return null;
  };

  // DOM Helpers are imported from utils.js

  // UI Functions
  const showMainContent = () => {
    hide($("loginPrompt"));
    show($("prSections"));
  };

  const showLoginPrompt = () => {
    show($("loginPrompt"));
    hide($("prSections"));
    hide($("emptyState"));
  };

  // Hamburger Menu Functions
  let hamburgersSetup = false;
  
  const updateHamburgerMenuLinks = () => {
    const dashboardLink = $("dashboardLink");
    const statsLink = $("statsLink");
    const settingsLink = $("settingsLink");
    const notificationsLink = $("notificationsLink");
    const orgSelect = $("orgSelect");
    const urlContext = parseURL();
    const { username, org: urlOrg } = urlContext || {};
    
    // Prefer org from URL over dropdown value
    const selectedOrg = urlOrg || orgSelect?.value;
    
    const currentUser = state.currentUser || state.viewingUser;
    const defaultUsername = currentUser?.login || '';
    const targetUsername = username || defaultUsername;
    
    if (dashboardLink && targetUsername) {
      dashboardLink.href = `/u/gh/${selectedOrg || '*'}/${targetUsername}`;
    }
    
    if (statsLink) {
      statsLink.href = selectedOrg ? `/stats/gh/${selectedOrg}` : '/stats';
    }
    
    if (settingsLink) {
      settingsLink.href = selectedOrg ? `/robots/gh/${selectedOrg}` : '/robots';
    }
    
    if (notificationsLink) {
      notificationsLink.href = selectedOrg ? `/notifications/gh/${selectedOrg}` : '/notifications';
    }
  };
  
  const setupHamburgerMenu = () => {
    if (hamburgersSetup) return;

    const hamburgerBtn = $("hamburgerMenu");
    const slideMenu = $("slideMenu");
    const closeMenuBtn = $("closeMenu");
    const menuBackdrop = $("menuBackdrop");
    const dashboardLink = $("dashboardLink");
    const statsLink = $("statsLink");

    if (!hamburgerBtn || !slideMenu) return;

    const openMenu = () => {
      slideMenu.classList.add("open");
      menuBackdrop.classList.add("show");
      hamburgerBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    };

    const closeMenu = () => {
      slideMenu.classList.remove("open");
      menuBackdrop.classList.remove("show");
      hamburgerBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    };

    hamburgerBtn.addEventListener("click", openMenu);
    closeMenuBtn?.addEventListener("click", closeMenu);
    menuBackdrop?.addEventListener("click", closeMenu);

    hamburgersSetup = true;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && slideMenu.classList.contains("open")) {
        closeMenu();
      }
    });

    // Set up initial links
    updateHamburgerMenuLinks();
    
    // Set active states based on current path
    const path = window.location.pathname;
    if (dashboardLink) {
      if (path === '/' || path.startsWith('/u/')) {
        dashboardLink.classList.add("active");
      }
      
      dashboardLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = dashboardLink.href;
      });
    }

    if (statsLink) {
      if (path.startsWith('/stats')) {
        statsLink.classList.add("active");
      }

      statsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = statsLink.href;
      });
    }
    
    const notificationsLink = $("notificationsLink");
    if (notificationsLink) {
      if (path.startsWith('/notifications')) {
        notificationsLink.classList.add("active");
      }
      
      notificationsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = notificationsLink.href;
      });
    }
    
    const settingsLink = $("settingsLink");
    if (settingsLink) {
      if (path.startsWith('/robots')) {
        settingsLink.classList.add("active");
      }
      
      settingsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = settingsLink.href;
      });
    }
  };

  // Event handlers
  const handleOrgChange = () => {
    console.log("[DEBUG] handleOrgChange called");
    const orgSelect = $("orgSelect");
    const selectedOrg = orgSelect?.value;
    const path = window.location.pathname;
    const urlContext = parseURL();
    
    console.log("[DEBUG] handleOrgChange details:", {
      orgSelectExists: !!orgSelect,
      selectedOrg,
      path,
      urlContext
    });
    
    // For PR dashboard pages, update in place without navigation
    if (urlContext && urlContext.username && !urlContext.isStats && !urlContext.isSettings) {
      console.log("[DEBUG] Taking PR dashboard path");
      // Update URL without reload using pushState
      const newUrl = `/u/gh/${selectedOrg || '*'}/${urlContext.username}`;
      window.history.pushState({}, '', newUrl);
      
      // Just re-render the PR sections with the new filter
      User.updatePRSections(state);
      
      // Update hamburger menu links to reflect new org
      updateHamburgerMenuLinks();
      
      return;
    }
    
    // Update hamburger menu links when org changes
    updateHamburgerMenuLinks();
    
    // Navigate for other page types that require full reload
    if (path.startsWith('/stats')) {
      console.log("[DEBUG] Taking stats path");
      window.location.href = selectedOrg ? `/stats/gh/${selectedOrg}` : '/stats';
    } else if (path.startsWith('/robots')) {
      console.log("[DEBUG] Taking robots path");
      window.location.href = selectedOrg ? `/robots/gh/${selectedOrg}` : '/robots';
    } else if (path.startsWith('/notifications')) {
      console.log("[DEBUG] Taking notifications path");
      window.location.href = selectedOrg ? `/notifications/gh/${selectedOrg}` : '/notifications';
    } else {
      console.log("[DEBUG] Taking default path");
      // For root or unknown pages, go to user dashboard
      const currentUser = state.currentUser || state.viewingUser;
      if (currentUser?.login) {
        window.location.href = `/u/gh/${selectedOrg || '*'}/${currentUser.login}`;
      }
    }
  };

  const handleSearch = () => {
    User.handleSearch();
  };

  const handleFilterChange = (filter, section) => {
    User.handleFilterChange(filter, section);
  };

  const handlePRAction = async (action, prId) => {
    await User.handlePRAction(action, prId, state, Auth.githubAPI, showToast);
  };

  const handleKeyboardShortcuts = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const searchInput = $("searchInput");
      if (searchInput) searchInput.focus();
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      const searchInput = $("searchInput");
      if (searchInput) searchInput.focus();
    }
  };

  // Toast notifications are imported from utils.js

  // Auth related functions
  const initiateLogin = () => {
    showGitHubAppModal();
  };

  const showGitHubAppModal = () => {
    console.log('[App.showGitHubAppModal] Called');
    Auth.showGitHubAppModal();
  };

  const closeGitHubAppModal = () => {
    Auth.closeGitHubAppModal();
  };

  const proceedWithOAuth = () => {
    Auth.proceedWithOAuth();
  };

  const initiatePATLogin = () => {
    console.log('[App.initiatePATLogin] Called');
    Auth.initiatePATLogin();
  };

  const closePATModal = () => {
    Auth.closePATModal();
  };

  const submitPAT = async () => {
    await Auth.submitPAT();
  };

  const logout = () => {
    Auth.logout();
  };

  // Load current user
  const loadCurrentUser = async () => {
    state.currentUser = await Auth.loadCurrentUser();
  };

  // GitHub API wrapper that uses Auth module
  const githubAPI = async (endpoint, options = {}) => {
    try {
      const response = await Auth.githubAPI(endpoint, options);
      
      if (!response.ok) {
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get(
            "X-RateLimit-Remaining",
          );
          const rateLimitReset = response.headers.get("X-RateLimit-Reset");

          if (rateLimitRemaining === "0") {
            const resetTime = new Date(parseInt(rateLimitReset) * 1000);
            const now = new Date();
            const minutesUntilReset = Math.ceil((resetTime - now) / 60000);

            const error = new Error(
              `GitHub API rate limit exceeded. Resets in ${minutesUntilReset} minutes.`,
            );
            error.isRateLimit = true;
            error.resetTime = resetTime;
            error.minutesUntilReset = minutesUntilReset;
            throw error;
          }
        }

        let errorMessage = `API Error: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.message) {
            errorMessage = `GitHub error: ${errorData.message}`;
          } else if (
            errorData.errors &&
            Array.isArray(errorData.errors) &&
            errorData.errors.length > 0
          ) {
            const firstError = errorData.errors[0];
            if (firstError.message) {
              errorMessage = `GitHub error: ${firstError.message}`;
            }
          }
        } catch (e) {
          // Use default message
        }

        throw new Error(errorMessage);
      }

      return response.json();
    } catch (error) {
      // Show toast notification for API errors
      if (error.isRateLimit) {
        showToast(`Rate limit exceeded. Try again in ${error.minutesUntilReset} minutes.`, "error");
      } else if (error.message.includes("secondary rate limit")) {
        showToast("GitHub API limit reached. Please wait a few minutes.", "error");
      } else if (!error.message.includes("401")) {
        // Don't show toast for auth errors as they're handled elsewhere
        showToast(error.message, "error");
      }
      throw error;
    }
  };

  // Demo Mode
  const initializeDemoMode = () => {
    if (typeof DEMO_DATA === "undefined") {
      console.error("Demo data not loaded");
      return;
    }

    state.isDemoMode = true;
    state.currentUser = DEMO_DATA.user;
    state.viewingUser = DEMO_DATA.user;
    state.pullRequests = DEMO_DATA.pullRequests;

    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];

    allPRs.forEach((pr) => {
      pr.age_days = Math.floor(
        (Date.now() - new Date(pr.created_at)) / 86400000,
      );

      const labelNames = (pr.labels || []).map((l) => l.name);

      const unblockAction = {};
      if (labelNames.includes("blocked on you")) {
        unblockAction[state.currentUser.login] = {
          kind: "review",
          critical: true,
          reason: "Requested changes need to be addressed",
          ready_to_notify: true,
        };
      }

      const checks = {
        total: 5,
        passing: labelNames.includes("tests passing") ? 5 : 3,
        failing: labelNames.includes("tests failing") ? 2 : 0,
        pending: 0,
        waiting: 0,
        ignored: 0,
      };

      const sizeMap = {
        "size/XS": "XS",
        "size/S": "S",
        "size/M": "M",
        "size/L": "L",
        "size/XL": "XL",
      };
      let size = "M";
      for (const [label, sizeValue] of Object.entries(sizeMap)) {
        if (labelNames.includes(label)) {
          size = sizeValue;
          break;
        }
      }

      pr.turnData = {
        pr_state: {
          unblock_action: unblockAction,
          updated_at: pr.updated_at,
          last_activity: {
            kind: "comment",
            author: pr.user.login,
            message: "Latest activity on this PR",
            timestamp: pr.updated_at,
          },
          checks: checks,
          unresolved_comments: labelNames.includes("unresolved comments")
            ? 3
            : 0,
          size: size,
          draft: pr.draft || false,
          ready_to_merge:
            labelNames.includes("ready") &&
            !labelNames.includes("blocked on you"),
          merge_conflict: labelNames.includes("merge conflict"),
          approved: labelNames.includes("approved"),
          tags: [],
        },
        timestamp: new Date().toISOString(),
        commit: "demo-version",
      };

      pr.prState = pr.turnData.pr_state;
      pr.status_tags = User.getStatusTags(pr);
    });

    const urlContext = parseURL();
    if (!urlContext || !urlContext.username) {
      window.location.href = `/u/gh/*/${DEMO_DATA.user.login}?demo=true`;
      return;
    }

    User.updateUserDisplay(state, initiateLogin);
    User.updatePRSections(state);
    User.updateOrgFilter(state, parseURL, githubAPI);
    showMainContent();
  };

  // Initialize
  const init = async () => {
    console.log("[App.init] Starting application initialization");
    console.log("[App.init] Current URL:", window.location.href);
    
    const urlParams = new URLSearchParams(window.location.search);
    const demo = urlParams.get("demo");
    console.log("[App.init] Demo mode:", !!demo);

    const urlContext = parseURL();
    console.log("[App.init] URL context:", urlContext);

    // Handle stats page routing
    if (urlContext && urlContext.isStats) {
      console.log("[App.init] Stats page detected, showing stats");
      await Stats.showStatsPage(state, githubAPI, loadCurrentUser, 
        () => User.updateUserDisplay(state, initiateLogin), 
        setupHamburgerMenu, 
        () => User.updateOrgFilter(state, parseURL, githubAPI),
        handleOrgChange, handleSearch, parseURL, User.loadUserOrganizations);
      return;
    }

    // Handle notifications page routing
    const path = window.location.pathname;
    if (path === '/notifications' || path.match(/^\/notifications\/gh\/[^\/]+$/)) {
      const token = Auth.getStoredToken();
      if (token) {
        try {
          await loadCurrentUser();
          User.updateUserDisplay(state, initiateLogin);
          setupHamburgerMenu();
        } catch (error) {
          console.error("Failed to load user for notifications:", error);
        }
      }
      await Robots.showNotificationsPage(state, parseURL, githubAPI, User.updateOrgFilter);
      return;
    }

    // Handle robots page routing
    if (path === '/robots' || path.match(/^\/robots\/gh\/[^\/]+$/)) {
      const token = Auth.getStoredToken();
      if (!token) {
        showToast("Please login to configure Robot Army", "error");
        window.location.href = '/';
        return;
      }

      if (!state.currentUser) {
        try {
          await loadCurrentUser();
        } catch (error) {
          console.error("Failed to load user:", error);
          showToast("Failed to load user data", "error");
          window.location.href = '/';
          return;
        }
      }

      User.updateUserDisplay(state, initiateLogin);
      
      // Always update org filter to ensure dropdown is populated
      await User.updateOrgFilter(state, parseURL, githubAPI);
      
      console.log("[Robot Army] Calling showSettingsPage...");
      await Robots.showSettingsPage(state, setupHamburgerMenu, githubAPI, User.loadUserOrganizations, parseURL);
      return;
    }

    // Setup event listeners
    const loginBtn = $("loginBtn");
    if (loginBtn) loginBtn.addEventListener("click", initiateLogin);

    setupHamburgerMenu();

    const urlRedirect = urlParams.get("redirect");
    const orgSelect = $("orgSelect");
    const searchInput = $("searchInput");

    console.log("[DEBUG] Setting up event listeners", {
      orgSelectExists: !!orgSelect,
      currentPath: window.location.pathname,
      orgSelectValue: orgSelect?.value
    });

    orgSelect?.addEventListener("change", handleOrgChange);
    searchInput?.addEventListener("input", handleSearch);
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        searchInput.value = "";
        handleSearch();
        searchInput.blur();
      }
    });

    ["incoming", "outgoing"].forEach((section) => {
      const staleFilter = $(`${section}FilterStale`);
      const blockedFilter = $(`${section}FilterBlockedOthers`);
      staleFilter?.addEventListener("change", () =>
        handleFilterChange(`${section}FilterStale`, section),
      );
      blockedFilter?.addEventListener("change", () =>
        handleFilterChange(`${section}FilterBlockedOthers`, section),
      );
    });

    document.addEventListener("keydown", handleKeyboardShortcuts);
    document.addEventListener("click", async (e) => {
      if (!e.target.matches(".pr-action-btn")) return;

      e.preventDefault();
      const { action, prId } = e.target.dataset;
      await handlePRAction(action, prId);
    });

    // Note: Modal interactions are handled via inline onclick handlers in HTML
    // No additional event listeners needed here

    if ($("patInput")) {
      $("patInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") submitPAT();
      });
    }

    // Handle OAuth callback
    if (window.location.pathname === "/oauth/callback") {
      await Auth.handleOAuthCallback();
      return;
    }

    // Demo mode - only if explicitly requested
    if (demo === "true") {
      initializeDemoMode();
      return;
    }

    // Check for authentication
    if (!state.accessToken) {
      if (urlContext && urlContext.username && !urlContext.isStats && !urlContext.isSettings && !urlContext.isNotifications) {
        // Only load PRs for actual user PR dashboard pages
        try {
          state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
          
          showLoginPrompt();
          User.updateUserDisplay(state, initiateLogin);
          
          // Load public data
          await User.updateOrgFilter(state, parseURL, githubAPI);
          await User.loadPullRequests(state, githubAPI, state.isDemoMode);
          // Update org filter again after PRs are loaded to include PR organizations
          await User.updateOrgFilter(state, parseURL, githubAPI);
          showMainContent();
        } catch (error) {
          console.error("Failed to load user:", error);
          const errorMessage = error.message.includes("rate limit")
            ? "GitHub API rate limit exceeded. Please try again later or login for higher limits."
            : `Failed to load user ${urlContext.username}`;
          showToast(errorMessage, "error");
          showLoginPrompt();
        }
      } else {
        showLoginPrompt();
      }
      return;
    }

    // Authenticated flow
    try {
      await loadCurrentUser();

      // If at root URL, redirect to user's page
      if (!urlContext && state.currentUser) {
        console.log("[App.init] Redirecting from root to user page:", `/u/gh/*/${state.currentUser.login}`);
        window.location.href = `/u/gh/*/${state.currentUser.login}`;
        return;
      }

      if (urlContext && urlContext.username && urlContext.username !== state.currentUser.login) {
        try {
          state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
        } catch (error) {
          console.error("Error loading viewing user:", error);
          const errorMessage = error.message || "Failed to load user";
          showToast(errorMessage, "error");
        }
      }

      User.updateUserDisplay(state, initiateLogin);
      await User.updateOrgFilter(state, parseURL, githubAPI);
      
      // Only load PRs if we're on the PR dashboard page
      if (!urlContext || (!urlContext.isStats && !urlContext.isSettings && !urlContext.isNotifications)) {
        await User.loadPullRequests(state, githubAPI, state.isDemoMode);
        // Update org filter again after PRs are loaded to include PR organizations
        await User.updateOrgFilter(state, parseURL, githubAPI);
      }
      
      showMainContent();

      if (urlRedirect) {
        window.history.replaceState({}, "", urlRedirect);
      }
    } catch (error) {
      console.error("Initialization error:", error);
      showToast("Failed to initialize. Please try again.", "error");
      showLoginPrompt();
    }
  };

  // YAML modal functions
  const closeYAMLModal = () => {
    Robots.closeYAMLModal();
  };

  const copyYAML = () => {
    Robots.copyYAML();
    try {
      showToast("Configuration copied to clipboard!", "success");
    } catch (error) {
      showToast("Failed to copy to clipboard", "error");
    }
  };

  // Debug function to check modal state
  const debugModals = () => {
    console.log('[Debug] Checking modal states...');
    const githubModal = document.getElementById('githubAppModal');
    const patModal = document.getElementById('patModal');
    
    console.log('[Debug] GitHub App Modal:', {
      element: githubModal,
      exists: !!githubModal,
      hidden: githubModal?.hasAttribute('hidden'),
      display: githubModal?.style.display,
      computedDisplay: githubModal ? window.getComputedStyle(githubModal).display : 'N/A',
      visibility: githubModal ? window.getComputedStyle(githubModal).visibility : 'N/A',
      zIndex: githubModal ? window.getComputedStyle(githubModal).zIndex : 'N/A'
    });
    
    console.log('[Debug] PAT Modal:', {
      element: patModal,
      exists: !!patModal,
      hidden: patModal?.hasAttribute('hidden'),
      display: patModal?.style.display,
      computedDisplay: patModal ? window.getComputedStyle(patModal).display : 'N/A',
      visibility: patModal ? window.getComputedStyle(patModal).visibility : 'N/A',
      zIndex: patModal ? window.getComputedStyle(patModal).zIndex : 'N/A'
    });
  };

  // Public API
  return {
    state,
    init,
    logout,
    initiateLogin: () => (window.initiateLogin = initiateLogin),
    showGitHubAppModal,
    closeGitHubAppModal,
    proceedWithOAuth,
    initiatePATLogin,
    closePATModal,
    submitPAT,
    removeMapping: Robots.removeMapping,
    closeYAMLModal,
    copyYAML,
    debugModals, // Expose debug function
    updateHamburgerMenuLinks, // Expose for stats page
    handleOrgChange, // Expose for robots and notifications pages
  };
})();

// Expose global functions for onclick handlers immediately
window.App = App;
console.log('[App] window.App exposed:', window.App);
console.log('[App] window.App.showGitHubAppModal:', window.App.showGitHubAppModal);
console.log('[App] window.App.initiatePATLogin:', window.App.initiatePATLogin);

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", App.init);
} else {
  App.init();
}