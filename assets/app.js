// Ready To Review - Modern ES6+ Application

const App = (() => {
  'use strict';

  // Configuration
  const CONFIG = {
    CLIENT_ID: 'YOUR_GITHUB_CLIENT_ID',
    API_BASE: 'https://api.github.com',
    STORAGE_KEY: 'github_token',
    SEARCH_LIMIT: 100,
  };

  // State Management
  const state = {
    currentUser: null,
    accessToken: localStorage.getItem(CONFIG.STORAGE_KEY),
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
  const initiateLogin = () => {
    const token = prompt('Please enter your GitHub Personal Access Token with repo scope:');
    if (token) {
      localStorage.setItem(CONFIG.STORAGE_KEY, token);
      state.accessToken = token;
      window.location.reload();
    }
  };

  const handleAuthError = () => {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    state.accessToken = null;
    showLoginPrompt();
    showToast('Authentication failed. Please login again.', 'error');
  };

  const logout = () => {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
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
    
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
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
    initiateLogin: () => window.initiateLogin = initiateLogin
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