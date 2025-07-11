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
    OAUTH_REDIRECT_URI: window.location.origin + window.location.pathname,
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
    accessToken: getStoredToken(),
    organizations: [],
    pullRequests: {
      incoming: [],
      outgoing: [],
      drafts: []
    },
    isDemoMode: false,
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
    return new Date(timestamp).toLocaleDateString();
  };

  const getAgeText = pr => {
    const days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d';
    return `${days}d`;
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

  const loadCurrentUser = async () => {
    state.currentUser = await githubAPI('/user');
  };

  const loadPullRequests = async () => {
    const query = `is:open is:pr involves:${state.currentUser.login} archived:false`;
    const searchResponse = await githubAPI(`/search/issues?q=${encodeURIComponent(query)}&per_page=${CONFIG.SEARCH_LIMIT}`);
    
    const prs = searchResponse.items.map(pr => ({
      ...pr,
      repository: {
        full_name: pr.repository_url.split('/repos/')[1]
      }
    }));
    
    // Categorize PRs
    state.pullRequests = {
      incoming: [],
      outgoing: [],
      drafts: []
    };
    
    for (const pr of prs) {
      // Enhanced PR with calculated fields
      pr.age_days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
      pr.status_tags = getStatusTags(pr);
      pr.last_activity = generateMockActivity(pr);
      
      if (pr.draft) {
        state.pullRequests.drafts.push(pr);
      } else if (pr.user.login === state.currentUser.login) {
        state.pullRequests.outgoing.push(pr);
      } else {
        state.pullRequests.incoming.push(pr);
      }
    }
  };

  const getStatusTags = pr => {
    const tags = [];
    
    // Check for labels first if in demo mode
    if (state.isDemoMode && pr.labels) {
      pr.labels.forEach(label => {
        if (label.name === 'blocked on you') tags.push('blocked on you');
        if (label.name === 'ready to merge') tags.push('ready-to-merge');
        if (label.name === 'stale') tags.push('stale');
      });
    } else {
      // Random assignment for non-demo mode
      const randomChance = Math.random();
      if (randomChance < 0.2) tags.push('blocked on you');
      if (randomChance < 0.3 && randomChance >= 0.2) tags.push('blocked on author');
      if (pr.age_days > 7) tags.push('stale');
      if (randomChance < 0.15) tags.push('ready-to-merge');
    }
    
    return tags;
  };

  const generateMockActivity = pr => {
    const activities = [
      { type: 'commit', messages: ['pushed 2 commits', 'pushed a commit', 'force-pushed'] },
      { type: 'comment', messages: ['commented', 'left a review', 'requested changes'] },
      { type: 'review', messages: ['approved changes', 'requested review'] }
    ];
    
    const activity = activities[Math.floor(Math.random() * activities.length)];
    return {
      type: activity.type,
      message: activity.messages[Math.floor(Math.random() * activity.messages.length)],
      timestamp: pr.updated_at,
      actor: pr.user.login
    };
  };

  // UI Functions
  const updateUserDisplay = () => {
    const userInfo = $('userInfo');
    if (!userInfo) return;
    
    userInfo.innerHTML = state.currentUser ? `
      <img src="${state.currentUser.avatar_url}" alt="${state.currentUser.login}" class="user-avatar">
      <span class="user-name">${state.currentUser.name || state.currentUser.login}</span>
      <button onclick="App.logout()" class="btn btn-primary">Logout</button>
    ` : `<button id="loginBtn" class="btn btn-primary">Login with GitHub</button>`;
    
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
      ...state.pullRequests.outgoing,
      ...state.pullRequests.drafts
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
    $('draftCount').textContent = state.pullRequests.drafts.length;
    
    // Update blocked counts
    const incomingBlocked = state.pullRequests.incoming.filter(pr => 
      pr.status_tags?.includes('blocked on you')
    ).length;
    const outgoingBlocked = state.pullRequests.outgoing.filter(pr => 
      pr.status_tags?.includes('blocked on you')
    ).length;
    
    const incomingBlockedEl = $('incomingBlockedCount');
    const outgoingBlockedEl = $('outgoingBlockedCount');
    
    if (incomingBlocked > 0) {
      incomingBlockedEl.textContent = `${incomingBlocked} blocked on you`;
      show(incomingBlockedEl);
    } else {
      hide(incomingBlockedEl);
    }
    
    if (outgoingBlocked > 0) {
      outgoingBlockedEl.textContent = `${outgoingBlocked} blocked on you`;
      show(outgoingBlockedEl);
    } else {
      hide(outgoingBlockedEl);
    }
    
    // Update sparklines
    updateSparklines();
    
    // Render PR lists
    renderPRList($('incomingPRs'), state.pullRequests.incoming);
    renderPRList($('outgoingPRs'), state.pullRequests.outgoing);
    renderPRList($('draftPRs'), state.pullRequests.drafts, true);
    
    // Update empty state
    const totalPRs = state.pullRequests.incoming.length + 
                    state.pullRequests.outgoing.length + 
                    state.pullRequests.drafts.length;
    
    const emptyState = $('emptyState');
    if (totalPRs === 0) {
      show(emptyState);
    } else {
      hide(emptyState);
    }
  };

  const updateSparklines = () => {
    // Simple sparkline implementation
    const createSparkline = (data, width = 60, height = 20, color = '#10b981') => {
      if (!data.length) return '';
      
      const max = Math.max(...data, 1);
      const points = data.map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - (value / max) * height;
        return `${x},${y}`;
      }).join(' ');
      
      return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <polyline
            fill="none"
            stroke="${color}"
            stroke-width="2"
            points="${points}"
          />
        </svg>
      `;
    };
    
    // Mock data for sparklines
    const incomingData = [3, 5, 2, 8, 4, 7, 6];
    const outgoingData = [2, 4, 6, 3, 7, 5, 8];
    const draftData = [1, 2, 1, 3, 2, 4, 3];
    
    $('incomingSparkline').innerHTML = createSparkline(incomingData, 60, 20, '#6366f1');
    $('outgoingSparkline').innerHTML = createSparkline(outgoingData, 60, 20, '#10b981');
    $('draftSparkline').innerHTML = createSparkline(draftData, 60, 20, '#94a3b8');
    
    // Calculate averages
    const avgIncoming = Math.round(state.pullRequests.incoming.reduce((sum, pr) => sum + pr.age_days, 0) / state.pullRequests.incoming.length) || 0;
    const avgOutgoing = Math.round(state.pullRequests.outgoing.reduce((sum, pr) => sum + pr.age_days, 0) / state.pullRequests.outgoing.length) || 0;
    
    if (avgIncoming > 0) $('incomingAverage').textContent = `avg ${avgIncoming}d`;
    if (avgOutgoing > 0) $('outgoingAverage').textContent = `avg ${avgOutgoing}d`;
  };

  const renderPRList = (container, prs, isDraft = false) => {
    if (!container) return;
    
    const orgSelect = $('orgSelect');
    const selectedOrg = orgSelect?.value;
    
    // Filter by organization
    let filteredPRs = prs;
    if (selectedOrg) {
      filteredPRs = prs.filter(pr => pr.repository.full_name.startsWith(selectedOrg + '/'));
    }
    
    // Sort by priority
    const sortedPRs = [...filteredPRs].sort((a, b) => {
      if (a.status_tags?.includes('blocked on you')) return -1;
      if (b.status_tags?.includes('blocked on you')) return 1;
      if (a.status_tags?.includes('ready-to-merge')) return -1;
      if (b.status_tags?.includes('ready-to-merge')) return 1;
      return 0;
    });
    
    container.innerHTML = sortedPRs.map(pr => createPRCard(pr, isDraft)).join('');
  };

  const createPRCard = (pr, isDraft = false) => {
    const state = getPRState(pr, isDraft);
    const badges = buildBadges(pr, isDraft);
    const ageText = getAgeText(pr);
    const activityText = pr.last_activity ? 
      ` <span class="activity-text">• ${pr.last_activity.message} ${formatTimeAgo(pr.last_activity.timestamp)}</span>` : '';
    const reviewers = buildReviewers(pr.requested_reviewers || []);
    const needsAction = pr.status_tags?.includes('blocked on you');
    
    return `
      <div class="pr-card" data-state="${state}" data-pr-id="${pr.id}" ${needsAction ? 'data-needs-action="true"' : ''}>
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
            <span class="pr-author">by ${pr.user.login}${activityText}</span>
          </div>
          <div class="pr-meta-right">
            <span class="pr-age">${ageText}</span>
            ${reviewers}
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
    `;
  };

  const getPRState = (pr, isDraft) => {
    if (pr.status_tags?.includes('blocked on you')) return 'blocked';
    if (pr.status_tags?.includes('stale')) return 'stale';
    if (isDraft) return 'draft';
    if (pr.status_tags?.includes('ready-to-merge')) return 'ready';
    return 'default';
  };

  const buildBadges = (pr, isDraft) => {
    const badges = [];
    
    if (pr.status_tags?.includes('blocked on you')) {
      badges.push('<span class="badge badge-blocked"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM4 8a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 8z"/></svg>BLOCKED ON YOU</span>');
    }
    
    if (isDraft) {
      badges.push('<span class="badge badge-draft">DRAFT</span>');
    }
    
    if (pr.status_tags?.includes('ready-to-merge')) {
      badges.push('<span class="badge badge-ready">READY</span>');
    }
    
    if (pr.status_tags?.includes('stale')) {
      badges.push('<span class="badge badge-stale">STALE</span>');
    }
    
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
    
    // Update URL
    const url = new URL(window.location);
    if (selectedOrg) {
      url.searchParams.set('org', selectedOrg);
    } else {
      url.searchParams.delete('org');
    }
    window.history.pushState({}, '', url);
    
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
      ...state.pullRequests.outgoing,
      ...state.pullRequests.drafts
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
              commit_title: `Merge pull request #${pr.number} from ${pr.head.ref}`,
              commit_message: pr.title
            })
          });
          
          if (response.ok) {
            showToast('PR merged successfully', 'success');
            // Remove PR from state
            ['incoming', 'outgoing', 'drafts'].forEach(section => {
              const index = state.pullRequests[section].findIndex(p => p.id.toString() === prId);
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            const error = await response.json();
            showToast(error.message || 'Failed to merge PR', 'error');
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
            showToast('Failed to unassign', 'error');
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
            ['incoming', 'outgoing', 'drafts'].forEach(section => {
              const index = state.pullRequests[section].findIndex(p => p.id.toString() === prId);
              if (index !== -1) {
                state.pullRequests[section].splice(index, 1);
              }
            });
            // Update the display
            updatePRSections();
          } else {
            const errorMsg = response.status === 403 ? 
              'Failed to close PR - Permission denied' : 
              'Failed to close PR';
            showToast(errorMsg, 'error');
          }
          break;
      }
    } catch (error) {
      console.error('Error performing PR action:', error);
      showToast('An error occurred', 'error');
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
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.OAUTH_REDIRECT_URI)}&scope=repo%20read:org`;
    window.location.href = authUrl;
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
        storeToken(token, true); // Store in cookie
        closePATModal();
        window.location.reload();
      } else {
        showToast('Invalid token. Please check and try again.', 'error');
      }
    } catch (error) {
      showToast('Failed to validate token. Please try again.', 'error');
    }
  };

  const handleOAuthCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      // In a real implementation, you'd exchange this code for a token
      // via your backend server. For now, we'll show an error message.
      showToast('OAuth authentication requires a backend server. Please use Personal Access Token instead.', 'warning');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      showLoginPrompt();
    }
  };

  const initiateLogin = () => {
    // Legacy function - redirect to PAT login
    initiatePATLogin();
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
    state.pullRequests = DEMO_DATA.pullRequests;
    
    // Enhance demo PRs
    const allPRs = [
      ...state.pullRequests.incoming,
      ...state.pullRequests.outgoing,
      ...state.pullRequests.drafts
    ];
    
    allPRs.forEach(pr => {
      pr.age_days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);
      pr.status_tags = getStatusTags(pr);
      pr.last_activity = pr.last_activity || generateMockActivity(pr);
    });
    
    updateUserDisplay();
    updatePRSections();
    updateOrgFilter();
    showMainContent();
  };


  // Initialize
  const init = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const demo = urlParams.get('demo');
    
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
    
    // Check for auth
    if (!state.accessToken) {
      showLoginPrompt();
      return;
    }
    
    // Initialize app
    try {
      await loadCurrentUser();
      updateUserDisplay();
      await loadPullRequests();
      updateOrgFilter();
      updatePRSections();
      showMainContent();
    } catch (error) {
      console.error('Error initializing app:', error);
      showToast('Failed to load data', 'error');
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