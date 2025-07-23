// Ready To Review - Modern ES6+ Application

const App = (() => {
  "use strict";

  // Configuration
  const CONFIG = {
    CLIENT_ID: "Iv23liYmAKkBpvhHAnQQ",
    API_BASE: "https://api.github.com",
    STORAGE_KEY: "github_token",
    COOKIE_KEY: "github_pat",
    SEARCH_LIMIT: 100,
    OAUTH_REDIRECT_URI: window.location.origin + "/oauth/callback",
  };

  // Cookie Functions
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
  }

  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  function getStoredToken() {
    // Check cookie first (for PAT)
    const cookieToken = getCookie(CONFIG.COOKIE_KEY);
    if (cookieToken) return cookieToken;

    // Fall back to localStorage (for OAuth)
    return localStorage.getItem(CONFIG.STORAGE_KEY);
  }

  function storeToken(token, useCookie = false) {
    if (useCookie) {
      setCookie(CONFIG.COOKIE_KEY, token, 365); // 1 year
    } else {
      localStorage.setItem(CONFIG.STORAGE_KEY, token);
    }
    state.accessToken = token;
  }

  function clearToken() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    deleteCookie(CONFIG.COOKIE_KEY);
    state.accessToken = null;
  }

  // State Management
  const state = {
    currentUser: null,
    viewingUser: null, // User whose dashboard we're viewing
    accessToken: getStoredToken(),
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

    // Check for stats page pattern: /github/(all|org)/stats
    const statsMatch = path.match(/^\/github\/(all|[^\/]+)\/stats$/);
    if (statsMatch) {
      const [, orgOrAll] = statsMatch;
      return {
        org: orgOrAll === "all" ? null : orgOrAll,
        username: state.viewingUser?.login || state.currentUser?.login,
        isStats: true,
      };
    }

    // Check for legacy stats pattern: /github/(all|org)/username/stats
    const legacyStatsMatch = path.match(
      /^\/github\/(all|[^\/]+)\/([^\/]+)\/stats$/,
    );
    if (legacyStatsMatch) {
      const [, orgOrAll, username] = legacyStatsMatch;
      return {
        org: orgOrAll === "all" ? null : orgOrAll,
        username: username,
        isStats: true,
      };
    }

    // Check for regular dashboard pattern: /github/(all|org)/username
    const match = path.match(/^\/github\/(all|[^\/]+)\/([^\/]+)$/);
    if (match) {
      const [, orgOrAll, username] = match;
      return {
        org: orgOrAll === "all" ? null : orgOrAll,
        username: username,
        isStats: false,
      };
    }

    return null;
  };

  // DOM Helpers
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => document.querySelectorAll(selector);
  const show = (el) => el && el.removeAttribute("hidden");
  const hide = (el) => el && el.setAttribute("hidden", "");

  // Utilities
  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const formatTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;

    const years = Math.floor(seconds / 31536000);
    return `${years}y ago`;
  };

  const getAgeText = (pr) => {
    const days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "1d";
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;

    const years = Math.floor(days / 365);
    return `${years}y`;
  };

  const isStale = (pr) => {
    // Consider a PR stale if it hasn't been updated in 60 days
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(pr.updated_at)) / 86400000,
    );
    return daysSinceUpdate >= 60;
  };

  const isBlockedOnOthers = (pr) => {
    // PR is "blocked on others" if it has loaded data from turnserver but is NOT "blocked on you"
    if (!pr.status_tags || pr.status_tags.length === 0) return false;
    if (pr.status_tags.includes("loading")) return false; // Still loading from turnserver
    if (pr.status_tags.includes("blocked on you")) return false; // This is blocked on you, not others

    // If we get here, turnserver has responded and it's not blocked on you
    return true;
  };

  // API Functions
  const githubAPI = async (endpoint, options = {}) => {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      ...options.headers,
    };

    if (state.accessToken) {
      headers["Authorization"] = `token ${state.accessToken}`;
    }

    const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        handleAuthError();
      }

      // Check for rate limit error
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

      // Try to parse error details from GitHub
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
          // Get the first error message from the errors array
          const firstError = errorData.errors[0];
          if (firstError.message) {
            errorMessage = `GitHub error: ${firstError.message}`;
          }
        }
      } catch (e) {
        // If we can't parse the error response, use the default message
      }

      throw new Error(errorMessage);
    }

    return response.json();
  };

  // Fetch all pages of a GitHub search query
  const githubSearchAll = async (searchPath, maxPages = 20) => {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const pagePath = searchPath.includes("?")
        ? `${searchPath}&page=${page}`
        : `${searchPath}?page=${page}`;

      const response = await githubAPI(pagePath);

      if (response.items && response.items.length > 0) {
        allItems.push(...response.items);

        // Check if we've fetched all results
        if (
          response.total_count <= allItems.length ||
          response.items.length < 100
        ) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return {
      items: allItems,
      total_count: allItems.length,
    };
  };

  const turnAPI = async (prUrl, updatedAt) => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Use GitHub token for Turn API authentication
    if (state.accessToken) {
      headers["Authorization"] = `Bearer ${state.accessToken}`;
    }

    try {
      const response = await fetch(
        "https://turn.ready-to-review.dev/v1/validate",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            url: prUrl,
            updated_at: updatedAt,
            user: state.currentUser?.login || "",
          }),
          mode: "cors",
        },
      );

      if (!response.ok) {
        console.warn(`Turn API error for ${prUrl}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.warn(`Turn API request failed for ${prUrl}:`, error);
      return null;
    }
  };

  const loadCurrentUser = async () => {
    state.currentUser = await githubAPI("/user");
  };

  const loadPullRequests = async () => {
    // Use viewingUser if set, otherwise use currentUser
    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) {
      console.error("No user to load PRs for");
      return;
    }

    // Make two separate queries since GitHub doesn't support complex OR queries
    const query1 = `is:open is:pr involves:${targetUser.login} archived:false`;
    const query2 = `is:open is:pr user:${targetUser.login} archived:false`;

    console.log("GitHub queries:");
    console.log(
      `  1. https://github.com/search?q=${encodeURIComponent(query1)}&type=pullrequests`,
    );
    console.log(
      `  2. https://github.com/search?q=${encodeURIComponent(query2)}&type=pullrequests`,
    );
    console.log(
      `Auth: ${state.accessToken ? (state.accessToken.startsWith("ghp_") ? "PAT" : "OAuth") : "none"}`,
    );

    // Execute both queries in parallel with pagination
    const [response1, response2] = await Promise.all([
      githubSearchAll(
        `/search/issues?q=${encodeURIComponent(query1)}&per_page=100`,
      ),
      githubSearchAll(
        `/search/issues?q=${encodeURIComponent(query2)}&per_page=100`,
      ),
    ]);

    // Merge and deduplicate results based on PR id
    const prMap = new Map();

    // Add PRs from first query
    response1.items.forEach((pr) => {
      prMap.set(pr.id, pr);
    });

    // Add PRs from second query (will overwrite duplicates)
    response2.items.forEach((pr) => {
      prMap.set(pr.id, pr);
    });

    // Convert back to array
    const allPRs = Array.from(prMap.values());

    console.log(`Found ${response1.items.length} PRs from involves query`);
    console.log(`Found ${response2.items.length} PRs from user repos query`);
    console.log(`Total unique PRs: ${allPRs.length}`);

    // Check for OAuth limitations
    const totalCount = response1.total_count + response2.total_count;
    if (
      state.accessToken &&
      !state.accessToken.startsWith("ghp_") &&
      totalCount > allPRs.length
    ) {
      console.info(
        `OAuth Apps may not show all PRs. Consider using a Personal Access Token.`,
      );
    }

    const prs = allPRs.map((pr) => ({
      ...pr,
      repository: {
        full_name: pr.repository_url.split("/repos/")[1],
      },
    }));

    // First pass: categorize PRs and render immediately
    state.pullRequests = {
      incoming: [],
      outgoing: [],
    };

    for (const pr of prs) {
      // Enhanced PR with calculated fields
      pr.age_days = Math.floor(
        (Date.now() - new Date(pr.created_at)) / 86400000,
      );
      pr.status_tags = getStatusTags(pr); // Will return ['loading'] initially

      // Include drafts in incoming/outgoing based on author
      // Use viewingUser if set, otherwise use currentUser
      const targetUser = state.viewingUser || state.currentUser;
      if (pr.user.login === targetUser.login) {
        state.pullRequests.outgoing.push(pr);
      } else {
        state.pullRequests.incoming.push(pr);
      }
    }

    // Render immediately with loading indicators
    updatePRSections();

    // Fetch PR details for size data in parallel with turn server
    const fetchPRDetails = async (pr) => {
      try {
        // Extract owner/repo/number from the PR URL
        const urlParts = pr.repository_url.split("/");
        const owner = urlParts[urlParts.length - 2];
        const repo = urlParts[urlParts.length - 1];

        const prDetails = await githubAPI(
          `/repos/${owner}/${repo}/pulls/${pr.number}`,
        );
        pr.additions = prDetails.additions;
        pr.deletions = prDetails.deletions;

        // Update just this PR card to show the size
        updateSinglePRCard(pr);
      } catch (error) {
        console.error(`Failed to fetch PR details for ${pr.html_url}:`, error);
      }
    };

    // Start fetching PR details for all PRs
    const detailPromises = prs.map((pr) => fetchPRDetails(pr));

    // Then fetch Turn API data asynchronously
    if (!state.isDemoMode) {
      const turnPromises = prs.map(async (pr) => {
        try {
          const turnResponse = await turnAPI(
            pr.html_url,
            new Date(pr.updated_at).toISOString(),
          );

          // Store the full response and extract pr_state
          pr.turnData = turnResponse;
          pr.prState = turnResponse?.pr_state;

          // Update status tags with real data
          pr.status_tags = getStatusTags(pr);

          // Use Turn API's last_activity if available
          const lastActivity = turnResponse?.pr_state?.last_activity;
          if (lastActivity) {
            pr.last_activity = {
              type: lastActivity.kind,
              message: lastActivity.message,
              timestamp: lastActivity.timestamp,
              actor: lastActivity.author,
            };
          }

          // Update just this PR card in the UI
          updateSinglePRCard(pr);
        } catch (error) {
          console.error(
            `Failed to load turn data for PR ${pr.html_url}:`,
            error,
          );
          pr.turnData = null;
          pr.status_tags = getStatusTags(pr);
          updateSinglePRCard(pr);
        }
      });

      // Wait for all turn API calls to complete
      await Promise.all(turnPromises);
    }

    // Wait for all PR detail fetches to complete
    await Promise.all(detailPromises);
  };

  const getStatusTags = (pr) => {
    // If we have turnData (even if empty), the API call completed
    if (pr.turnData !== undefined) {
      // If turnData is null or has no pr_state, return empty array
      if (!pr.turnData || !pr.turnData.pr_state) {
        return [];
      }

      const prState = pr.turnData.pr_state;
      const tags = [];

      // Add status flags from pr_state
      if (prState.draft) tags.push("draft");
      if (prState.ready_to_merge) tags.push("ready_to_merge");
      if (prState.merge_conflict) tags.push("merge_conflict");
      if (prState.approved) tags.push("approved");

      // Check if user is in unblock_action list
      if (prState.unblock_action && state.currentUser) {
        const userAction = prState.unblock_action[state.currentUser.login];
        if (userAction) {
          // Add "blocked on you" tag
          if (!tags.includes("blocked on you")) {
            tags.push("blocked on you");
          }

          // Add specific needs-X tag based on action kind
          const actionKind = userAction.kind;
          if (actionKind) {
            const kindLower = actionKind.toLowerCase();
            const needsMap = {
              review: "needs-review",
              approve: "needs-approval",
              respond: "needs-response",
              fix: "needs-fix",
              merge: "needs-merge",
              address: "needs-changes",
            };
            tags.push(needsMap[kindLower] || `needs-${kindLower}`);
          }
        }
      }

      // Add check status tags
      if (prState.checks) {
        if (prState.checks.failing > 0) tags.push("tests_failing");
        if (prState.checks.pending > 0) tags.push("tests_pending");
        if (prState.checks.waiting > 0) tags.push("tests_waiting");
      }

      // Normalize tag names - replace underscores with dashes
      return tags.map((tag) => tag.replace(/_/g, "-"));
    }

    // If turnData is undefined, we're still loading
    return ["loading"];
  };

  // UI Functions
  const updateUserDisplay = () => {
    const userInfo = $("userInfo");
    if (!userInfo) return;

    // Show whose dashboard we're viewing
    const viewingUser = state.viewingUser || state.currentUser;
    let displayContent = "";

    if (state.currentUser) {
      // User is logged in
      displayContent = `
        <img src="${state.currentUser.avatar_url}" alt="${state.currentUser.login}" class="user-avatar">
        <span class="user-name">${state.currentUser.name || state.currentUser.login}</span>
        <button onclick="App.logout()" class="btn btn-primary">Logout</button>
      `;
    } else if (viewingUser) {
      // Viewing another user's dashboard without being logged in
      displayContent = `
        <span class="user-name">Viewing: ${viewingUser.name || viewingUser.login}</span>
        <button id="loginBtn" class="btn btn-primary">Login</button>
      `;
    } else {
      // Not logged in and not viewing anyone
      displayContent = `<button id="loginBtn" class="btn btn-primary">Login with GitHub</button>`;
    }

    userInfo.innerHTML = displayContent;

    // Re-attach event listener if login button was recreated
    const loginBtn = $("loginBtn");
    if (loginBtn) {
      loginBtn.addEventListener("click", initiateLogin);
    }
  };

  const updateOrgFilter = () => {
    const orgSelect = $("orgSelect");
    if (!orgSelect) return;

    // Extract unique organizations from PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];

    const uniqueOrgs = [
      ...new Set(allPRs.map((pr) => pr.repository.full_name.split("/")[0])),
    ].sort();

    orgSelect.innerHTML = '<option value="">All Organizations</option>';
    uniqueOrgs.forEach((org) => {
      const option = document.createElement("option");
      option.value = org;
      option.textContent = org;
      orgSelect.appendChild(option);
    });

    // Restore selection from URL context
    const urlContext = parseURL();
    if (urlContext && urlContext.org && uniqueOrgs.includes(urlContext.org)) {
      orgSelect.value = urlContext.org;
    }
  };

  const updatePRSections = () => {
    let totalVisible = 0;

    ["incoming", "outgoing"].forEach((section) => {
      const prs = state.pullRequests[section];
      const countElement = $(`${section}Count`);
      const container = $(`${section}PRs`);

      const filtered = applyFilters(prs, section);

      if (countElement) {
        countElement.textContent =
          filtered.length < prs.length
            ? `${filtered.length} (${prs.length})`
            : prs.length;
      }

      totalVisible += filtered.length;
      renderPRList(container, prs, false, section);
    });

    updateFilterCounts();

    // Show/hide empty state
    const emptyState = $("emptyState");
    if (totalVisible === 0) show(emptyState);
    else hide(emptyState);
  };

  const updateFilterCounts = () => {
    ["incoming", "outgoing"].forEach((section) => {
      const prs = state.pullRequests[section];
      const staleCount = prs.filter(isStale).length;
      const blockedCount = prs.filter(isBlockedOnOthers).length;

      const staleLabel = $(`${section}FilterStale`)?.nextElementSibling;
      const blockedLabel = $(
        `${section}FilterBlockedOthers`,
      )?.nextElementSibling;

      if (staleLabel) staleLabel.textContent = `Include stale (${staleCount})`;
      if (blockedLabel)
        blockedLabel.textContent = `Include blocked on others (${blockedCount})`;
    });
  };

  const updateAverages = (section, filteredPRs) => {
    // Calculate average age for filtered PRs
    if (filteredPRs.length === 0) {
      const avgElement = $(`${section}Average`);
      if (avgElement) avgElement.textContent = "";
      return;
    }

    const avgAge =
      Math.round(
        filteredPRs.reduce((sum, pr) => sum + pr.age_days, 0) /
          filteredPRs.length,
      ) || 0;
    const avgElement = $(`${section}Average`);

    if (avgAge > 0 && avgElement) {
      avgElement.textContent = `avg ${avgAge}d open`;
    } else if (avgElement) {
      avgElement.textContent = "";
    }
  };

  const applyFilters = (prs, section) => {
    const orgSelect = $("orgSelect");
    const selectedOrg = orgSelect?.value;
    const showStale = getCookie(`${section}FilterStale`) !== "false";
    const showBlockedOthers =
      getCookie(`${section}FilterBlockedOthers`) !== "false";

    // Update checkbox states
    const staleCheckbox = $(`${section}FilterStale`);
    const blockedCheckbox = $(`${section}FilterBlockedOthers`);
    if (staleCheckbox) staleCheckbox.checked = showStale;
    if (blockedCheckbox) blockedCheckbox.checked = showBlockedOthers;

    let filtered = prs;
    if (selectedOrg)
      filtered = filtered.filter((pr) =>
        pr.repository.full_name.startsWith(selectedOrg + "/"),
      );
    if (!showStale) filtered = filtered.filter((pr) => !isStale(pr));
    if (!showBlockedOthers)
      filtered = filtered.filter((pr) => !isBlockedOnOthers(pr));

    return filtered;
  };

  const renderPRList = (container, prs, isDraft = false, section = "") => {
    if (!container) return;

    const filteredPRs = applyFilters(prs, section);

    // Sort by most recently updated with drafts at bottom
    const sortedPRs = [...filteredPRs].sort((a, b) => {
      // Drafts always go to bottom (using GitHub's draft field, not tags)
      if (a.draft && !b.draft) return 1;
      if (!a.draft && b.draft) return -1;

      // Within non-drafts or within drafts, apply priority sorting
      if (a.draft === b.draft) {
        // First priority: blocked on you (only for non-drafts)
        if (!a.draft && !b.draft) {
          if (
            a.status_tags?.includes("blocked on you") &&
            !b.status_tags?.includes("blocked on you")
          )
            return -1;
          if (
            !a.status_tags?.includes("blocked on you") &&
            b.status_tags?.includes("blocked on you")
          )
            return 1;

          // Second priority: ready to merge (only for non-drafts)
          if (
            a.status_tags?.includes("ready-to-merge") &&
            !b.status_tags?.includes("ready-to-merge")
          )
            return -1;
          if (
            !a.status_tags?.includes("ready-to-merge") &&
            b.status_tags?.includes("ready-to-merge")
          )
            return 1;
        }

        // Default: sort by updated_at (most recent first)
        return new Date(b.updated_at) - new Date(a.updated_at);
      }

      return 0;
    });

    container.innerHTML = sortedPRs.map((pr) => createPRCard(pr)).join("");

    // Update average for this section with filtered PRs
    if (section === "incoming" || section === "outgoing") {
      updateAverages(section, filteredPRs);
    }
  };

  const createPRCard = (pr) => {
    const state = getPRState(pr);
    const badges = buildBadges(pr);
    const ageText = getAgeText(pr);
    const reviewers = buildReviewers(pr.requested_reviewers || []);
    const needsAction = pr.status_tags?.includes("blocked on you");

    // Get activity type icon
    const getActivityIcon = (type) => {
      const icons = {
        commit:
          '<path d="M4 1.5H3a2 2 0 00-2 2V14a2 2 0 002 2h10a2 2 0 002-2V3.5a2 2 0 00-2-2h-1v1h1a1 1 0 011 1V14a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1h1v-1z"/><path d="M9.5 1a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h3zm-3-1A1.5 1.5 0 005 1.5v1A1.5 1.5 0 006.5 4h3A1.5 1.5 0 0011 2.5v-1A1.5 1.5 0 009.5 0h-3z"/><path d="M3.5 6.5A.5.5 0 014 7v1h3.5a.5.5 0 010 1H4v1a.5.5 0 01-1 0v-1H1.5a.5.5 0 010-1H3V7a.5.5 0 01.5-.5z"/><path d="M8 11a1 1 0 100-2 1 1 0 000 2z"/>',
        comment:
          '<path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zM2 0a2 2 0 00-2 2v12.793a.5.5 0 00.854.353l2.853-2.853A1 1 0 014.414 12H14a2 2 0 002-2V2a2 2 0 00-2-2H2z"/>',
        review:
          '<path d="M10.854 5.146a.5.5 0 010 .708l-3 3a.5.5 0 01-.708 0l-1.5-1.5a.5.5 0 11.708-.708L7.5 7.793l2.646-2.647a.5.5 0 01.708 0z"/><path d="M2 2a2 2 0 012-2h8a2 2 0 012 2v13.5a.5.5 0 01-.777.416L8 13.101l-5.223 2.815A.5.5 0 012 15.5V2zm2-1a1 1 0 00-1 1v12.566l4.723-2.482a.5.5 0 01.554 0L13 14.566V2a1 1 0 00-1-1H4z"/>',
        approve:
          '<path d="M10.97 4.97a.75.75 0 011.071 1.05l-3.992 4.99a.75.75 0 01-1.08.02L4.324 8.384a.75.75 0 111.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 01.02-.022z"/><path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0 1A8 8 0 108 0a8 8 0 000 16z"/>',
        merge:
          '<path d="M5 3.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm0 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm8.25-6.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/><path d="M1.75 5.5v5a.75.75 0 001.5 0v-5a.75.75 0 00-1.5 0zm6.5-3.25a.75.75 0 000 1.5h1.5v2.5a2.25 2.25 0 01-2.25 2.25h-1a.75.75 0 000 1.5h1a3.75 3.75 0 003.75-3.75v-2.5h1.5a.75.75 0 000-1.5h-5z"/>',
        push: '<path d="M1 2.5A2.5 2.5 0 013.5 0h8.75a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V1.5h-8a1 1 0 00-1 1v6.708A2.492 2.492 0 013.5 9h3.25a.75.75 0 010 1.5H3.5a1 1 0 100 2h5.75a.75.75 0 010 1.5H3.5A2.5 2.5 0 011 11.5v-9z"/><path d="M7.25 11.25a.75.75 0 01.75-.75h5.25a.75.75 0 01.53 1.28l-1.72 1.72h3.69a.75.75 0 010 1.5h-5.25a.75.75 0 01-.53-1.28l1.72-1.72H8a.75.75 0 01-.75-.75z"/>',
      };

      const iconPath = icons[type] || icons.comment; // Default to comment icon
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">${iconPath}</svg>`;
    };

    // Format recent activity and actions in a single row
    const bottomSection = pr.last_activity
      ? `
      <div class="pr-bottom-row">
        <div class="pr-recent-activity">
          <div class="activity-icon">
            ${getActivityIcon(pr.last_activity.type)}
          </div>
          <div class="activity-content">
            <span class="activity-message">${pr.last_activity.message}</span>
            ${pr.last_activity.actor ? `<span class="activity-actor">by ${pr.last_activity.actor}</span>` : ""}
            <span class="activity-time">• ${formatTimeAgo(pr.last_activity.timestamp)}</span>
          </div>
        </div>
        <div class="pr-actions">
          <button class="pr-action-btn" data-action="merge" data-pr-id="${pr.id}" title="Merge PR">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm0 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm8.25-6.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
              <path d="M1.75 5.5v5a.75.75 0 001.5 0v-5a.75.75 0 00-1.5 0zm6.5-3.25a.75.75 0 000 1.5h1.5v2.5a2.25 2.25 0 01-2.25 2.25h-1a.75.75 0 000 1.5h1a3.75 3.75 0 003.75-3.75v-2.5h1.5a.75.75 0 000-1.5h-5z"/>
            </svg>
          </button>
          <button class="pr-action-btn" data-action="unassign" data-pr-id="${pr.id}" title="Unassign">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm.514 2.63a4 4 0 10-6.028 0A4.002 4.002 0 002 11.5V13a1 1 0 001 1h10a1 1 0 001-1v-1.5a4.002 4.002 0 00-2.986-3.87zM8 1a3 3 0 100 6 3 3 0 000-6zM3 11.5A3 3 0 016 8.5h4a3 3 0 013 3V13H3v-1.5z"/>
              <path d="M12.146 5.146a.5.5 0 01.708 0l2 2a.5.5 0 010 .708l-2 2a.5.5 0 01-.708-.708L13.293 8l-1.147-1.146a.5.5 0 010-.708z"/>
            </svg>
          </button>
          <button class="pr-action-btn" data-action="close" data-pr-id="${pr.id}" title="Close PR">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          </button>
        </div>
      </div>
    `
      : `
      <div class="pr-actions standalone">
        <button class="pr-action-btn" data-action="merge" data-pr-id="${pr.id}" title="Merge PR">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm0 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm8.25-6.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
            <path d="M1.75 5.5v5a.75.75 0 001.5 0v-5a.75.75 0 00-1.5 0zm6.5-3.25a.75.75 0 000 1.5h1.5v2.5a2.25 2.25 0 01-2.25 2.25h-1a.75.75 0 000 1.5h1a3.75 3.75 0 003.75-3.75v-2.5h1.5a.75.75 0 000-1.5h-5z"/>
          </svg>
        </button>
        <button class="pr-action-btn" data-action="unassign" data-pr-id="${pr.id}" title="Unassign">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.5 5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm.514 2.63a4 4 0 10-6.028 0A4.002 4.002 0 002 11.5V13a1 1 0 001 1h10a1 1 0 001-1v-1.5a4.002 4.002 0 00-2.986-3.87zM8 1a3 3 0 100 6 3 3 0 000-6zM3 11.5A3 3 0 016 8.5h4a3 3 0 013 3V13H3v-1.5z"/>
            <path d="M12.146 5.146a.5.5 0 01.708 0l2 2a.5.5 0 010 .708l-2 2a.5.5 0 01-.708-.708L13.293 8l-1.147-1.146a.5.5 0 010-.708z"/>
          </svg>
        </button>
        <button class="pr-action-btn" data-action="close" data-pr-id="${pr.id}" title="Close PR">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
          </svg>
        </button>
      </div>
    `;

    return `
      <div class="pr-card" data-state="${state}" data-pr-id="${pr.id}" ${needsAction ? 'data-needs-action="true"' : ""} ${pr.draft ? 'data-draft="true"' : ""}>
        <div class="pr-header">
          <a href="${pr.html_url}" class="pr-title" target="_blank" rel="noopener">
            ${escapeHtml(pr.title)}
          </a>
          ${badges ? `<div class="pr-badges">${badges}</div>` : ""}
        </div>
        <div class="pr-meta">
          <div class="pr-meta-left">
            <img src="${pr.user.avatar_url}" alt="${pr.user.login}" class="author-avatar" loading="lazy">
            <span class="pr-repo">${pr.repository.full_name}</span>
            <span class="pr-number">#${pr.number}</span>
            <span class="pr-author">by ${pr.user.login}</span>
          </div>
          <div class="pr-meta-right">
            <span class="pr-age">${ageText}</span>
            ${reviewers}
          </div>
        </div>
        ${bottomSection}
      </div>
    `;
  };

  const updateSinglePRCard = (pr) => {
    // Find the existing PR card
    const existingCard = document.querySelector(`[data-pr-id="${pr.id}"]`);
    if (!existingCard) return;

    // Determine which section this PR belongs to
    const section = existingCard.closest("#incomingPRs")
      ? "incoming"
      : "outgoing";

    // Check current filter settings
    const showStale = getCookie(`${section}FilterStale`) !== "false";
    const showBlockedOthers =
      getCookie(`${section}FilterBlockedOthers`) !== "false";

    // Check if this PR should be hidden based on filters
    const shouldHide =
      (!showStale && isStale(pr)) ||
      (!showBlockedOthers && isBlockedOnOthers(pr));

    if (shouldHide) {
      // Hide the card with a fade out animation
      existingCard.style.transition = "opacity 0.3s ease-out";
      existingCard.style.opacity = "0";
      setTimeout(() => {
        existingCard.style.display = "none";
      }, 300);
    } else {
      // Update the card content
      const newCardHTML = createPRCard(pr);

      // Create a temporary container to parse the new HTML
      const temp = document.createElement("div");
      temp.innerHTML = newCardHTML;
      const newCard = temp.firstElementChild;

      // Replace the old card with the new one
      existingCard.parentNode.replaceChild(newCard, existingCard);

      // Add fade-in animation for badges and recent activity
      const badges = newCard.querySelectorAll(".badge");
      badges.forEach((badge) => {
        badge.style.animation = "fadeIn 0.3s ease-out";
      });

      const bottomRow = newCard.querySelector(".pr-bottom-row");
      if (bottomRow) {
        bottomRow.style.animation = "fadeIn 0.4s ease-out";
      }
    }

    // Update filter counts since tags may have changed
    updateFilterCounts();
  };

  const getPRState = (pr) => {
    // Priority order for states
    if (
      pr.status_tags?.includes("blocked on you") ||
      pr.status_tags?.some((tag) => tag.startsWith("needs-"))
    )
      return "blocked";
    if (pr.status_tags?.includes("tests_failing")) return "blocked";
    if (pr.status_tags?.includes("merge_conflict")) return "blocked";
    if (pr.status_tags?.includes("changes_requested")) return "blocked";
    if (pr.status_tags?.includes("stale")) return "stale";
    if (pr.draft || pr.status_tags?.includes("draft")) return "draft";
    if (pr.status_tags?.includes("ready-to-merge")) return "ready";
    if (
      pr.status_tags?.includes("approved") &&
      pr.status_tags?.includes("all_checks_passing")
    )
      return "ready";
    return "default";
  };

  const getPRSize = (pr) => {
    const delta = Math.abs((pr.additions || 0) - (pr.deletions || 0));

    if (delta <= 6) return "XXS";
    if (delta <= 12) return "XS";
    if (delta <= 25) return "S";
    if (delta <= 50) return "M";
    if (delta <= 100) return "L";
    if (delta <= 400) return "XL";
    if (delta <= 800) return "XXL";
    return "INSANE";
  };

  const buildBadges = (pr) => {
    const badges = [];

    // Size badge always shows first (if we have the data)
    // Try to use size from pr_state first, fall back to calculated size
    const prSize =
      pr.prState?.size ||
      (pr.additions !== undefined && pr.deletions !== undefined
        ? getPRSize(pr)
        : null);
    if (prSize) {
      const additions = pr.additions || 0;
      const deletions = pr.deletions || 0;
      const tooltip =
        pr.additions !== undefined
          ? ` title="+${additions}/-${deletions}"`
          : "";
      badges.push(
        `<span class="badge badge-size badge-size-${prSize.toLowerCase()}"${tooltip}>${prSize}</span>`,
      );
    }

    if (pr.status_tags?.includes("loading")) {
      badges.push(
        '<span class="badge badge-loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>',
      );
    }

    if (pr.status_tags?.includes("blocked on you")) {
      badges.push(
        '<span class="badge badge-blocked"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM4 8a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 8z"/></svg>BLOCKED ON YOU</span>',
      );
    }

    if (pr.draft || pr.status_tags?.includes("draft")) {
      badges.push('<span class="badge badge-draft">DRAFT</span>');
    }

    if (
      pr.status_tags?.includes("ready-to-merge") ||
      pr.status_tags?.includes("ready_to_merge")
    ) {
      badges.push('<span class="badge badge-ready">READY</span>');
    }

    if (pr.status_tags?.includes("merge_conflict")) {
      badges.push('<span class="badge badge-conflict">MERGE CONFLICT</span>');
    }

    if (pr.status_tags?.includes("changes_requested")) {
      badges.push(
        '<span class="badge badge-changes-requested">CHANGES REQUESTED</span>',
      );
    }

    if (pr.status_tags?.includes("tests_failing")) {
      badges.push(
        '<span class="badge badge-tests-failing">TESTS FAILING</span>',
      );
    }

    if (pr.status_tags?.includes("tests_pending")) {
      badges.push(
        '<span class="badge badge-tests-pending">TESTS PENDING</span>',
      );
    }

    if (pr.status_tags?.includes("approved")) {
      badges.push('<span class="badge badge-approved">APPROVED</span>');
    }

    if (pr.status_tags?.includes("all_checks_passing")) {
      badges.push(
        '<span class="badge badge-checks-passing">CHECKS PASSING</span>',
      );
    }

    // Time-based badges
    if (pr.status_tags?.includes("new")) {
      badges.push('<span class="badge badge-new">NEW</span>');
    }

    if (pr.status_tags?.includes("updated")) {
      badges.push('<span class="badge badge-updated">UPDATED</span>');
    }

    if (pr.status_tags?.includes("stale") || isStale(pr)) {
      badges.push('<span class="badge badge-stale">STALE</span>');
    }

    // Add needs-X badges
    if (pr.status_tags?.includes("needs-review")) {
      badges.push('<span class="badge badge-needs-action">NEEDS REVIEW</span>');
    }

    if (pr.status_tags?.includes("needs-approval")) {
      badges.push(
        '<span class="badge badge-needs-action">NEEDS APPROVAL</span>',
      );
    }

    if (pr.status_tags?.includes("needs-response")) {
      badges.push(
        '<span class="badge badge-needs-action">NEEDS RESPONSE</span>',
      );
    }

    if (pr.status_tags?.includes("needs-fix")) {
      badges.push('<span class="badge badge-needs-action">NEEDS FIX</span>');
    }

    if (pr.status_tags?.includes("needs-merge")) {
      badges.push('<span class="badge badge-needs-action">NEEDS MERGE</span>');
    }

    if (pr.status_tags?.includes("needs-changes")) {
      badges.push(
        '<span class="badge badge-needs-action">NEEDS CHANGES</span>',
      );
    }

    // Generic needs-X handler for unknown action kinds
    pr.status_tags?.forEach((tag) => {
      if (
        tag.startsWith("needs-") &&
        ![
          "needs-review",
          "needs-approval",
          "needs-response",
          "needs-fix",
          "needs-merge",
          "needs-changes",
        ].includes(tag)
      ) {
        const action = tag.substring(6).toUpperCase();
        badges.push(
          `<span class="badge badge-needs-action">NEEDS ${action}</span>`,
        );
      }
    });

    return badges.join("");
  };

  const buildReviewers = (reviewers) => {
    if (!reviewers.length) return "";

    const maxShow = 3;
    const avatars = reviewers
      .slice(0, maxShow)
      .map(
        (reviewer) =>
          `<img src="${reviewer.avatar_url}" alt="${reviewer.login}" class="reviewer-avatar" loading="lazy" title="${reviewer.login}">`,
      )
      .join("");

    const extra =
      reviewers.length > maxShow
        ? `<span class="reviewer-count">+${reviewers.length - maxShow}</span>`
        : "";

    return `<div class="reviewers">${avatars}${extra}</div>`;
  };

  // Event Handlers
  const handleOrgChange = () => {
    const orgSelect = $("orgSelect");
    const selectedOrg = orgSelect?.value;

    // Get current viewing user
    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) return;

    // Check if we're on stats page
    const urlContext = parseURL();
    const isStats = urlContext && urlContext.isStats;

    // Update URL to new format
    let newPath;
    const username =
      typeof targetUser === "string" ? targetUser : targetUser.login;

    if (isStats) {
      // For stats page, use the new URL format without username
      if (selectedOrg) {
        newPath = `/github/${selectedOrg}/stats`;
      } else {
        newPath = `/github/all/stats`;
      }
    } else {
      // For dashboard page, keep the username in the URL
      if (selectedOrg) {
        newPath = `/github/${selectedOrg}/${username}`;
      } else {
        newPath = `/github/all/${username}`;
      }
    }

    window.history.pushState({}, "", newPath);

    // Update appropriate page
    if (isStats) {
      loadStatsData();
    } else {
      updatePRSections();
    }
  };

  const handleSearch = () => {
    const searchInput = $("searchInput");
    const searchTerm = searchInput?.value.toLowerCase() || "";

    $$(".pr-card").forEach((card) => {
      const title =
        card.querySelector(".pr-title")?.textContent.toLowerCase() || "";
      const repo =
        card.querySelector(".pr-repo")?.textContent.toLowerCase() || "";
      const author =
        card.querySelector(".pr-author")?.textContent.toLowerCase() || "";

      const matches =
        !searchTerm ||
        title.includes(searchTerm) ||
        repo.includes(searchTerm) ||
        author.includes(searchTerm);

      card.style.display = matches ? "" : "none";
    });

    // Update empty state
    const visibleCards = $$('.pr-card:not([style*="display: none"])').length;
    const emptyState = $("emptyState");
    if (visibleCards === 0 && searchTerm) {
      show(emptyState);
    } else if (visibleCards > 0) {
      hide(emptyState);
    }
  };

  // Hamburger Menu Functions
  let hamburgersSetup = false;
  const setupHamburgerMenu = () => {
    if (hamburgersSetup) return; // Prevent duplicate setup

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

    // Event listeners
    hamburgerBtn.addEventListener("click", openMenu);
    closeMenuBtn?.addEventListener("click", closeMenu);
    menuBackdrop?.addEventListener("click", closeMenu);

    hamburgersSetup = true;

    // Escape key to close menu
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && slideMenu.classList.contains("open")) {
        closeMenu();
      }
    });

    // Setup navigation links
    const urlContext = parseURL();
    if (urlContext) {
      const { org, username } = urlContext;
      const basePath = org
        ? `/github/${org}/${username}`
        : `/github/all/${username}`;
      const statsPath = org ? `/github/${org}/stats` : `/github/all/stats`;

      // Update links
      if (dashboardLink) {
        dashboardLink.href = basePath;
        if (window.location.pathname === basePath) {
          dashboardLink.classList.add("active");
        }
      }

      if (statsLink) {
        statsLink.href = statsPath;
        // Check both new and legacy stats URL patterns
        if (
          window.location.pathname === statsPath ||
          window.location.pathname === `${basePath}/stats`
        ) {
          statsLink.classList.add("active");
        }

        // Navigate to stats page
        statsLink.addEventListener("click", (e) => {
          e.preventDefault();
          closeMenu();
          window.location.href = statsLink.href;
        });
      }
      
      // Notifications link
      const notificationsLink = $("notificationsLink");
      if (notificationsLink) {
        notificationsLink.addEventListener("click", (e) => {
          e.preventDefault();
          closeMenu();
          showNotificationsPage();
        });
      }
      
      // Settings link
      const settingsLink = $("settingsLink");
      if (settingsLink) {
        settingsLink.addEventListener("click", (e) => {
          e.preventDefault();
          closeMenu();
          showSettingsPage();
        });
      }
    }
  };

  const handlePRAction = async (action, prId) => {
    // Find PR in all sections
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];
    const pr = allPRs.find((p) => p.id.toString() === prId);
    if (!pr) return;

    const token = getStoredToken();
    if (!token) {
      showToast("Please login to perform this action", "error");
      return;
    }

    try {
      let response;
      const headers = {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      };

      switch (action) {
        case "merge":
          response = await fetch(
            `${CONFIG.API_BASE}/repos/${pr.repository.full_name}/pulls/${pr.number}/merge`,
            {
              method: "PUT",
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                commit_title: `Merge pull request #${pr.number}${pr.head?.ref ? ` from ${pr.head.ref}` : ""}`,
                commit_message: pr.title || `Merge PR #${pr.number}`,
              }),
            },
          );

          if (response.ok) {
            showToast("PR merged successfully", "success");
            // Remove PR from state
            ["incoming", "outgoing"].forEach((section) => {
              const index = state.pullRequests[section].findIndex(
                (p) => p.id.toString() === prId,
              );
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            let errorMsg = "Failed to merge PR";
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              // If JSON parsing fails, use status text
              errorMsg = `Failed to merge PR: ${response.statusText}`;
            }
            showToast(errorMsg, "error");
          }
          break;

        case "unassign":
          response = await fetch(
            `${CONFIG.API_BASE}/repos/${pr.repository.full_name}/issues/${pr.number}/assignees`,
            {
              method: "DELETE",
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                assignees: pr.assignees?.map((a) => a.login) || [],
              }),
            },
          );

          if (response.ok) {
            showToast("Unassigned from PR", "success");
            // Refresh the PR list
            updatePRSections();
          } else {
            let errorMsg = "Failed to unassign";
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              errorMsg = `Failed to unassign: ${response.statusText}`;
            }
            showToast(errorMsg, "error");
          }
          break;

        case "close":
          response = await fetch(
            `${CONFIG.API_BASE}/repos/${pr.repository.full_name}/pulls/${pr.number}`,
            {
              method: "PATCH",
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                state: "closed",
              }),
            },
          );

          if (response.ok) {
            showToast("PR closed", "success");
            // Remove PR from state
            ["incoming", "outgoing"].forEach((section) => {
              const index = state.pullRequests[section].findIndex(
                (p) => p.id.toString() === prId,
              );
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            let errorMsg = "Failed to close PR";
            if (response.status === 403) {
              errorMsg = "Failed to close PR - Permission denied";
            } else {
              try {
                const error = await response.json();
                errorMsg =
                  error.message ||
                  error.error ||
                  `Failed to close PR: ${response.statusText}`;
              } catch (e) {
                errorMsg = `Failed to close PR: ${response.statusText}`;
              }
            }
            showToast(errorMsg, "error");
          }
          break;
      }
    } catch (error) {
      console.error("Error performing PR action:", error);
      // Show the actual error message to the user
      const errorMessage = error.message || "An error occurred";
      showToast(`Error: ${errorMessage}`, "error");
    }
  };

  const handleKeyboardShortcuts = (e) => {
    if (e.target.matches("input, textarea")) return;

    const cards = Array.from($$('.pr-card:not([style*="display: none"])'));
    const currentFocus = document.querySelector(".pr-card.focused");
    const currentIndex = currentFocus ? cards.indexOf(currentFocus) : -1;

    switch (e.key) {
      case "j":
        e.preventDefault();
        if (currentIndex < cards.length - 1) {
          currentFocus?.classList.remove("focused");
          cards[currentIndex + 1].classList.add("focused");
          cards[currentIndex + 1].scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        } else if (cards.length > 0 && currentIndex === -1) {
          cards[0].classList.add("focused");
          cards[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        break;

      case "k":
        e.preventDefault();
        if (currentIndex > 0) {
          currentFocus?.classList.remove("focused");
          cards[currentIndex - 1].classList.add("focused");
          cards[currentIndex - 1].scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
        break;

      case "Enter":
        if (currentFocus) {
          const link = currentFocus.querySelector(".pr-title");
          if (link) window.open(link.href, "_blank");
        }
        break;

      case "/":
        e.preventDefault();
        $("searchInput")?.focus();
        break;
    }
  };

  // Auth Functions
  const initiateOAuthLogin = () => {
    // Use the Go backend's OAuth endpoint
    const authWindow = window.open(
      "/oauth/login",
      "github-oauth",
      "width=600,height=700",
    );

    // Listen for OAuth callback
    window.addEventListener("message", async (event) => {
      if (
        event.data &&
        event.data.type === "oauth-callback" &&
        event.data.token
      ) {
        storeToken(event.data.token);
        authWindow.close();

        // Set cookie to remember GitHub App was successfully used
        setCookie("github_app_installed", "true", 365); // Remember for 1 year

        // Load user info and redirect to their dashboard
        try {
          state.accessToken = event.data.token;
          await loadCurrentUser();

          // Check if we're already on the correct page to avoid loops
          const currentPath = window.location.pathname;
          const expectedPath = `/github/all/${state.currentUser.login}`;

          if (currentPath !== expectedPath) {
            window.location.href = expectedPath;
          } else {
            // Already on the right page, just reload the data
            updateUserDisplay();
            showMainContent();
            await loadPullRequests();
            updateOrgFilter();
          }
        } catch (error) {
          console.error("Failed to load user after OAuth:", error);
          // Use the detailed error message if available
          const errorMessage =
            error.message && error.message.startsWith("GitHub error:")
              ? error.message
              : "Authentication succeeded but failed to load user info";
          showToast(errorMessage, "error");
          // Don't redirect on error
          updateUserDisplay();
          showMainContent();
        }
      }
    });
  };

  const showGitHubAppModal = () => {
    // Check if user has successfully used GitHub App before
    if (getCookie("github_app_installed") === "true") {
      // Skip the modal and go directly to OAuth
      initiateOAuthLogin();
    } else {
      // Show the installation guidance modal
      show($("githubAppModal"));
    }
  };
  const closeGitHubAppModal = () => {
    hide($("githubAppModal"));
  };
  const proceedWithOAuth = () => {
    closeGitHubAppModal();
    initiateOAuthLogin();
  };
  const initiatePATLogin = () => {
    show($("patModal"));
    $("patInput").focus();
  };

  const closePATModal = () => {
    hide($("patModal"));
    $("patInput").value = "";
  };

  const submitPAT = async () => {
    const token = $("patInput").value.trim();
    if (!token) {
      showToast("Please enter a valid token", "error");
      return;
    }

    // Test the token
    try {
      const testResponse = await fetch(`${CONFIG.API_BASE}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (testResponse.ok) {
        const user = await testResponse.json();
        storeToken(token, true); // Store in cookie
        closePATModal();

        // Update state
        state.accessToken = token;
        state.currentUser = user;

        // Check if we're already on the correct page to avoid loops
        const currentPath = window.location.pathname;
        const expectedPath = `/github/all/${user.login}`;

        if (currentPath !== expectedPath) {
          window.location.href = expectedPath;
        } else {
          // Already on the right page, just reload the data
          updateUserDisplay();
          showMainContent();
          await loadPullRequests();
          updateOrgFilter();
        }
      } else {
        showToast("Invalid token. Please check and try again.", "error");
      }
    } catch (error) {
      showToast("Failed to validate token. Please try again.", "error");
    }
  };

  const handleOAuthCallback = async () => {
    // OAuth is now handled via popup window and postMessage
    // This function is kept for backwards compatibility but does nothing
  };

  const initiateLogin = () => {
    // Show login options: OAuth or PAT
    initiateOAuthLogin();
  };

  const handleAuthError = () => {
    clearToken();
    showLoginPrompt();
    showToast("Authentication failed. Please login again.", "error");
  };

  const logout = () => {
    clearToken();
    window.location.href = "/";
  };

  // UI State Management
  const showLoginPrompt = () => {
    hide($("prSections"));
    show($("loginPrompt"));
  };

  const showMainContent = () => {
    hide($("loginPrompt"));
    hide($("statsPage"));
    hide($("settingsPage"));
    hide($("notificationsPage"));
    show($("prSections"));
  };

  const showToast = (message, type = "info") => {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // Demo Mode
  const initializeDemoMode = () => {
    if (typeof DEMO_DATA === "undefined") {
      console.error("Demo data not loaded");
      return;
    }

    state.isDemoMode = true;
    state.currentUser = DEMO_DATA.user;
    state.viewingUser = DEMO_DATA.user; // Set viewingUser for consistency
    state.pullRequests = DEMO_DATA.pullRequests;

    // Enhance demo PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];

    allPRs.forEach((pr) => {
      pr.age_days = Math.floor(
        (Date.now() - new Date(pr.created_at)) / 86400000,
      );

      // Simulate new API structure from labels
      const labelNames = (pr.labels || []).map((l) => l.name);

      // Build unblock_action based on labels
      const unblockAction = {};
      if (labelNames.includes("blocked on you")) {
        unblockAction[state.currentUser.login] = {
          kind: "review",
          critical: true,
          reason: "Requested changes need to be addressed",
          ready_to_notify: true,
        };
      }

      // Simulate check status
      const checks = {
        total: 5,
        passing: labelNames.includes("tests passing") ? 5 : 3,
        failing: labelNames.includes("tests failing") ? 2 : 0,
        pending: 0,
        waiting: 0,
        ignored: 0,
      };

      // Simulate PR size
      const sizeMap = {
        "size/XS": "XS",
        "size/S": "S",
        "size/M": "M",
        "size/L": "L",
        "size/XL": "XL",
      };
      let size = "M"; // default
      for (const [label, sizeValue] of Object.entries(sizeMap)) {
        if (labelNames.includes(label)) {
          size = sizeValue;
          break;
        }
      }

      // Create pr_state with all fields
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
          tags: [], // Tags are now computed from other fields
        },
        timestamp: new Date().toISOString(),
        commit: "demo-version",
      };

      // Also set prState for consistency
      pr.prState = pr.turnData.pr_state;

      pr.status_tags = getStatusTags(pr);
    });

    // If we're not already on a user URL, redirect to demo user's dashboard
    const urlContext = parseURL();
    if (!urlContext || !urlContext.username) {
      window.location.href = `/github/all/${DEMO_DATA.user.login}?demo=true`;
      return;
    }

    updateUserDisplay();
    updatePRSections();
    updateOrgFilter();
    showMainContent();
  };

  // Initialize
  const init = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const demo = urlParams.get("demo");

    // Parse URL for viewing context
    const urlContext = parseURL();

    // Handle stats page routing
    if (urlContext && urlContext.isStats) {
      showStatsPage();
      return;
    }

    // Setup event listeners
    const orgSelect = $("orgSelect");
    const searchInput = $("searchInput");
    const loginBtn = $("loginBtn");

    if (orgSelect) orgSelect.addEventListener("change", handleOrgChange);
    if (searchInput) {
      searchInput.addEventListener("input", handleSearch);
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          searchInput.value = "";
          handleSearch();
          searchInput.blur();
        }
      });
    }
    if (loginBtn) loginBtn.addEventListener("click", initiateLogin);

    // Setup hamburger menu
    setupHamburgerMenu();

    // Setup filter event listeners for each section
    ["incoming", "outgoing"].forEach((section) => {
      const staleFilter = $(`${section}FilterStale`);
      const blockedOthersFilter = $(`${section}FilterBlockedOthers`);

      if (staleFilter) {
        staleFilter.addEventListener("change", (e) => {
          setCookie(`${section}FilterStale`, e.target.checked.toString(), 365);
          updatePRSections();
        });
      }

      if (blockedOthersFilter) {
        blockedOthersFilter.addEventListener("change", (e) => {
          setCookie(
            `${section}FilterBlockedOthers`,
            e.target.checked.toString(),
            365,
          );
          updatePRSections();
        });
      }
    });

    // Add event listener for PAT input Enter key
    const patInput = $("patInput");
    if (patInput) {
      patInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          submitPAT();
        }
      });
    }

    document.addEventListener("keydown", handleKeyboardShortcuts);

    // Add event delegation for PR action buttons and card clicks
    document.addEventListener("click", (e) => {
      // Handle action button clicks
      if (e.target.closest(".pr-action-btn")) {
        e.stopPropagation();
        const btn = e.target.closest(".pr-action-btn");
        const action = btn.dataset.action;
        const prId = btn.dataset.prId;
        handlePRAction(action, prId);
        return;
      }
      
      // Handle PR card clicks (but not on links or buttons)
      const prCard = e.target.closest(".pr-card");
      if (prCard && !e.target.closest("a") && !e.target.closest("button")) {
        const prTitle = prCard.querySelector(".pr-title");
        if (prTitle && prTitle.href) {
          window.open(prTitle.href, "_blank", "noopener");
        }
      }
    });

    // Check for OAuth callback
    if (urlParams.get("code")) {
      handleOAuthCallback();
      return;
    }

    // Check for demo mode
    if (demo === "true") {
      initializeDemoMode();
      return;
    }

    // Check if we're viewing another user's dashboard
    if (urlContext && urlContext.username) {
      // Load the user we're viewing
      try {
        state.viewingUser = await githubAPI(`/users/${urlContext.username}`);

        // Check if we have auth (for logged in features)
        if (state.accessToken) {
          await loadCurrentUser();
        }

        updateUserDisplay();
        showMainContent();
        await loadPullRequests();
        updateOrgFilter();

        // Set org filter from URL
        if (urlContext.org && orgSelect) {
          orgSelect.value = urlContext.org;
        }
      } catch (error) {
        console.error("Error loading user dashboard:", error);
        // Use the detailed error message from githubAPI
        const errorMessage =
          error.message ||
          `Failed to load dashboard for ${urlContext.username}`;
        showToast(errorMessage, "error");

        // Don't redirect on error to prevent loops
        // Just show what we can with the error message
        showMainContent();
      }
      return;
    }

    // Regular auth flow - user needs to log in to see their own dashboard
    if (!state.accessToken) {
      showLoginPrompt();
      return;
    }

    // Initialize app for logged in user
    try {
      await loadCurrentUser();
      updateUserDisplay();

      // Only redirect if we're not already on a dashboard page
      const currentPath = window.location.pathname;
      const expectedPath = `/github/all/${state.currentUser.login}`;

      if (currentPath !== expectedPath && !currentPath.startsWith("/github/")) {
        // Redirect to user's dashboard URL
        window.location.href = expectedPath;
      } else {
        // We're already on a dashboard page, just load the data
        showMainContent();
        await loadPullRequests();
        updateOrgFilter();
      }
    } catch (error) {
      console.error("Error initializing app:", error);
      // The error message from githubAPI already includes "GitHub error:" prefix
      const errorMessage = error.message || "Failed to load data";
      showToast(errorMessage, "error");

      // Don't redirect on error to prevent loops
      showMainContent();
    }
  };

  // Stats Page Functions
  const showStatsPage = async () => {
    // Ensure user is authenticated first
    if (!state.accessToken) {
      const loginPrompt = $("loginPrompt");
      show(loginPrompt);
      hide($("prSections"));
      hide($("emptyState"));
      hide($("statsPage"));
      return;
    }

    // Load user data if needed
    if (!state.currentUser) {
      await loadCurrentUser();
    }

    // Parse URL context to set viewing user
    const urlContext = parseURL();
    if (urlContext && urlContext.username) {
      // If viewingUser is not already set or is just a string, fetch the user object
      if (!state.viewingUser || typeof state.viewingUser === "string") {
        try {
          state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
        } catch (error) {
          console.error("Error loading viewing user:", error);
          // Fall back to using current user if we can't load the viewing user
          state.viewingUser = state.currentUser;
        }
      }
    }

    // Update UI elements (header, user info, etc.)
    updateUserDisplay();

    // Setup hamburger menu if not already done
    setupHamburgerMenu();

    // Load PRs if not already loaded (needed for org filter)
    if (
      state.pullRequests.incoming.length === 0 &&
      state.pullRequests.outgoing.length === 0
    ) {
      await loadPullRequests();
    }

    // Setup event listeners for org filter and search
    const orgSelect = $("orgSelect");
    const searchInput = $("searchInput");

    if (orgSelect && !orgSelect.hasAttribute("data-listener")) {
      orgSelect.addEventListener("change", handleOrgChange);
      orgSelect.setAttribute("data-listener", "true");
    }

    if (searchInput && !searchInput.hasAttribute("data-listener")) {
      searchInput.addEventListener("input", handleSearch);
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          searchInput.value = "";
          handleSearch();
          searchInput.blur();
        }
      });
      searchInput.setAttribute("data-listener", "true");
    }

    // Load organizations for filter
    updateOrgFilter();

    // Hide main content and show stats page
    hide($("loginPrompt"));
    hide($("prSections"));
    hide($("emptyState"));
    show($("statsPage"));

    // Fetch and display stats
    await loadStatsData();
  };

  const loadStatsData = async () => {
    try {
      const urlContext = parseURL();
      if (!urlContext) return;

      const { username, org } = urlContext;

      // Show loading state immediately
      const container = $("orgStatsContainer");

      // If viewing "all", show organization list instead of stats
      if (!org) {
        container.innerHTML =
          '<div class="loading-indicator">Loading organizations...</div>';

        // Get a list of organizations the user has access to
        // We still need to use involves:username here to discover which orgs the user can access
        const orgQuery = `type:pr involves:${username} updated:>=${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}`;
        const orgResponse = await githubSearchAll(
          `/search/issues?q=${encodeURIComponent(orgQuery)}&per_page=100`,
          3,
        );

        // Extract unique organizations with PR counts
        const orgCounts = {};
        orgResponse.items.forEach((pr) => {
          const orgName = pr.repository_url.split("/repos/")[1].split("/")[0];
          orgCounts[orgName] = (orgCounts[orgName] || 0) + 1;
        });

        // Sort by PR count (descending) then alphabetically
        const sortedOrgs = Object.entries(orgCounts).sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );

        if (sortedOrgs.length === 0) {
          container.innerHTML =
            '<div class="empty-state">No organizations found with recent PR activity</div>';
          return;
        }

        // Show organization selector
        container.innerHTML = `
          <div class="org-selector">
            <h2 class="org-selector-title">Select an organization to view statistics</h2>
            <p class="org-selector-subtitle">Choose from your organizations with recent PR activity</p>
            <div class="org-list">
              ${sortedOrgs
                .map(
                  ([orgName, count]) => `
                <a href="/github/${escapeHtml(orgName)}/stats" class="org-list-item">
                  <div class="org-list-name">${escapeHtml(orgName)}</div>
                  <div class="org-list-count">${count} recent PRs</div>
                </a>
              `,
                )
                .join("")}
            </div>
          </div>
        `;
        return;
      }

      // Single org selected - show stats for just this org
      container.innerHTML =
        '<div class="loading-indicator">Loading statistics...</div>';

      // Clear container and create section for this org
      container.innerHTML = "";
      const orgSection = createOrgSection(org);
      container.appendChild(orgSection);

      // Process this organization's stats
      await processOrgStats(org, username);
    } catch (error) {
      console.error("Error loading stats:", error);

      const container = $("orgStatsContainer");
      if (error.isRateLimit) {
        container.innerHTML = `
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <p>GitHub API rate limit exceeded</p>
            <p class="text-secondary">Please wait ${error.minutesUntilReset} minutes before refreshing</p>
            <p class="text-secondary" style="font-size: 0.8rem; margin-top: 0.5rem;">Reset time: ${error.resetTime.toLocaleTimeString()}</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <p>Failed to load statistics</p>
            <p class="text-secondary">${error.message}</p>
          </div>
        `;
      }
    }
  };

  const createOrgSection = (org) => {
    const section = document.createElement("div");
    section.className = "org-section";
    section.id = `org-section-${org}`;

    section.innerHTML = `
      <div class="org-header">
        <h2 class="org-name">${escapeHtml(org)}</h2>
      </div>
      <div class="stats-container">
        <!-- PR Ratio Chart -->
        <div class="stat-card">
          <h3 class="stat-card-title">PR Review Ratio (10 day merged vs 10 day open)</h3>
          <p class="stat-card-subtitle">Healthy orgs have a 3:1 or higher ratio of PRs merged within the last 10 days compared to PRs stuck open for over 10 days</p>
          <div class="ratio-display loading" id="ratioDisplay-${org}">Loading...</div>
          <div class="chart-container">
            <canvas id="prRatioChart-${org}" width="300" height="300"></canvas>
          </div>
          <div class="chart-legend" id="chartLegend-${org}"></div>
        </div>

        <!-- Stats Summary -->
        <div class="stat-card">
          <h3 class="stat-card-title">Summary</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <a href="#" class="stat-link" id="totalOpenLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="totalOpen-${org}">-</div>
                <div class="stat-label">Total Open PRs</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="avgOpenAgeLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="avgOpenAge-${org}">-</div>
                <div class="stat-label">Avg Open PR Age</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="mergedPRsLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="mergedPRs-${org}">-</div>
                <div class="stat-label">Merged (10 days)</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="openPRsLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="openPRs-${org}">-</div>
                <div class="stat-label">Open >10 days</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="avgMergeTimeLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="avgMergeTime-${org}">-</div>
                <div class="stat-label">Avg Push→Merge Delay</div>
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    return section;
  };

  const processOrgStats = async (org, username) => {
    try {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const tenDaysAgoISO = tenDaysAgo.toISOString().split("T")[0];

      // Build queries for this organization (org-wide, not user-specific)
      // 1. All open PRs (we'll filter for stale ones in JS)
      const openAllQuery = `type:pr is:open org:${org}`;

      // 2. Merged PRs within the last 10 days (use is:merged to match GitHub link)
      const mergedRecentQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;

      // Run both queries in parallel with pagination (20 pages = up to 2000 results each)
      const [openAllResponse, mergedRecentResponse] = await Promise.all([
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(openAllQuery)}&per_page=100`,
          20,
        ),
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(mergedRecentQuery)}&per_page=100`,
          20,
        ),
      ]);

      const openAllPRs = openAllResponse.items || [];
      const mergedRecentPRs = mergedRecentResponse.items || [];

      // Filter open PRs for stale ones (not updated in last 10 days)
      const openStalePRs = openAllPRs.filter((pr) => {
        const updatedAt = new Date(pr.updated_at);
        return updatedAt < tenDaysAgo;
      });

      // All merged PRs are already filtered by the query
      const mergedLast10Days = mergedRecentPRs.length;
      let totalMergeTime = 0;

      // Calculate average merge time for merged PRs
      mergedRecentPRs.forEach((pr) => {
        if (pr.pull_request?.merged_at) {
          const createdAt = new Date(pr.created_at);
          const mergedAt = new Date(pr.pull_request.merged_at);
          const mergeTime = mergedAt - createdAt;
          totalMergeTime += mergeTime;
        }
      });

      // Calculate average age of open PRs
      let totalOpenAge = 0;
      openAllPRs.forEach((pr) => {
        const createdAt = new Date(pr.created_at);
        const age = now - createdAt;
        totalOpenAge += age;
      });

      // Stats
      const currentlyOpen = openAllPRs.length;
      const openMoreThan10Days = openStalePRs.length;

      // Update stats display
      const totalOpenElement = $(`totalOpen-${org}`);
      const avgOpenAgeElement = $(`avgOpenAge-${org}`);
      const mergedElement = $(`mergedPRs-${org}`);
      const openElement = $(`openPRs-${org}`);
      const avgElement = $(`avgMergeTime-${org}`);
      const ratioElement = $(`ratioDisplay-${org}`);

      // Update total open PRs count and link
      if (totalOpenElement) {
        totalOpenElement.classList.remove("loading");
        totalOpenElement.textContent = currentlyOpen;

        const totalOpenLink = $(`totalOpenLink-${org}`);
        if (totalOpenLink) {
          if (currentlyOpen > 0) {
            const openQuery = `type:pr is:open org:${org}`;
            totalOpenLink.href = `https://github.com/search?q=${encodeURIComponent(openQuery)}&type=pullrequests`;
          } else {
            totalOpenLink.removeAttribute("href");
            totalOpenLink.style.cursor = "default";
          }
        }
      }

      // Update average open PR age and link
      if (avgOpenAgeElement) {
        avgOpenAgeElement.classList.remove("loading");
        const avgOpenAgeLink = $(`avgOpenAgeLink-${org}`);

        if (currentlyOpen > 0) {
          const avgOpenAgeMs = totalOpenAge / currentlyOpen;
          const avgOpenAgeMinutes = avgOpenAgeMs / (60 * 1000);
          const avgOpenAgeHours = avgOpenAgeMs / (60 * 60 * 1000);
          const avgOpenAgeDays = avgOpenAgeMs / (24 * 60 * 60 * 1000);

          // Display in most appropriate unit
          let displayText;
          if (avgOpenAgeMinutes < 60) {
            displayText = `${Math.round(avgOpenAgeMinutes)}m`;
          } else if (avgOpenAgeHours < 24) {
            displayText = `${Math.round(avgOpenAgeHours)}h`;
          } else {
            displayText = `${Math.round(avgOpenAgeDays)}d`;
          }
          avgOpenAgeElement.textContent = displayText;

          // Set up GitHub search link for all open PRs
          if (avgOpenAgeLink) {
            const openQuery = `type:pr is:open org:${org}`;
            avgOpenAgeLink.href = `https://github.com/search?q=${encodeURIComponent(openQuery)}&type=pullrequests`;
          }
        } else {
          avgOpenAgeElement.textContent = "-";
          if (avgOpenAgeLink) {
            avgOpenAgeLink.removeAttribute("href");
            avgOpenAgeLink.style.cursor = "default";
          }
        }
      }

      // Update merged PRs count and link
      if (mergedElement) {
        mergedElement.classList.remove("loading");
        mergedElement.textContent = mergedLast10Days;

        const mergedLink = $(`mergedPRsLink-${org}`);
        if (mergedLink) {
          if (mergedLast10Days > 0) {
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;
            mergedLink.href = `https://github.com/search?q=${encodeURIComponent(mergedQuery)}&type=pullrequests`;
          } else {
            mergedLink.removeAttribute("href");
            mergedLink.style.cursor = "default";
          }
        }
      }

      // Update open >10 days count and link
      if (openElement) {
        openElement.classList.remove("loading");
        openElement.textContent = openMoreThan10Days;

        const openLink = $(`openPRsLink-${org}`);
        if (openLink) {
          if (openMoreThan10Days > 0) {
            const openQuery = `type:pr is:open org:${org} updated:<${tenDaysAgoISO}`;
            openLink.href = `https://github.com/search?q=${encodeURIComponent(openQuery)}&type=pullrequests`;
          } else {
            openLink.removeAttribute("href");
            openLink.style.cursor = "default";
          }
        }
      }

      // Calculate average merge time and set up link
      if (avgElement) {
        avgElement.classList.remove("loading");
        const avgLink = $(`avgMergeTimeLink-${org}`);

        if (mergedLast10Days > 0) {
          const avgMergeMs = totalMergeTime / mergedLast10Days;
          const avgMergeMinutes = avgMergeMs / (60 * 1000);
          const avgMergeHours = avgMergeMs / (60 * 60 * 1000);
          const avgMergeDays = avgMergeMs / (24 * 60 * 60 * 1000);

          // Display in most appropriate unit
          let displayText;
          if (avgMergeMinutes < 60) {
            displayText = `${Math.round(avgMergeMinutes)}m`;
          } else if (avgMergeHours <= 120) {
            // Show hours up to 120h (5 days)
            displayText = `${Math.round(avgMergeHours)}h`;
          } else {
            displayText = `${Math.round(avgMergeDays)}d`;
          }
          avgElement.textContent = displayText;

          // Set up GitHub search link for merged PRs in last 10 days (org-wide)
          if (avgLink) {
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;
            avgLink.href = `https://github.com/search?q=${encodeURIComponent(mergedQuery)}&type=pullrequests`;
          }
        } else {
          avgElement.textContent = "-";
          if (avgLink) {
            avgLink.removeAttribute("href");
            avgLink.style.cursor = "default";
          }
        }
      }

      // Calculate and display merge:open ratio (comparing to open >10 days to match pie chart)
      if (ratioElement) {
        ratioElement.classList.remove("loading");
        if (openMoreThan10Days === 0 && mergedLast10Days > 0) {
          ratioElement.textContent = "∞:1";
        } else if (openMoreThan10Days === 0 && mergedLast10Days === 0) {
          ratioElement.textContent = "-";
        } else {
          const ratio = (mergedLast10Days / openMoreThan10Days).toFixed(1);
          ratioElement.textContent = `${ratio}:1`;
        }
      }

      // Draw pie chart
      drawOrgPieChart(org, mergedLast10Days, openMoreThan10Days);
    } catch (error) {
      console.error(`Error processing stats for ${org}:`, error);

      // Show error state for this org
      const elements = [
        "totalOpen",
        "avgOpenAge",
        "mergedPRs",
        "openPRs",
        "avgMergeTime",
        "ratioDisplay",
      ].map((id) => $(`${id}-${org}`));
      elements.forEach((el) => {
        if (el) {
          el.classList.remove("loading");
          el.textContent = error.isRateLimit ? "Rate Limited" : "Error";
        }
      });

      // Add error message to the chart area
      const canvas = $(`prRatioChart-${org}`);
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ef4444";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          error.isRateLimit ? "Rate limit exceeded" : "Error loading data",
          canvas.width / 2,
          canvas.height / 2,
        );
      }
    }
  };

  const drawOrgPieChart = (org, merged, openOld) => {
    const canvas = $(`prRatioChart-${org}`);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const total = merged + openOld;

    if (total === 0) {
      // No data to display
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#475569";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No PR data available", canvas.width / 2, canvas.height / 2);
      return;
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 20;

    // Calculate angles
    const mergedAngle = (merged / total) * 2 * Math.PI;
    const openAngle = (openOld / total) * 2 * Math.PI;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw merged slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + mergedAngle);
    ctx.closePath();
    ctx.fillStyle = "#10b981";
    ctx.fill();

    // Draw open old slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX,
      centerY,
      radius,
      -Math.PI / 2 + mergedAngle,
      -Math.PI / 2 + mergedAngle + openAngle,
    );
    ctx.closePath();
    ctx.fillStyle = "#f59e0b";
    ctx.fill();

    // Add border
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Update legend
    const legendHtml = `
      <div class="legend-item">
        <div class="legend-color" style="background: #10b981;"></div>
        <span>Merged in 10 days (${merged} - ${Math.round((merged / total) * 100)}%)</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #f59e0b;"></div>
        <span>Open over 10 days (${openOld} - ${Math.round((openOld / total) * 100)}%)</span>
      </div>
    `;
    $(`chartLegend-${org}`).innerHTML = legendHtml;
  };

  // Settings Page Functions
  const robotDefinitions = [
    {
      id: "autoassign",
      name: "AutoAssign 2000",
      icon: "🤖",
      description: "Automatically assign reviewers based on who has active expertise with the lines the PR is modifying",
      config: {
        type: "select",
        label: "Number of reviewers",
        options: [
          { value: "disabled", label: "Disabled" },
          { value: "1", label: "1 reviewer" },
          { value: "2", label: "2 reviewers" },
          { value: "3", label: "3 reviewers" },
          { value: "4", label: "4 reviewers" }
        ],
        default: "disabled"
      }
    },
    {
      id: "autoapprove",
      name: "AutoApprove 2001",
      icon: "✅",
      description: "Automatically approve trivial PRs based on author and size",
      config: [
        {
          type: "checkboxes",
          label: "Automatically approve PRs authored by:",
          options: [
            { id: "dependabot", label: "Dependabot", default: true },
            { id: "owners", label: "Project owners", default: false },
            { id: "contributors", label: "Project contributors", default: false }
          ]
        },
        {
          type: "select",
          label: "Maximum delta (lines changed)",
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
      description: "Track pull requests that get merged without approval, and ensure that reviewers are found and notified. Adds TBR (to be reviewed) label to unapproved PRs that have been merged. Useful for SOC 2.",
      config: {
        type: "text",
        label: "Only applies to repositories with the following topic label",
        placeholder: "e.g., soc2-required"
      }
    },
    {
      id: "slackchan",
      name: "SlackChan 4000",
      icon: "📢",
      description: "Send code review requests to Slack channels",
      config: [
        {
          type: "mappings",
          label: "GitHub project → Slack channel mapping",
          placeholder1: "GitHub project (e.g., myorg/myrepo)",
          placeholder2: "Slack channel (e.g., #dev-reviews)"
        },
        {
          type: "checkbox",
          label: "Wait until PR passes tests",
          default: true
        }
      ]
    },
    {
      id: "slackdm",
      name: "SlackDM 4001",
      icon: "💬",
      description: "Send code review requests to assignees on Slack",
      config: [
        {
          type: "mappings",
          label: "GitHub username → Slack user mapping",
          placeholder1: "GitHub username",
          placeholder2: "Slack user ID or @username"
        },
        {
          type: "checkbox",
          label: "Wait until PR passes tests",
          default: true
        }
      ]
    },
    {
      id: "reassign",
      name: "ReAssign 5000",
      icon: "🔄",
      description: "Re-assign reviewers after X days of blocking without an update",
      config: {
        type: "select",
        label: "Re-assign after",
        options: [
          { value: "3", label: "3 days" },
          { value: "5", label: "5 days" },
          { value: "7", label: "7 days" },
          { value: "10", label: "10 days" }
        ],
        default: "5"
      }
    },
    {
      id: "testbot",
      name: "TestBot 6000",
      icon: "🧪",
      description: "Guide users through resolving pull requests with broken tests",
      config: {
        type: "toggle",
        label: "Enable TestBot"
      }
    },
    {
      id: "autoclose",
      name: "AutoClose 9000",
      icon: "🗑️",
      description: "Automatically close stale PRs after a specified period",
      config: {
        type: "select",
        label: "Close PRs after",
        options: [
          { value: "disabled", label: "Disabled" },
          { value: "60", label: "60 days" },
          { value: "90", label: "90 days" },
          { value: "120", label: "120 days" }
        ],
        default: "disabled"
      }
    }
  ];

  let robotConfigs = {};
  let selectedOrg = null;

  const showNotificationsPage = () => {
    hide($("prSections"));
    hide($("statsPage"));
    hide($("settingsPage"));
    show($("notificationsPage"));
    
    // Add click handler for "Configure in Robot Army" button
    const goToRobotArmyBtn = $("goToRobotArmy");
    if (goToRobotArmyBtn) {
      goToRobotArmyBtn.onclick = () => {
        showSettingsPage();
      };
    }
  };
  
  const showSettingsPage = async () => {
    hide($("prSections"));
    hide($("statsPage"));
    hide($("notificationsPage"));
    show($("settingsPage"));
    
    // Load organizations
    await loadOrganizationsForSettings();
  };

  const loadOrganizationsForSettings = async () => {
    const orgSelect = $("orgSelectSettings");
    if (!orgSelect) return;
    
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Get user's recent activity
      const user = state.currentUser || state.viewingUser;
      if (!user) {
        orgSelect.innerHTML = '<option value="">Please login to view organizations</option>';
        return;
      }
      
      // Fetch recent events
      const events = await githubAPI(`/users/${user.login}/events/public?per_page=100`);
      
      // Extract unique organizations where user has been active
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
      
      // Also add user's organizations
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
    
    // Update YAML path displays
    const yamlPath = `${selectedOrg}/.github/.github/codegroove.yaml`;
    const yamlPathEl = $("yamlPath");
    const yamlPathModalEl = $("yamlPathModal");
    if (yamlPathEl) yamlPathEl.textContent = yamlPath;
    if (yamlPathModalEl) yamlPathModalEl.textContent = yamlPath;
    
    // Show robot configuration
    show($("robotConfig"));
    renderRobotCards();
  };

  const renderRobotCards = () => {
    const container = $("robotCards");
    if (!container) return;
    
    container.innerHTML = robotDefinitions.map(robot => createRobotCard(robot)).join("");
    
    // Add event listeners
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
      
      // Handle specific config types
      if (robot.id === "slackchan" || robot.id === "slackdm") {
        const addBtn = $(`add-mapping-${robot.id}`);
        if (addBtn) {
          addBtn.addEventListener("click", () => addMapping(robot.id));
        }
      }
    });
    
    // Add export button listener
    const exportBtn = $("exportConfig");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportConfiguration);
    }
  };

  const createRobotCard = (robot) => {
    const isEnabled = robotConfigs[robot.id]?.enabled || false;
    const configHtml = renderRobotConfig(robot);
    
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
            <button id="preview-${robot.id}" class="btn-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Preview Steps
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
          return ''; // Toggle is handled by the main switch
          
        default:
          return '';
      }
    }).join('');
  };

  const onRobotToggle = (robotId, enabled) => {
    if (!robotConfigs[robotId]) {
      robotConfigs[robotId] = {};
    }
    robotConfigs[robotId].enabled = enabled;
    
    // Update the card's visual state without re-rendering
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
        const reviewerCount = document.getElementById(`config-${robot.id}-select`)?.value || 'disabled';
        if (reviewerCount === 'disabled') {
          return ['❌ AutoAssign is disabled'];
        }
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
        const closeDays = document.getElementById(`config-${robot.id}-select`)?.value || 'disabled';
        if (closeDays === 'disabled') {
          return ['❌ AutoClose is disabled'];
        }
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
      
      // Add robot-specific configuration
      const configs = Array.isArray(robot.config) ? robot.config : [robot.config];
      
      configs.forEach(config => {
        switch (config.type) {
          case 'select':
            const selectValue = document.getElementById(`config-${robot.id}-select`)?.value;
            if (selectValue && selectValue !== 'disabled') {
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
              yaml += `    topic_filter: "${textValue}"\n`;
            }
            break;
            
          case 'mappings':
            const mappingsContainer = $(`mappings-${robot.id}`);
            if (mappingsContainer) {
              const mappings = Array.from(mappingsContainer.querySelectorAll('.robot-mapping'));
              if (mappings.length > 0) {
                yaml += `    mappings:\n`;
                mappings.forEach(mapping => {
                  const inputs = mapping.querySelectorAll('input');
                  if (inputs[0]?.value && inputs[1]?.value) {
                    yaml += `      "${inputs[0].value}": "${inputs[1].value}"\n`;
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

  const closeYamlModal = () => {
    hide($("yamlModal"));
  };

  const copyYaml = async () => {
    const yamlContent = $("yamlContent")?.textContent;
    if (!yamlContent) return;
    
    try {
      await navigator.clipboard.writeText(yamlContent);
      showToast("Configuration copied to clipboard!", "success");
    } catch (error) {
      console.error("Failed to copy:", error);
      showToast("Failed to copy to clipboard", "error");
    }
  };

  // Public API
  return {
    init,
    logout,
    initiateLogin: () => (window.initiateLogin = initiateLogin),
    initiateOAuthLogin,
    showGitHubAppModal,
    closeGitHubAppModal,
    proceedWithOAuth,
    initiatePATLogin,
    closePATModal,
    submitPAT,
    removeMapping,
    closeYamlModal,
    copyYaml,
  };
})();

// Start the app
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", App.init);
} else {
  App.init();
}

// Expose necessary functions to window
window.App = App;
window.initiateLogin = App.initiateLogin();
