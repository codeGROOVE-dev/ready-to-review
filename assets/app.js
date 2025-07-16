// Ready To Review - Modern ES6+ Application

const App = (() => {
  'use strict';

  // Configuration
  const CONFIG = {
    CLIENT_ID: 'Iv23liYmAKkBpvhHAnQQ',
    API_BASE: 'https://api.github.com',
    STORAGE_KEY: 'github_token',
    COOKIE_KEY: 'github_pat',
    SEARCH_LIMIT: 100,
    OAUTH_REDIRECT_URI: window.location.origin + '/oauth/callback',
  };

  // Cookie Functions
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
  }

  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
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
      outgoing: []
    },
    isDemoMode: false,
  };
  
  // Parse URL to get viewing context
  const parseURL = () => {
    const path = window.location.pathname;
    const match = path.match(/^\/github\/(all|[^\/]+)\/([^\/]+)$/);
    
    if (match) {
      const [, orgOrAll, username] = match;
      return {
        org: orgOrAll === 'all' ? null : orgOrAll,
        username: username
      };
    }
    
    return null;
  };

  // DOM Helpers
  const $ = id => document.getElementById(id);
  const $$ = selector => document.querySelectorAll(selector);
  const show = el => el && el.removeAttribute('hidden');
  const hide = el => el && el.setAttribute('hidden', '');

  // Utilities
  const escapeHtml = text => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const formatTimeAgo = timestamp => {
    const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
    
    const years = Math.floor(seconds / 31536000);
    return `${years}y ago`;
  };

  const getAgeText = pr => {
    const days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d';
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    
    const years = Math.floor(days / 365);
    return `${years}y`;
  };
  
  const isStale = pr => {
    // Consider a PR stale if it hasn't been updated in 90 days
    const daysSinceUpdate = Math.floor((Date.now() - new Date(pr.updated_at)) / 86400000);
    return daysSinceUpdate >= 90;
  };
  
  const isBlockedOnOthers = pr => {
    // PR is "blocked on others" if it has loaded data from turnserver but is NOT "blocked on you"
    if (!pr.status_tags || pr.status_tags.length === 0) return false;
    if (pr.status_tags.includes('loading')) return false; // Still loading from turnserver
    if (pr.status_tags.includes('blocked on you')) return false; // This is blocked on you, not others
    
    // If we get here, turnserver has responded and it's not blocked on you
    return true;
  };

  // API Functions
  const githubAPI = async (endpoint, options = {}) => {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers
    };
    
    if (state.accessToken) {
      headers['Authorization'] = `token ${state.accessToken}`;
    }
    
    const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        handleAuthError();
      }
      throw new Error(`API Error: ${response.status}`);
    }
    
    return response.json();
  };

  const turnAPI = async (prUrl, updatedAt) => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'turnclient/1.0'
    };
    
    // Use GitHub token for Turn API authentication
    if (state.accessToken) {
      headers['Authorization'] = `Bearer ${state.accessToken}`;
    }
    
    try {
      const response = await fetch('https://turn.ready-to-review.dev/v1/validate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: prUrl,
          updated_at: updatedAt
        }),
        mode: 'cors'
      });
      
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
    state.currentUser = await githubAPI('/user');
  };

  const loadPullRequests = async () => {
    // Use viewingUser if set, otherwise use currentUser
    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) {
      console.error('No user to load PRs for');
      return;
    }
    
    const query = `is:open is:pr involves:${targetUser.login} archived:false`;
    const searchResponse = await githubAPI(`/search/issues?q=${encodeURIComponent(query)}&per_page=${CONFIG.SEARCH_LIMIT}`);
    
    const prs = searchResponse.items.map(pr => ({
      ...pr,
      repository: {
        full_name: pr.repository_url.split('/repos/')[1]
      }
    }));
    
    // First pass: categorize PRs and render immediately
    state.pullRequests = {
      incoming: [],
      outgoing: []
    };
    
    for (const pr of prs) {
      // Enhanced PR with calculated fields
      pr.age_days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
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
        const urlParts = pr.repository_url.split('/');
        const owner = urlParts[urlParts.length - 2];
        const repo = urlParts[urlParts.length - 1];
        
        const prDetails = await githubAPI(`/repos/${owner}/${repo}/pulls/${pr.number}`);
        pr.additions = prDetails.additions;
        pr.deletions = prDetails.deletions;
        
        // Update just this PR card to show the size
        updateSinglePRCard(pr);
      } catch (error) {
        console.error(`Failed to fetch PR details for ${pr.html_url}:`, error);
      }
    };
    
    // Start fetching PR details for all PRs
    const detailPromises = prs.map(pr => fetchPRDetails(pr));
    
    // Then fetch Turn API data asynchronously
    if (!state.isDemoMode) {
      const turnPromises = prs.map(async (pr) => {
        try {
          const turnData = await turnAPI(pr.html_url, new Date(pr.updated_at).toISOString());
          pr.turnData = turnData;
          
          // Update status tags with real data
          pr.status_tags = getStatusTags(pr);
          
          // Use Turn API's recent_activity if available
          const recentActivity = turnData?.recent_activity;
          if (recentActivity) {
            pr.last_activity = {
              type: recentActivity.type,
              message: recentActivity.message,
              timestamp: recentActivity.timestamp,
              actor: recentActivity.author
            };
          }
          
          // Update just this PR card in the UI
          updateSinglePRCard(pr);
        } catch (error) {
          console.error(`Failed to load turn data for PR ${pr.html_url}:`, error);
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

  const getStatusTags = pr => {
    // Demo mode uses labels
    if (state.isDemoMode && pr.labels) {
      const tags = [];
      pr.labels.forEach(label => {
        if (label.name === 'blocked on you') tags.push('blocked on you');
        if (label.name === 'ready to merge') tags.push('ready-to-merge');
        if (label.name === 'stale') tags.push('stale');
      });
      return tags;
    }
    
    // If we have turnData (even if empty), the API call completed
    if (pr.turnData !== undefined) {
      // If turnData is null or has no tags, return empty array
      if (!pr.turnData || !pr.turnData.tags) {
        return [];
      }
      
      const tags = [...pr.turnData.tags];
      
      // Check if user is in NextAction list
      if (pr.turnData.NextAction && state.currentUser) {
        const userAction = pr.turnData.NextAction[state.currentUser.login];
        if (userAction) {
          // Add "blocked on you" tag
          if (!tags.includes('blocked on you')) {
            tags.push('blocked on you');
          }
          
          // Add specific needs-X tag based on action kind
          const actionKind = userAction.Kind;
          if (actionKind) {
            const kindLower = actionKind.toLowerCase();
            const needsMap = {
              'review': 'needs-review',
              'approve': 'needs-approval',
              'respond': 'needs-response',
              'fix': 'needs-fix',
              'merge': 'needs-merge',
              'address': 'needs-changes'
            };
            tags.push(needsMap[kindLower] || `needs-${kindLower}`);
          }
        }
      }
      
      // Normalize tag names
      return tags.map(tag => {
        if (tag === 'ready_to_merge') return 'ready-to-merge';
        return tag;
      });
    }
    
    // If turnData is undefined, we're still loading
    return ['loading'];
  };


  // UI Functions
  const updateUserDisplay = () => {
    const userInfo = $('userInfo');
    if (!userInfo) return;
    
    // Show whose dashboard we're viewing
    const viewingUser = state.viewingUser || state.currentUser;
    let displayContent = '';
    
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
    const loginBtn = $('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', initiateLogin);
    }
  };

  const updateOrgFilter = () => {
    const orgSelect = $('orgSelect');
    if (!orgSelect) return;
    
    // Extract unique organizations from PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing
    ];
    
    const uniqueOrgs = [...new Set(allPRs.map(pr => pr.repository.full_name.split('/')[0]))].sort();
    
    orgSelect.innerHTML = '<option value="">All Organizations</option>';
    uniqueOrgs.forEach(org => {
      const option = document.createElement('option');
      option.value = org;
      option.textContent = org;
      orgSelect.appendChild(option);
    });
    
    // Restore selection from URL
    const urlParams = new URLSearchParams(window.location.search);
    const orgParam = urlParams.get('org');
    if (orgParam && uniqueOrgs.includes(orgParam)) {
      orgSelect.value = orgParam;
    }
  };

  const updatePRSections = () => {
    // Update counts
    $('incomingCount').textContent = state.pullRequests.incoming.length;
    $('outgoingCount').textContent = state.pullRequests.outgoing.length;
    
    // Update filter counts
    updateFilterCounts();
    
    // Render PR lists
    renderPRList($('incomingPRs'), state.pullRequests.incoming, false, 'incoming');
    renderPRList($('outgoingPRs'), state.pullRequests.outgoing, false, 'outgoing');
    
    // Update empty state
    const totalPRs = state.pullRequests.incoming.length + 
                    state.pullRequests.outgoing.length;
    
    const emptyState = $('emptyState');
    if (totalPRs === 0) {
      show(emptyState);
    } else {
      hide(emptyState);
    }
  };

  const updateFilterCounts = () => {
    // Count stale and blocked on others PRs for each section
    const sections = [
      { prs: state.pullRequests.incoming, prefix: 'incoming' },
      { prs: state.pullRequests.outgoing, prefix: 'outgoing' }
    ];
    
    sections.forEach(({ prs, prefix }) => {
      // Use local calculation for stale count
      const staleCount = prs.filter(pr => isStale(pr)).length;
      // Use proper blocked on others calculation
      const blockedOthersCount = prs.filter(pr => isBlockedOnOthers(pr)).length;
      
      // Update checkbox labels with counts
      const staleLabel = $(`${prefix}FilterStale`)?.nextElementSibling;
      const blockedOthersLabel = $(`${prefix}FilterBlockedOthers`)?.nextElementSibling;
      
      if (staleLabel) {
        staleLabel.textContent = `Include stale (${staleCount})`;
      }
      
      if (blockedOthersLabel) {
        blockedOthersLabel.textContent = `Include blocked on others (${blockedOthersCount})`;
      }
    });
  };

  const updateAverages = (section, filteredPRs) => {
    // Calculate average age for filtered PRs
    if (filteredPRs.length === 0) {
      const avgElement = $(`${section}Average`);
      if (avgElement) avgElement.textContent = '';
      return;
    }
    
    const avgAge = Math.round(filteredPRs.reduce((sum, pr) => sum + pr.age_days, 0) / filteredPRs.length) || 0;
    const avgElement = $(`${section}Average`);
    
    if (avgAge > 0 && avgElement) {
      avgElement.textContent = `avg ${avgAge}d open`;
    } else if (avgElement) {
      avgElement.textContent = '';
    }
  };

  const renderPRList = (container, prs, isDraft = false, section = '') => {
    if (!container) return;
    
    const orgSelect = $('orgSelect');
    const selectedOrg = orgSelect?.value;
    
    // Get section-specific filter states from cookies or default to true
    let showStale = true;
    let showBlockedOthers = true;
    
    if (section === 'incoming') {
      showStale = getCookie('incomingFilterStale') !== 'false';
      showBlockedOthers = getCookie('incomingFilterBlockedOthers') !== 'false';
      // Update checkbox states from cookies
      if ($('incomingFilterStale')) $('incomingFilterStale').checked = showStale;
      if ($('incomingFilterBlockedOthers')) $('incomingFilterBlockedOthers').checked = showBlockedOthers;
    } else if (section === 'outgoing') {
      showStale = getCookie('outgoingFilterStale') !== 'false';
      showBlockedOthers = getCookie('outgoingFilterBlockedOthers') !== 'false';
      // Update checkbox states from cookies
      if ($('outgoingFilterStale')) $('outgoingFilterStale').checked = showStale;
      if ($('outgoingFilterBlockedOthers')) $('outgoingFilterBlockedOthers').checked = showBlockedOthers;
    }
    
    // Apply filters
    let filteredPRs = prs;
    
    // Filter by organization
    if (selectedOrg) {
      filteredPRs = filteredPRs.filter(pr => pr.repository.full_name.startsWith(selectedOrg + '/'));
    }
    
    // Filter stale PRs (using local calculation based on updated_at)
    if (!showStale) {
      filteredPRs = filteredPRs.filter(pr => !isStale(pr));
    }
    
    // Filter blocked on others PRs
    if (!showBlockedOthers) {
      filteredPRs = filteredPRs.filter(pr => !isBlockedOnOthers(pr));
    }
    
    // Sort by most recently updated with drafts at bottom
    const sortedPRs = [...filteredPRs].sort((a, b) => {
      // Drafts always go to bottom (using GitHub's draft field, not tags)
      if (a.draft && !b.draft) return 1;
      if (!a.draft && b.draft) return -1;
      
      // Within non-drafts or within drafts, apply priority sorting
      if (a.draft === b.draft) {
        // First priority: blocked on you (only for non-drafts)
        if (!a.draft && !b.draft) {
          if (a.status_tags?.includes('blocked on you') && !b.status_tags?.includes('blocked on you')) return -1;
          if (!a.status_tags?.includes('blocked on you') && b.status_tags?.includes('blocked on you')) return 1;
          
          // Second priority: ready to merge (only for non-drafts)
          if (a.status_tags?.includes('ready-to-merge') && !b.status_tags?.includes('ready-to-merge')) return -1;
          if (!a.status_tags?.includes('ready-to-merge') && b.status_tags?.includes('ready-to-merge')) return 1;
        }
        
        // Default: sort by updated_at (most recent first)
        return new Date(b.updated_at) - new Date(a.updated_at);
      }
      
      return 0;
    });
    
    container.innerHTML = sortedPRs.map(pr => createPRCard(pr)).join('');
    
    // Update average for this section with filtered PRs
    if (section === 'incoming' || section === 'outgoing') {
      updateAverages(section, filteredPRs);
    }
  };

  const createPRCard = pr => {
    const state = getPRState(pr);
    const badges = buildBadges(pr);
    const ageText = getAgeText(pr);
    const reviewers = buildReviewers(pr.requested_reviewers || []);
    const needsAction = pr.status_tags?.includes('blocked on you');
    
    // Get activity type icon
    const getActivityIcon = (type) => {
      const icons = {
        commit: '<path d="M4 1.5H3a2 2 0 00-2 2V14a2 2 0 002 2h10a2 2 0 002-2V3.5a2 2 0 00-2-2h-1v1h1a1 1 0 011 1V14a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1h1v-1z"/><path d="M9.5 1a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h3zm-3-1A1.5 1.5 0 005 1.5v1A1.5 1.5 0 006.5 4h3A1.5 1.5 0 0011 2.5v-1A1.5 1.5 0 009.5 0h-3z"/><path d="M3.5 6.5A.5.5 0 014 7v1h3.5a.5.5 0 010 1H4v1a.5.5 0 01-1 0v-1H1.5a.5.5 0 010-1H3V7a.5.5 0 01.5-.5z"/><path d="M8 11a1 1 0 100-2 1 1 0 000 2z"/>',
        comment: '<path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zM2 0a2 2 0 00-2 2v12.793a.5.5 0 00.854.353l2.853-2.853A1 1 0 014.414 12H14a2 2 0 002-2V2a2 2 0 00-2-2H2z"/>',
        review: '<path d="M10.854 5.146a.5.5 0 010 .708l-3 3a.5.5 0 01-.708 0l-1.5-1.5a.5.5 0 11.708-.708L7.5 7.793l2.646-2.647a.5.5 0 01.708 0z"/><path d="M2 2a2 2 0 012-2h8a2 2 0 012 2v13.5a.5.5 0 01-.777.416L8 13.101l-5.223 2.815A.5.5 0 012 15.5V2zm2-1a1 1 0 00-1 1v12.566l4.723-2.482a.5.5 0 01.554 0L13 14.566V2a1 1 0 00-1-1H4z"/>',
        approve: '<path d="M10.97 4.97a.75.75 0 011.071 1.05l-3.992 4.99a.75.75 0 01-1.08.02L4.324 8.384a.75.75 0 111.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 01.02-.022z"/><path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0 1A8 8 0 108 0a8 8 0 000 16z"/>',
        merge: '<path d="M5 3.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm0 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm8.25-6.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/><path d="M1.75 5.5v5a.75.75 0 001.5 0v-5a.75.75 0 00-1.5 0zm6.5-3.25a.75.75 0 000 1.5h1.5v2.5a2.25 2.25 0 01-2.25 2.25h-1a.75.75 0 000 1.5h1a3.75 3.75 0 003.75-3.75v-2.5h1.5a.75.75 0 000-1.5h-5z"/>',
        push: '<path d="M1 2.5A2.5 2.5 0 013.5 0h8.75a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V1.5h-8a1 1 0 00-1 1v6.708A2.492 2.492 0 013.5 9h3.25a.75.75 0 010 1.5H3.5a1 1 0 100 2h5.75a.75.75 0 010 1.5H3.5A2.5 2.5 0 011 11.5v-9z"/><path d="M7.25 11.25a.75.75 0 01.75-.75h5.25a.75.75 0 01.53 1.28l-1.72 1.72h3.69a.75.75 0 010 1.5h-5.25a.75.75 0 01-.53-1.28l1.72-1.72H8a.75.75 0 01-.75-.75z"/>'
      };
      
      const iconPath = icons[type] || icons.comment; // Default to comment icon
      return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">${iconPath}</svg>`;
    };
    
    // Format recent activity and actions in a single row
    const bottomSection = pr.last_activity ? `
      <div class="pr-bottom-row">
        <div class="pr-recent-activity">
          <div class="activity-icon">
            ${getActivityIcon(pr.last_activity.type)}
          </div>
          <div class="activity-content">
            <span class="activity-message">${pr.last_activity.message}</span>
            ${pr.last_activity.actor ? `<span class="activity-actor">by ${pr.last_activity.actor}</span>` : ''}
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
    ` : `
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
      <div class="pr-card" data-state="${state}" data-pr-id="${pr.id}" ${needsAction ? 'data-needs-action="true"' : ''} ${pr.draft ? 'data-draft="true"' : ''}>
        <div class="pr-header">
          <a href="${pr.html_url}" class="pr-title" target="_blank" rel="noopener">
            ${escapeHtml(pr.title)}
          </a>
          ${badges ? `<div class="pr-badges">${badges}</div>` : ''}
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

  const updateSinglePRCard = pr => {
    // Find the existing PR card
    const existingCard = document.querySelector(`[data-pr-id="${pr.id}"]`);
    if (!existingCard) return;
    
    // Determine which section this PR belongs to
    const section = existingCard.closest('#incomingPRs') ? 'incoming' : 'outgoing';
    
    // Check current filter settings
    const showStale = getCookie(`${section}FilterStale`) !== 'false';
    const showBlockedOthers = getCookie(`${section}FilterBlockedOthers`) !== 'false';
    
    // Check if this PR should be hidden based on filters
    const shouldHide = (!showStale && isStale(pr)) || (!showBlockedOthers && isBlockedOnOthers(pr));
    
    if (shouldHide) {
      // Hide the card with a fade out animation
      existingCard.style.transition = 'opacity 0.3s ease-out';
      existingCard.style.opacity = '0';
      setTimeout(() => {
        existingCard.style.display = 'none';
      }, 300);
    } else {
      // Update the card content
      const newCardHTML = createPRCard(pr);
      
      // Create a temporary container to parse the new HTML
      const temp = document.createElement('div');
      temp.innerHTML = newCardHTML;
      const newCard = temp.firstElementChild;
      
      // Replace the old card with the new one
      existingCard.parentNode.replaceChild(newCard, existingCard);
      
      // Add fade-in animation for badges and recent activity
      const badges = newCard.querySelectorAll('.badge');
      badges.forEach(badge => {
        badge.style.animation = 'fadeIn 0.3s ease-out';
      });
      
      const bottomRow = newCard.querySelector('.pr-bottom-row');
      if (bottomRow) {
        bottomRow.style.animation = 'fadeIn 0.4s ease-out';
      }
    }
    
    // Update filter counts since tags may have changed
    updateFilterCounts();
  };

  const getPRState = pr => {
    // Priority order for states
    if (pr.status_tags?.includes('blocked on you') || pr.status_tags?.some(tag => tag.startsWith('needs-'))) return 'blocked';
    if (pr.status_tags?.includes('tests_failing')) return 'blocked';
    if (pr.status_tags?.includes('merge_conflict')) return 'blocked';
    if (pr.status_tags?.includes('changes_requested')) return 'blocked';
    if (pr.status_tags?.includes('stale')) return 'stale';
    if (pr.draft || pr.status_tags?.includes('draft')) return 'draft';
    if (pr.status_tags?.includes('ready-to-merge') || pr.status_tags?.includes('ready_to_merge')) return 'ready';
    if (pr.status_tags?.includes('has_approval') && pr.status_tags?.includes('all_checks_passing')) return 'ready';
    return 'default';
  };

  const getPRSize = pr => {
    const delta = Math.abs((pr.additions || 0) - (pr.deletions || 0));
    
    if (delta <= 6) return 'XXS';
    if (delta <= 12) return 'XS';
    if (delta <= 25) return 'S';
    if (delta <= 50) return 'M';
    if (delta <= 100) return 'L';
    if (delta <= 400) return 'XL';
    if (delta <= 800) return 'XXL';
    return 'INSANE';
  };

  const buildBadges = pr => {
    const badges = [];
    
    // Size badge always shows first (if we have the data)
    if (pr.additions !== undefined && pr.deletions !== undefined) {
      const size = getPRSize(pr);
      const additions = pr.additions || 0;
      const deletions = pr.deletions || 0;
      badges.push(`<span class="badge badge-size badge-size-${size.toLowerCase()}" title="+${additions}/-${deletions}">${size}</span>`);
    }
    
    if (pr.status_tags?.includes('loading')) {
      badges.push('<span class="badge badge-loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>');
    }
    
    if (pr.status_tags?.includes('blocked on you')) {
      badges.push('<span class="badge badge-blocked"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM4 8a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 8z"/></svg>BLOCKED ON YOU</span>');
    }
    
    if (pr.draft || pr.status_tags?.includes('draft')) {
      badges.push('<span class="badge badge-draft">DRAFT</span>');
    }
    
    if (pr.status_tags?.includes('ready-to-merge') || pr.status_tags?.includes('ready_to_merge')) {
      badges.push('<span class="badge badge-ready">READY</span>');
    }
    
    if (pr.status_tags?.includes('merge_conflict')) {
      badges.push('<span class="badge badge-conflict">MERGE CONFLICT</span>');
    }
    
    if (pr.status_tags?.includes('changes_requested')) {
      badges.push('<span class="badge badge-changes-requested">CHANGES REQUESTED</span>');
    }
    
    if (pr.status_tags?.includes('tests_failing')) {
      badges.push('<span class="badge badge-tests-failing">TESTS FAILING</span>');
    }
    
    if (pr.status_tags?.includes('tests_pending')) {
      badges.push('<span class="badge badge-tests-pending">TESTS PENDING</span>');
    }
    
    if (pr.status_tags?.includes('has_approval')) {
      badges.push('<span class="badge badge-approved">APPROVED</span>');
    }
    
    if (pr.status_tags?.includes('all_checks_passing')) {
      badges.push('<span class="badge badge-checks-passing">CHECKS PASSING</span>');
    }
    
    // Time-based badges
    if (pr.status_tags?.includes('new')) {
      badges.push('<span class="badge badge-new">NEW</span>');
    }
    
    if (pr.status_tags?.includes('updated')) {
      badges.push('<span class="badge badge-updated">UPDATED</span>');
    }
    
    if (pr.status_tags?.includes('stale') || isStale(pr)) {
      badges.push('<span class="badge badge-stale">STALE</span>');
    }
    
    // Add needs-X badges
    if (pr.status_tags?.includes('needs-review')) {
      badges.push('<span class="badge badge-needs-action">NEEDS REVIEW</span>');
    }
    
    if (pr.status_tags?.includes('needs-approval')) {
      badges.push('<span class="badge badge-needs-action">NEEDS APPROVAL</span>');
    }
    
    if (pr.status_tags?.includes('needs-response')) {
      badges.push('<span class="badge badge-needs-action">NEEDS RESPONSE</span>');
    }
    
    if (pr.status_tags?.includes('needs-fix')) {
      badges.push('<span class="badge badge-needs-action">NEEDS FIX</span>');
    }
    
    if (pr.status_tags?.includes('needs-merge')) {
      badges.push('<span class="badge badge-needs-action">NEEDS MERGE</span>');
    }
    
    if (pr.status_tags?.includes('needs-changes')) {
      badges.push('<span class="badge badge-needs-action">NEEDS CHANGES</span>');
    }
    
    // Generic needs-X handler for unknown action kinds
    pr.status_tags?.forEach(tag => {
      if (tag.startsWith('needs-') && !['needs-review', 'needs-approval', 'needs-response', 'needs-fix', 'needs-merge', 'needs-changes'].includes(tag)) {
        const action = tag.substring(6).toUpperCase();
        badges.push(`<span class="badge badge-needs-action">NEEDS ${action}</span>`);
      }
    });
    
    return badges.join('');
  };

  const buildReviewers = reviewers => {
    if (!reviewers.length) return '';
    
    const maxShow = 3;
    const avatars = reviewers.slice(0, maxShow).map(reviewer => 
      `<img src="${reviewer.avatar_url}" alt="${reviewer.login}" class="reviewer-avatar" loading="lazy" title="${reviewer.login}">`
    ).join('');
    
    const extra = reviewers.length > maxShow ? 
      `<span class="reviewer-count">+${reviewers.length - maxShow}</span>` : '';
    
    return `<div class="reviewers">${avatars}${extra}</div>`;
  };

  // Event Handlers
  const handleOrgChange = () => {
    const orgSelect = $('orgSelect');
    const selectedOrg = orgSelect?.value;
    
    // Get current viewing user
    const targetUser = state.viewingUser || state.currentUser;
    if (!targetUser) return;
    
    // Update URL to new format
    let newPath;
    if (selectedOrg) {
      newPath = `/github/${selectedOrg}/${targetUser.login}`;
    } else {
      newPath = `/github/all/${targetUser.login}`;
    }
    
    window.history.pushState({}, '', newPath);
    
    updatePRSections();
  };

  const handleSearch = () => {
    const searchInput = $('searchInput');
    const searchTerm = searchInput?.value.toLowerCase() || '';
    
    $$('.pr-card').forEach(card => {
      const title = card.querySelector('.pr-title')?.textContent.toLowerCase() || '';
      const repo = card.querySelector('.pr-repo')?.textContent.toLowerCase() || '';
      const author = card.querySelector('.pr-author')?.textContent.toLowerCase() || '';
      
      const matches = !searchTerm || 
        title.includes(searchTerm) || 
        repo.includes(searchTerm) || 
        author.includes(searchTerm);
      
      card.style.display = matches ? '' : 'none';
    });
    
    // Update empty state
    const visibleCards = $$('.pr-card:not([style*="display: none"])').length;
    const emptyState = $('emptyState');
    if (visibleCards === 0 && searchTerm) {
      show(emptyState);
    } else if (visibleCards > 0) {
      hide(emptyState);
    }
  };
  
  const handlePRAction = async (action, prId) => {
    // Find PR in all sections
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing
    ];
    const pr = allPRs.find(p => p.id.toString() === prId);
    if (!pr) return;
    
    const token = getStoredToken();
    if (!token) {
      showToast('Please login to perform this action', 'error');
      return;
    }
    
    try {
      let response;
      const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      };
      
      switch (action) {
        case 'merge':
          response = await fetch(`${CONFIG.API_BASE}/repos/${pr.repository.full_name}/pulls/${pr.number}/merge`, {
            method: 'PUT',
            headers: {
              ...headers,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              commit_title: `Merge pull request #${pr.number}${pr.head?.ref ? ` from ${pr.head.ref}` : ''}`,
              commit_message: pr.title || `Merge PR #${pr.number}`
            })
          });
          
          if (response.ok) {
            showToast('PR merged successfully', 'success');
            // Remove PR from state
            ['incoming', 'outgoing'].forEach(section => {
              const index = state.pullRequests[section].findIndex(p => p.id.toString() === prId);
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            let errorMsg = 'Failed to merge PR';
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              // If JSON parsing fails, use status text
              errorMsg = `Failed to merge PR: ${response.statusText}`;
            }
            showToast(errorMsg, 'error');
          }
          break;
          
        case 'unassign':
          response = await fetch(`${CONFIG.API_BASE}/repos/${pr.repository.full_name}/issues/${pr.number}/assignees`, {
            method: 'DELETE',
            headers: {
              ...headers,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              assignees: pr.assignees?.map(a => a.login) || []
            })
          });
          
          if (response.ok) {
            showToast('Unassigned from PR', 'success');
            // Refresh the PR list
            updatePRSections();
          } else {
            let errorMsg = 'Failed to unassign';
            try {
              const error = await response.json();
              errorMsg = error.message || error.error || errorMsg;
            } catch (e) {
              errorMsg = `Failed to unassign: ${response.statusText}`;
            }
            showToast(errorMsg, 'error');
          }
          break;
          
        case 'close':
          response = await fetch(`${CONFIG.API_BASE}/repos/${pr.repository.full_name}/pulls/${pr.number}`, {
            method: 'PATCH',
            headers: {
              ...headers,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              state: 'closed'
            })
          });
          
          if (response.ok) {
            showToast('PR closed', 'success');
            // Remove PR from state
            ['incoming', 'outgoing'].forEach(section => {
              const index = state.pullRequests[section].findIndex(p => p.id.toString() === prId);
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            let errorMsg = 'Failed to close PR';
            if (response.status === 403) {
              errorMsg = 'Failed to close PR - Permission denied';
            } else {
              try {
                const error = await response.json();
                errorMsg = error.message || error.error || `Failed to close PR: ${response.statusText}`;
              } catch (e) {
                errorMsg = `Failed to close PR: ${response.statusText}`;
              }
            }
            showToast(errorMsg, 'error');
          }
          break;
      }
    } catch (error) {
      console.error('Error performing PR action:', error);
      // Show the actual error message to the user
      const errorMessage = error.message || 'An error occurred';
      showToast(`Error: ${errorMessage}`, 'error');
    }
  };

  const handleKeyboardShortcuts = e => {
    if (e.target.matches('input, textarea')) return;
    
    const cards = Array.from($$('.pr-card:not([style*="display: none"])')); 
    const currentFocus = document.querySelector('.pr-card.focused');
    const currentIndex = currentFocus ? cards.indexOf(currentFocus) : -1;
    
    switch(e.key) {
      case 'j':
        e.preventDefault();
        if (currentIndex < cards.length - 1) {
          currentFocus?.classList.remove('focused');
          cards[currentIndex + 1].classList.add('focused');
          cards[currentIndex + 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (cards.length > 0 && currentIndex === -1) {
          cards[0].classList.add('focused');
          cards[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        break;
        
      case 'k':
        e.preventDefault();
        if (currentIndex > 0) {
          currentFocus?.classList.remove('focused');
          cards[currentIndex - 1].classList.add('focused');
          cards[currentIndex - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        break;
        
      case 'Enter':
        if (currentFocus) {
          const link = currentFocus.querySelector('.pr-title');
          if (link) window.open(link.href, '_blank');
        }
        break;
        
      case '/':
        e.preventDefault();
        $('searchInput')?.focus();
        break;
    }
  };

  // Auth Functions
  const initiateOAuthLogin = () => {
    // Use the Go backend's OAuth endpoint
    const authWindow = window.open('/oauth/login', 'github-oauth', 'width=600,height=700');
    
    // Listen for OAuth callback
    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'oauth-callback' && event.data.token) {
        storeToken(event.data.token);
        authWindow.close();
        
        // Load user info and redirect to their dashboard
        try {
          state.accessToken = event.data.token;
          await loadCurrentUser();
          window.location.href = `/github/all/${state.currentUser.login}`;
        } catch (error) {
          console.error('Failed to load user after OAuth:', error);
          showToast('Authentication succeeded but failed to load user info', 'error');
        }
      }
    });
  };

  const initiatePATLogin = () => {
    show($('patModal'));
    $('patInput').focus();
  };

  const closePATModal = () => {
    hide($('patModal'));
    $('patInput').value = '';
  };

  const submitPAT = async () => {
    const token = $('patInput').value.trim();
    if (!token) {
      showToast('Please enter a valid token', 'error');
      return;
    }

    // Test the token
    try {
      const testResponse = await fetch(`${CONFIG.API_BASE}/user`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (testResponse.ok) {
        const user = await testResponse.json();
        storeToken(token, true); // Store in cookie
        closePATModal();
        // Redirect to user's dashboard
        window.location.href = `/github/all/${user.login}`;
      } else {
        showToast('Invalid token. Please check and try again.', 'error');
      }
    } catch (error) {
      showToast('Failed to validate token. Please try again.', 'error');
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
    showToast('Authentication failed. Please login again.', 'error');
  };

  const logout = () => {
    clearToken();
    window.location.href = window.location.pathname;
  };

  // UI State Management
  const showLoginPrompt = () => {
    hide($('prSections'));
    show($('loginPrompt'));
  };

  const showMainContent = () => {
    hide($('loginPrompt'));
    show($('prSections'));
  };

  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // Demo Mode
  const initializeDemoMode = () => {
    if (typeof DEMO_DATA === 'undefined') {
      console.error('Demo data not loaded');
      return;
    }
    
    state.isDemoMode = true;
    state.currentUser = DEMO_DATA.user;
    state.viewingUser = DEMO_DATA.user; // Set viewingUser for consistency
    state.pullRequests = DEMO_DATA.pullRequests;
    
    // Enhance demo PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing
    ];
    
    allPRs.forEach(pr => {
      pr.age_days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
      pr.status_tags = getStatusTags(pr);
      // Demo mode uses pre-populated last_activity
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
    const demo = urlParams.get('demo');
    
    // Parse URL for viewing context
    const urlContext = parseURL();
    
    // Setup event listeners
    const orgSelect = $('orgSelect');
    const searchInput = $('searchInput');
    const loginBtn = $('loginBtn');
    
    if (orgSelect) orgSelect.addEventListener('change', handleOrgChange);
    if (searchInput) {
      searchInput.addEventListener('input', handleSearch);
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          handleSearch();
          searchInput.blur();
        }
      });
    }
    if (loginBtn) loginBtn.addEventListener('click', initiateLogin);
    
    // Setup filter event listeners for each section
    ['incoming', 'outgoing'].forEach(section => {
      const staleFilter = $(`${section}FilterStale`);
      const blockedOthersFilter = $(`${section}FilterBlockedOthers`);
      
      if (staleFilter) {
        staleFilter.addEventListener('change', (e) => {
          setCookie(`${section}FilterStale`, e.target.checked.toString(), 365);
          updatePRSections();
        });
      }
      
      if (blockedOthersFilter) {
        blockedOthersFilter.addEventListener('change', (e) => {
          setCookie(`${section}FilterBlockedOthers`, e.target.checked.toString(), 365);
          updatePRSections();
        });
      }
    });
    
    // Add event listener for PAT input Enter key
    const patInput = $('patInput');
    if (patInput) {
      patInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          submitPAT();
        }
      });
    }
    
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Add event delegation for PR action buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('.pr-action-btn')) {
        const btn = e.target.closest('.pr-action-btn');
        const action = btn.dataset.action;
        const prId = btn.dataset.prId;
        handlePRAction(action, prId);
      }
    });
    
    // Check for OAuth callback
    if (urlParams.get('code')) {
      handleOAuthCallback();
      return;
    }
    
    // Check for demo mode
    if (demo === 'true') {
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
        console.error('Error loading user dashboard:', error);
        showToast(`Failed to load dashboard for ${urlContext.username}`, 'error');
        // Redirect to home
        window.location.href = '/';
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
      
      // Redirect to user's dashboard URL
      window.location.href = `/github/all/${state.currentUser.login}`;
    } catch (error) {
      console.error('Error initializing app:', error);
      const errorMessage = error.message || 'Unknown error';
      showToast(`Failed to load data: ${errorMessage}`, 'error');
    }
  };

  // Public API
  return {
    init,
    logout,
    initiateLogin: () => window.initiateLogin = initiateLogin,
    initiateOAuthLogin,
    initiatePATLogin,
    closePATModal,
    submitPAT
  };
})();

// Start the app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}

// Expose necessary functions to window
window.App = App;
window.initiateLogin = App.initiateLogin();