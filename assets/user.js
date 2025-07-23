// User PR Dashboard Module for Ready To Review
import { $, $$, show, hide, escapeHtml } from './utils.js';

export const User = (() => {
  "use strict";

  // DOM Helpers and utilities are imported from utils.js

  // Time constants for performance
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const WEEK = 604800;
  const MONTH = 2592000;
  const YEAR = 31536000;
  
  const formatTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);

    if (seconds < MINUTE) return "just now";
    if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
    if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
    if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`;
    if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w ago`;
    if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo ago`;
    return `${Math.floor(seconds / YEAR)}y ago`;
  };

  const MS_PER_DAY = 86400000;
  const getAgeText = (pr) => {
    const days = Math.floor((Date.now() - new Date(pr.created_at)) / MS_PER_DAY);
    if (days === 0) return "today";
    if (days === 1) return "1d";
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
  };

  const STALE_THRESHOLD_MS = 60 * 86400000; // 60 days in milliseconds
  const isStale = (pr) => {
    return (Date.now() - new Date(pr.updated_at)) >= STALE_THRESHOLD_MS;
  };

  const isBlockedOnOthers = (pr) => {
    if (!pr.status_tags || pr.status_tags.length === 0) return false;
    if (pr.status_tags.includes("loading")) return false;
    if (pr.status_tags.includes("blocked on you")) return false;
    return true;
  };

  // Cookie helper - optimized
  const getCookie = (name) => {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith(nameEQ)) {
        return trimmed.substring(nameEQ.length);
      }
    }
    return null;
  };

  const setCookie = (name, value, days) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
  };

  // Turn API integration with caching
  const turnAPI = async (prUrl, updatedAt, accessToken, currentUser) => {
    // Extract repo and PR number from URL for cache key
    const urlMatch = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (!urlMatch) {
      console.warn(`Invalid PR URL format: ${prUrl}`);
      return null;
    }
    
    const [, owner, repo, prNumber] = urlMatch;
    const TURN_CACHE_KEY = `r2r_turn_${owner}_${repo}_${prNumber}`;
    const TURN_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
    
    // Check cache first
    try {
      const cached = localStorage.getItem(TURN_CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < TURN_CACHE_DURATION) {
          console.log(`Using cached turn data for ${owner}/${repo}#${prNumber} (${Math.round((Date.now() - timestamp) / 60000)}m old)`);
          return data;
        }
      }
    } catch (e) {
      console.log("Error reading turn cache:", e);
    }

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
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
            user: currentUser?.login || "",
          }),
          mode: "cors",
        },
      );

      if (!response.ok) {
        console.warn(`Turn API error for ${prUrl}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      // Cache the result
      try {
        localStorage.setItem(TURN_CACHE_KEY, JSON.stringify({
          data: data,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.log("Error caching turn data:", e);
      }
      
      return data;
    } catch (error) {
      console.warn(`Turn API request failed for ${prUrl}:`, error);
      return null;
    }
  };

  const githubSearchAll = async (searchPath, maxPages = 20, githubAPI) => {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const pagePath = searchPath.includes("?")
        ? `${searchPath}&page=${page}`
        : `${searchPath}?page=${page}`;

      const response = await githubAPI(pagePath);

      if (response.items && response.items.length > 0) {
        // Filter out PRs from archived or disabled repositories
        const activeItems = response.items.filter(pr => {
          if (!pr.repo && !pr.repository) return true; // Keep if no repository data
          const repo = pr.repo || pr.repository;
          return !repo.archived && !repo.disabled;
        });
        allItems.push(...activeItems);

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

  const loadPullRequests = async (state, githubAPI, isDemoMode) => {
    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) {
      console.error("No user to load PRs for");
      return;
    }

    const CACHE_KEY = `r2r_prs_${targetUser.login}`;
    const CACHE_DURATION = 10 * 1000; // 10 seconds
    
    // Check cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { prs, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          console.log(`Using cached PRs for ${targetUser.login} (${Math.round((Date.now() - timestamp) / 1000)}s old)`);
          
          // Apply cached data
          state.pullRequests = {
            incoming: [],
            outgoing: [],
          };
          
          for (const pr of prs) {
            if (pr.user.login === targetUser.login) {
              state.pullRequests.outgoing.push(pr);
            } else {
              state.pullRequests.incoming.push(pr);
            }
          }
          
          updatePRSections(state);
          
          // Still fetch turn data and PR details in background
          setTimeout(() => {
            prs.forEach(pr => {
              fetchPRDetailsBackground(pr, state, githubAPI, isDemoMode);
            });
          }, 0);
          
          return;
        }
      }
    } catch (e) {
      console.log("Error reading PR cache:", e);
    }

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

    const [response1, response2] = await Promise.all([
      githubSearchAll(
        `/search/issues?q=${encodeURIComponent(query1)}&per_page=100`,
        20,
        githubAPI
      ),
      githubSearchAll(
        `/search/issues?q=${encodeURIComponent(query2)}&per_page=100`,
        20,
        githubAPI
      ),
    ]);

    const prMap = new Map();
    // Filter out PRs from archived or disabled repositories
    response1.items
      .filter(pr => !pr.repository || (!pr.repository.archived && !pr.repository.disabled))
      .forEach((pr) => {
        prMap.set(pr.id, pr);
      });
    response2.items
      .filter(pr => !pr.repository || (!pr.repository.archived && !pr.repository.disabled))
      .forEach((pr) => {
        prMap.set(pr.id, pr);
      });

    const allPRs = Array.from(prMap.values());

    console.log(`Found ${response1.items.length} PRs from involves query`);
    console.log(`Found ${response2.items.length} PRs from user repos query`);
    console.log(`Total unique PRs: ${allPRs.length}`);

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

    state.pullRequests = {
      incoming: [],
      outgoing: [],
    };

    for (const pr of prs) {
      pr.age_days = Math.floor(
        (Date.now() - new Date(pr.created_at)) / 86400000,
      );
      pr.status_tags = getStatusTags(pr);

      const targetUser = state.viewingUser || state.currentUser;
      if (pr.user.login === targetUser.login) {
        state.pullRequests.outgoing.push(pr);
      } else {
        state.pullRequests.incoming.push(pr);
      }
    }
    
    // Cache the basic PR data
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        prs: prs.map(pr => ({
          ...pr,
          // Don't cache heavy data that changes frequently
          turnData: undefined,
          prState: undefined
        })),
        timestamp: Date.now()
      }));
    } catch (e) {
      console.log("Error caching PRs:", e);
    }

    updatePRSections(state);

    const fetchPRDetails = async (pr) => {
      try {
        const urlParts = pr.repository_url.split("/");
        const owner = urlParts[urlParts.length - 2];
        const repo = urlParts[urlParts.length - 1];

        const prDetails = await githubAPI(
          `/repos/${owner}/${repo}/pulls/${pr.number}`,
        );
        pr.additions = prDetails.additions;
        pr.deletions = prDetails.deletions;

        updateSinglePRCard(pr, state);
      } catch (error) {
        console.error(`Failed to fetch PR details for ${pr.html_url}:`, error);
      }
    };

    const detailPromises = prs.map((pr) => fetchPRDetails(pr));

    if (!isDemoMode) {
      const turnPromises = prs.map(async (pr) => {
        try {
          const turnResponse = await turnAPI(
            pr.html_url,
            new Date(pr.updated_at).toISOString(),
            state.accessToken,
            state.currentUser
          );

          pr.turnData = turnResponse;
          pr.prState = turnResponse?.pr_state;
          pr.status_tags = getStatusTags(pr);

          const lastActivity = turnResponse?.pr_state?.last_activity;
          if (lastActivity) {
            pr.last_activity = {
              type: lastActivity.kind,
              message: lastActivity.message,
              timestamp: lastActivity.timestamp,
              actor: lastActivity.author,
            };
          }

          updateSinglePRCard(pr, state);
        } catch (error) {
          console.error(
            `Failed to load turn data for PR ${pr.html_url}:`,
            error,
          );
          pr.turnData = null;
          pr.status_tags = getStatusTags(pr);
          updateSinglePRCard(pr, state);
        }
      });

      await Promise.all(turnPromises);
    }

    await Promise.all(detailPromises);
  };
  
  const fetchPRDetailsBackground = async (pr, state, githubAPI, isDemoMode) => {
    // Fetch PR details
    try {
      const urlParts = pr.repository_url.split("/");
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];

      const prDetails = await githubAPI(
        `/repos/${owner}/${repo}/pulls/${pr.number}`,
      );
      pr.additions = prDetails.additions;
      pr.deletions = prDetails.deletions;

      updateSinglePRCard(pr, state);
    } catch (error) {
      console.error(`Failed to fetch PR details for ${pr.html_url}:`, error);
    }
    
    // Fetch turn data
    if (!isDemoMode) {
      try {
        const turnResponse = await turnAPI(
          pr.html_url,
          new Date(pr.updated_at).toISOString(),
          state.accessToken,
          state.currentUser
        );

        pr.turnData = turnResponse;
        pr.prState = turnResponse?.pr_state;
        pr.status_tags = getStatusTags(pr);

        const lastActivity = turnResponse?.pr_state?.last_activity;
        if (lastActivity) {
          pr.last_activity = {
            type: lastActivity.kind,
            message: lastActivity.message,
            timestamp: lastActivity.timestamp,
            actor: lastActivity.author,
          };
        }

        updateSinglePRCard(pr, state);
      } catch (error) {
        console.error(
          `Failed to load turn data for PR ${pr.html_url}:`,
          error,
        );
        pr.turnData = null;
        pr.status_tags = getStatusTags(pr);
        updateSinglePRCard(pr, state);
      }
    }
  };

  const getStatusTags = (pr) => {
    if (pr.turnData !== undefined) {
      if (!pr.turnData || !pr.turnData.pr_state) {
        return [];
      }

      const prState = pr.turnData.pr_state;
      const tags = [];

      if (pr.draft || prState.mergeable_state === "draft") {
        tags.push("draft");
      }

      if (prState.labels) {
        prState.labels.forEach((label) => {
          tags.push(`label:${label}`);
        });
      }

      const blockedOnYou = prState.blocked_on?.you || false;
      const blockedOnOthers = prState.blocked_on?.others || false;

      if (blockedOnYou) {
        tags.push("blocked on you");

        if (prState.needs_review && prState.requested_reviewers?.includes(pr.user?.login)) {
          tags.push("needs-review");
        }
        if (prState.tests_failing) {
          tags.push("needs-fixes", "tests_failing");
        }
        if (prState.has_merge_conflict) {
          tags.push("needs-rebase", "merge_conflict");
        }
        if (prState.changes_requested) {
          tags.push("needs-changes", "changes_requested");
        }
      } else if (blockedOnOthers) {
        tags.push("blocked on others");
      }

      if (prState.approved && prState.all_checks_passing && !prState.has_merge_conflict) {
        tags.push("ready-to-merge");
      }

      if (prState.approved) {
        tags.push("approved");
      }
      if (prState.all_checks_passing) {
        tags.push("all_checks_passing");
      }

      return tags;
    }

    return ["loading"];
  };

  const updateUserDisplay = (state, initiateLogin) => {
    const userInfo = $("userInfo");
    if (!userInfo) return;

    const viewingUser = state.viewingUser || state.currentUser;
    let displayContent = "";

    if (state.currentUser) {
      displayContent = `
        <img src="${state.currentUser.avatar_url}" alt="${state.currentUser.login}" class="user-avatar">
        <span class="user-name">${state.currentUser.name || state.currentUser.login}</span>
        <button onclick="window.App.logout()" class="btn btn-primary">Logout</button>
      `;
    } else if (viewingUser) {
      displayContent = `
        <img src="${viewingUser.avatar_url}" alt="${viewingUser.login}" class="user-avatar">
        <span class="user-name">Viewing: ${viewingUser.name || viewingUser.login}</span>
        <button id="loginBtn" class="btn btn-primary">Login</button>
      `;
    } else {
      displayContent = `<button id="loginBtn" class="btn btn-primary">Login with GitHub</button>`;
    }

    userInfo.innerHTML = displayContent;

    const loginBtn = $("loginBtn");
    if (loginBtn) {
      loginBtn.addEventListener("click", initiateLogin);
    }
  };

  const loadUserOrganizations = async (state, githubAPI) => {
    const CACHE_KEY = 'r2r_user_orgs_cache';
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    
    // Check cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { orgs, timestamp, userId } = JSON.parse(cached);
        const user = state.currentUser || state.viewingUser;
        const currentUserId = user?.login || 'anonymous';
        
        // Return cached data if it's fresh and for the same user
        if (Date.now() - timestamp < CACHE_DURATION && userId === currentUserId) {
          console.log("Using cached organizations:", orgs);
          
          // On PR page, still merge in orgs from loaded PRs
          const urlPath = window.location.pathname;
          if (urlPath === '/' || urlPath.startsWith('/u/')) {
            const prOrgs = new Set(orgs);
            const allPRs = [
              ...state.pullRequests.incoming,
              ...state.pullRequests.outgoing,
            ];
            
            console.log(`Found ${allPRs.length} PRs to check for organizations`);
            
            allPRs.forEach((pr) => {
              if (pr.repository && pr.repository.full_name) {
                const org = pr.repository.full_name.split("/")[0];
                if (!prOrgs.has(org)) {
                  console.log(`Adding org from PR: ${org}`);
                }
                prOrgs.add(org);
              }
            });
            
            const finalOrgs = Array.from(prOrgs).sort();
            console.log("Final organizations list:", finalOrgs);
            return finalOrgs;
          }
          
          return orgs;
        }
      }
    } catch (e) {
      console.log("Error reading org cache:", e);
    }
    
    const orgs = new Set();
    
    try {
      // Get organizations from user membership
      const userOrgs = await githubAPI('/user/orgs');
      userOrgs.forEach(org => orgs.add(org.login));
    } catch (e) {
      console.log("Could not load user orgs (may lack permission)");
    }
    
    try {
      // Get organizations from recent activity
      const user = state.currentUser || state.viewingUser;
      if (user) {
        const events = await githubAPI(`/users/${user.login}/events/public?per_page=100`);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
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
            orgs.add(org);
          }
        });
      }
    } catch (e) {
      console.log("Could not load user events");
    }
    
    // Always include orgs from loaded PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];
    
    allPRs.forEach((pr) => {
      if (pr.repository && pr.repository.full_name) {
        const org = pr.repository.full_name.split("/")[0];
        orgs.add(org);
      }
    });
    
    const orgList = Array.from(orgs).sort();
    
    // Cache the results
    try {
      const user = state.currentUser || state.viewingUser;
      const userId = user?.login || 'anonymous';
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        orgs: orgList,
        timestamp: Date.now(),
        userId: userId
      }));
    } catch (e) {
      console.log("Error caching orgs:", e);
    }
    
    return orgList;
  };

  const updateOrgFilter = async (state, parseURL, githubAPI) => {
    const orgSelect = $("orgSelect");
    if (!orgSelect) return;
    
    console.log("updateOrgFilter called, current PRs:", {
      incoming: state.pullRequests.incoming.length,
      outgoing: state.pullRequests.outgoing.length
    });

    // Load organizations (skip in demo mode)
    let uniqueOrgs = [];
    if (!state.isDemoMode) {
      uniqueOrgs = await loadUserOrganizations(state, githubAPI);
    } else {
      // In demo mode, extract orgs from the PR data
      const prOrgs = new Set();
      [...state.pullRequests.incoming, ...state.pullRequests.outgoing].forEach(pr => {
        const urlParts = pr.repository_url.split("/");
        const org = urlParts[urlParts.length - 2];
        if (org) prOrgs.add(org);
      });
      uniqueOrgs = Array.from(prOrgs).sort();
    }

    // Check if current URL has an organization that should be included
    const urlContext = parseURL();
    const currentOrg = urlContext?.org;
    
    // Ensure current URL org is included in the list, even if not returned by API
    if (currentOrg && !uniqueOrgs.includes(currentOrg)) {
      uniqueOrgs.push(currentOrg);
      uniqueOrgs.sort(); // Keep alphabetical order
    }

    // Update select element
    orgSelect.innerHTML = '<option value="">All Organizations</option>';
    uniqueOrgs.forEach((org) => {
      const option = document.createElement("option");
      option.value = org;
      option.textContent = org;
      orgSelect.appendChild(option);
    });

    // Set selected org from URL if present
    if (currentOrg) {
      orgSelect.value = currentOrg;
    } else {
      // Clear selection if no org in URL or org is '*'
      orgSelect.value = "";
    }
    
    // Update hamburger menu links to reflect org selection
    if (window.App && window.App.updateHamburgerMenuLinks) {
      window.App.updateHamburgerMenuLinks();
    }
  };

  const updatePRSections = (state) => {
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
      renderPRList(container, prs, false, section, state);
    });

    updateFilterCounts(state);

    const emptyState = $("emptyState");
    if (totalVisible === 0) show(emptyState);
    else hide(emptyState);
  };

  const updateFilterCounts = (state) => {
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

  const renderPRList = (container, prs, isDraft = false, section = "", state) => {
    if (!container) return;

    const filteredPRs = applyFilters(prs, section);

    const sortedPRs = [...filteredPRs].sort((a, b) => {
      if (a.draft && !b.draft) return 1;
      if (!a.draft && b.draft) return -1;

      if (a.draft === b.draft) {
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

        return new Date(b.updated_at) - new Date(a.updated_at);
      }

      return 0;
    });

    container.innerHTML = sortedPRs.map((pr) => createPRCard(pr)).join("");

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

      const iconPath = icons[type] || icons.comment;
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">${iconPath}</svg>`;
    };

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

  const updateSinglePRCard = (pr, state) => {
    const existingCard = document.querySelector(`[data-pr-id="${pr.id}"]`);
    if (!existingCard) return;

    const section = existingCard.closest("#incomingPRs")
      ? "incoming"
      : "outgoing";

    const showStale = getCookie(`${section}FilterStale`) !== "false";
    const showBlockedOthers =
      getCookie(`${section}FilterBlockedOthers`) !== "false";

    const shouldHide =
      (!showStale && isStale(pr)) ||
      (!showBlockedOthers && isBlockedOnOthers(pr));

    if (shouldHide) {
      existingCard.style.transition = "opacity 0.3s ease-out";
      existingCard.style.opacity = "0";
      setTimeout(() => {
        existingCard.style.display = "none";
      }, 300);
    } else {
      const newCardHTML = createPRCard(pr);

      const temp = document.createElement("div");
      temp.innerHTML = newCardHTML;
      const newCard = temp.firstElementChild;

      existingCard.parentNode.replaceChild(newCard, existingCard);

      const badges = newCard.querySelectorAll(".badge");
      badges.forEach((badge) => {
        badge.style.animation = "fadeIn 0.3s ease-out";
      });

      const bottomRow = newCard.querySelector(".pr-bottom-row");
      if (bottomRow) {
        bottomRow.style.animation = "fadeIn 0.4s ease-out";
      }
    }

    updateFilterCounts(state);
  };

  const getPRState = (pr) => {
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
    if (delta < 10) return "small";
    if (delta < 100) return "medium";
    if (delta < 500) return "large";
    return "xlarge";
  };

  const buildBadges = (pr) => {
    const badges = [];

    if (pr.draft) {
      badges.push('<span class="badge badge-draft">draft</span>');
    }

    if (pr.status_tags?.includes("loading")) {
      badges.push('<span class="badge badge-loading">Loading</span>');
    } else if (pr.status_tags && pr.status_tags.length > 0) {
      const needsBadges = pr.status_tags
        .filter((tag) => tag.startsWith("needs-") || tag === "blocked on you")
        .map((tag) => {
          if (tag === "blocked on you") {
            return '<span class="badge badge-blocked">blocked on you</span>';
          }
          const displayText = tag.replace("needs-", "").replace(/_/g, " ");
          return `<span class="badge badge-needs">${displayText}</span>`;
        });

      badges.push(...needsBadges);

      if (pr.status_tags.includes("ready-to-merge")) {
        badges.push('<span class="badge badge-ready">ready to merge</span>');
      } else {
        if (pr.status_tags.includes("approved")) {
          badges.push('<span class="badge badge-approved">approved</span>');
        }
        if (pr.status_tags.includes("all_checks_passing")) {
          badges.push('<span class="badge badge-checks">checks passing</span>');
        }
      }

      const labels = pr.status_tags
        .filter((tag) => tag.startsWith("label:"))
        .map((tag) => {
          const label = tag.replace("label:", "");
          return `<span class="badge badge-label">${escapeHtml(label)}</span>`;
        });
      badges.push(...labels);
    }

    if (!pr.status_tags?.includes("loading") && pr.additions !== undefined && pr.deletions !== undefined) {
      const sizeText = getPRSize(pr);
      const totalChanges = (pr.additions || 0) + (pr.deletions || 0);
      badges.push(
        `<span class="badge badge-size badge-size-${sizeText}" title="${pr.additions || 0} additions, ${pr.deletions || 0} deletions">${totalChanges} lines</span>`
      );
    }

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

  const handleOrgChange = (state, parseURL, loadStatsData) => {
    const orgSelect = $("orgSelect");
    const selectedOrg = orgSelect?.value;

    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) return;

    const urlContext = parseURL();
    const isStats = urlContext && urlContext.isStats;

    let newPath;
    const username =
      typeof targetUser === "string" ? targetUser : targetUser.login;

    if (isStats) {
      if (selectedOrg) {
        newPath = `/stats/${selectedOrg}`;
      } else {
        newPath = `/stats`;
      }
    } else {
      if (selectedOrg) {
        newPath = `/user/${selectedOrg}/${username}`;
      } else {
        newPath = `/user/${username}`;
      }
    }

    window.history.pushState({}, "", newPath);

    if (isStats) {
      loadStatsData();
    } else {
      updatePRSections(state);
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

    const visibleCards = $$('.pr-card:not([style*="display: none"])').length;
    const emptyState = $("emptyState");
    if (visibleCards === 0 && searchTerm) {
      show(emptyState);
    } else if (visibleCards > 0) {
      hide(emptyState);
    }
  };

  const handleFilterChange = (filter, section) => {
    const isChecked = $(filter).checked;
    setCookie(filter, isChecked, 365);
    updatePRSections(window.App?.state || {});
  };

  const handlePRAction = async (action, prId, state, githubAPI, showToast) => {
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
    ];
    const pr = allPRs.find((p) => p.id.toString() === prId);
    if (!pr) return;

    const token = state.accessToken;
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
            `https://api.github.com/repos/${pr.repository.full_name}/pulls/${pr.number}/merge`,
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
            ["incoming", "outgoing"].forEach((section) => {
              const index = state.pullRequests[section].findIndex(
                (p) => p.id.toString() === prId,
              );
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            updatePRSections(state);
          } else {
            let errorMsg = "Failed to merge PR";
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              errorMsg = `Failed to merge PR: ${response.statusText}`;
            }
            showToast(errorMsg, "error");
          }
          break;

        case "unassign":
          response = await fetch(
            `https://api.github.com/repos/${pr.repository.full_name}/issues/${pr.number}/assignees`,
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
            updatePRSections(state);
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
            `https://api.github.com/repos/${pr.repository.full_name}/pulls/${pr.number}`,
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
            ["incoming", "outgoing"].forEach((section) => {
              const index = state.pullRequests[section].findIndex(
                (p) => p.id.toString() === prId,
              );
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            updatePRSections(state);
          } else {
            let errorMsg = "Failed to close PR";
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              errorMsg = `Failed to close PR: ${response.statusText}`;
            }
            showToast(errorMsg, "error");
          }
          break;
      }
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      showToast(`Error: ${error.message}`, "error");
    }
  };

  return {
    loadPullRequests,
    loadUserOrganizations,
    updateUserDisplay,
    updateOrgFilter,
    updatePRSections,
    handleOrgChange,
    handleSearch,
    handleFilterChange,
    handlePRAction,
    getStatusTags,
    isStale,
    isBlockedOnOthers,
  };
})();