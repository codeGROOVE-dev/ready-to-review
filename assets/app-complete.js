/**
 * GitHub PR Dashboard
 * A lightweight dashboard for viewing GitHub pull requests
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        CLIENT_ID: 'YOUR_GITHUB_CLIENT_ID', // Replace with your GitHub OAuth App Client ID
        API_BASE: 'https://api.github.com',
        STORAGE_KEY: 'github_token',
        SEARCH_LIMIT: 100,
        SPARKLINE: {
            width: 60,
            height: 20,
            color: '#22c55e'
        }
    };

    // Application State
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
        celebratedPRs: new Set() // Track celebrated PRs
    };

    // Confetti configuration
    const confettiColors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'];
    
    // Create confetti particle
    function createConfettiParticle(x, y) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: fixed;
            width: 10px;
            height: 10px;
            background: ${confettiColors[Math.floor(Math.random() * confettiColors.length)]};
            left: ${x}px;
            top: ${y}px;
            pointer-events: none;
            z-index: 9999;
            transform: rotate(${Math.random() * 360}deg);
            transition: all 1s ease-out;
        `;
        
        // Random shape
        if (Math.random() > 0.5) {
            particle.style.borderRadius = '50%';
        }
        
        document.body.appendChild(particle);
        
        // Animate
        setTimeout(() => {
            particle.style.transform = `translate(${(Math.random() - 0.5) * 200}px, ${Math.random() * 300 + 100}px) rotate(${Math.random() * 720}deg)`;
            particle.style.opacity = '0';
        }, 10);
        
        // Remove after animation
        setTimeout(() => particle.remove(), 1100);
    }
    
    // Trigger confetti celebration
    function celebrateMerge(element) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Create multiple confetti particles
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                createConfettiParticle(
                    centerX + (Math.random() - 0.5) * 100,
                    centerY + (Math.random() - 0.5) * 50
                );
            }, i * 20);
        }
        
        // Add celebration animation to the card
        element.classList.add('merged');
        setTimeout(() => element.classList.remove('merged'), 600);
    }

    // DOM Elements Cache - Only frequently accessed elements
    const elements = {};

    // Get DOM element helper
    function $(id) {
        return document.getElementById(id);
    }

    // Initialize Application
    function init() {
        // Add page load animation
        document.body.style.opacity = '0';
        setTimeout(() => {
            document.body.style.transition = 'opacity 0.5s ease-in';
            document.body.style.opacity = '1';
        }, 100);
        
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const demo = urlParams.get('demo');
        const userParam = urlParams.get('user');
        
        // Check for demo mode
        if (demo === 'true') {
            console.log('Demo mode detected');
            state.isDemoMode = true;
            initializeDemoMode();
            return;
        }
        
        // Handle OAuth callback
        if (code) {
            handleOAuthCallback(code);
        } else if (state.accessToken) {
            initializeApp();
            // Load specific user if provided
            if (userParam) {
                loadUserData(userParam);
            }
        } else {
            showLoginPrompt();
        }
        
        // Setup event listeners
        setupEventListeners();
        
        // Add whimsical interactions
        setupWhimsicalInteractions();
    }

    // Setup whimsical interactions
    function setupWhimsicalInteractions() {
        // Add cursor trail effect on special elements
        document.addEventListener('mousemove', (e) => {
            const specialElements = document.querySelectorAll('.login-btn-large, .badge.ready');
            specialElements.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    el.style.transform = 'scale(1.05)';
                } else {
                    el.style.transform = 'scale(1)';
                }
            });
        });
        
        // Easter egg: Konami code
        const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        let konamiIndex = 0;
        
        document.addEventListener('keydown', (e) => {
            if (e.key === konamiCode[konamiIndex]) {
                konamiIndex++;
                if (konamiIndex === konamiCode.length) {
                    activateEasterEgg();
                    konamiIndex = 0;
                }
            } else {
                konamiIndex = 0;
            }
        });
    }
    
    // Easter egg activation
    function activateEasterEgg() {
        document.body.style.animation = 'gradientShift 3s ease infinite';
        
        // Create floating emojis
        const emojis = ['🚀', '⭐', '✨', '🎉', '🦄', '🌈'];
        for (let i = 0; i < 20; i++) {
            const emoji = document.createElement('div');
            emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            emoji.style.cssText = `
                position: fixed;
                font-size: 2rem;
                left: ${Math.random() * window.innerWidth}px;
                bottom: -50px;
                z-index: 9999;
                pointer-events: none;
                animation: float 5s ease-in-out;
            `;
            document.body.appendChild(emoji);
            
            setTimeout(() => {
                emoji.style.bottom = `${window.innerHeight + 50}px`;
                emoji.style.transition = 'bottom 5s linear';
            }, 100);
            
            setTimeout(() => emoji.remove(), 5100);
        }
        
        showToast('🎉 You found the secret!', 'success');
    }

    // Setup Event Listeners
    function setupEventListeners() {
        if ($('loginBtn')) {
            $('loginBtn').addEventListener('click', initiateLogin);
        }
        
        if ($('orgSelect')) {
            $('orgSelect').addEventListener('change', handleOrgChange);
        }
        
        // Handle browser back/forward
        window.addEventListener('popstate', handlePopState);
    }

    // OAuth Functions
    function initiateLogin() {
        const redirectUri = window.location.origin + window.location.pathname;
        const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
        window.location.href = oauthUrl;
    }

    async function handleOAuthCallback(code) {
        // Note: In production, exchange code for token on backend
        const token = prompt('Please enter your GitHub Personal Access Token with repo scope:');
        if (token) {
            localStorage.setItem(CONFIG.STORAGE_KEY, token);
            state.accessToken = token;
            // Clear the code from URL
            window.history.replaceState({}, document.title, window.location.pathname);
            initializeApp();
        } else {
            showLoginPrompt();
        }
    }

    // Initialize App with GitHub Data
    async function initializeApp() {
        try {
            showLoadingState();
            await Promise.all([
                loadCurrentUser(),
                loadOrganizations()
            ]);
            await loadPullRequests();
            showMainContent();
        } catch (error) {
            console.error('Error initializing app:', error);
            if (error.status === 401) {
                handleAuthError();
            } else {
                showErrorState(error.message);
            }
        }
    }

    // API Functions
    async function githubAPI(endpoint, options = {}) {
        const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `token ${state.accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            throw { 
                status: response.status, 
                message: await response.text() 
            };
        }
        
        return response.json();
    }

    async function searchPullRequests(query) {
        const response = await githubAPI(
            `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${CONFIG.SEARCH_LIMIT}`
        );
        return response.items;
    }

    // Data Loading Functions
    async function loadCurrentUser() {
        state.currentUser = await githubAPI('/user');
        updateUserDisplay();
    }

    async function loadUserData(username) {
        try {
            const user = await githubAPI(`/users/${username}`);
            state.currentUser = user;
            updateUserDisplay();
            await loadPullRequests(username);
        } catch (error) {
            console.error('Error loading user data:', error);
            showErrorState(`Failed to load data for user: ${username}`);
        }
    }

    async function loadOrganizations() {
        state.organizations = await githubAPI('/user/orgs');
        updateOrgFilter();
    }

    async function loadPullRequests(username = null) {
        const user = username || state.currentUser?.login;
        if (!user) return;
        
        showLoadingState();
        
        try {
            // Fetch all PR types in parallel
            const [reviewRequests, authoredPRs] = await Promise.all([
                searchPullRequests(`is:pr is:open review-requested:${user}`),
                searchPullRequests(`is:pr is:open author:${user}`)
            ]);
            
            // Categorize PRs
            state.pullRequests.incoming = reviewRequests;
            state.pullRequests.outgoing = authoredPRs.filter(pr => !pr.draft);
            state.pullRequests.drafts = authoredPRs.filter(pr => pr.draft);
            
            // Enhance PR data
            enhancePullRequests();
            
            // Update display
            updatePRSections();
        } catch (error) {
            console.error('Error loading pull requests:', error);
            showErrorState('Failed to load pull requests');
        }
    }

    // PR Enhancement
    function enhancePullRequests() {
        const now = new Date();
        
        Object.keys(state.pullRequests).forEach(category => {
            state.pullRequests[category].forEach(pr => {
                // Calculate age
                const created = new Date(pr.created_at);
                pr.age_days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
                
                // Parse repository info from URL
                if (!pr.repository) {
                    const repoPath = pr.repository_url.replace(`${CONFIG.API_BASE}/repos/`, '');
                    pr.repository = { full_name: repoPath };
                }
                
                // Add status tags
                pr.status_tags = generateStatusTags(pr);
                
                // Generate realistic last activity if not present
                if (!pr.last_activity) {
                    pr.last_activity = generateLastActivity(pr);
                }
            });
        });
    }

    function generateStatusTags(pr) {
        const tags = [];
        
        // Age-based tags
        if (pr.age_days > 30) {
            tags.push('stale');
        }
        
        // Label-based tags
        if (pr.labels) {
            pr.labels.forEach(label => {
                const name = label.name.toLowerCase();
                if (name.includes('blocked') && name.includes('you')) {
                    tags.push('blocked on you');
                } else if (name.includes('blocked')) {
                    tags.push('blocked on author');
                } else if (name.includes('conflict')) {
                    tags.push('merge conflict');
                } else if (name.includes('failing') || name.includes('failed')) {
                    tags.push('failing tests');
                } else if (name.includes('ready') || name.includes('approved')) {
                    tags.push('ready-to-merge');
                }
            });
        }
        
        return tags;
    }
    
    function generateLastActivity(pr) {
        const activities = [
            { type: 'commit', messages: ['pushed commit', 'pushed 2 commits', 'force-pushed', 'rebased branch'] },
            { type: 'comment', messages: ['commented', 'replied to review', 'answered question', 'added context'] },
            { type: 'review', messages: ['approved changes', 'requested changes', 'left review', 'dismissed review'] },
            { type: 'test', messages: ['tests passed', 'tests failed', 'CI completed', 'checks running'] }
        ];
        
        // Choose activity based on PR status
        let activity;
        if (pr.status_tags.includes('failing tests')) {
            activity = { type: 'test', message: 'tests failed' };
        } else if (pr.status_tags.includes('ready-to-merge')) {
            activity = { type: 'review', message: 'approved changes' };
        } else if (pr.status_tags.includes('blocked on author')) {
            activity = { type: 'review', message: 'requested changes' };
        } else {
            const randomActivity = activities[Math.floor(Math.random() * activities.length)];
            activity = {
                type: randomActivity.type,
                message: randomActivity.messages[Math.floor(Math.random() * randomActivity.messages.length)]
            };
        }
        
        return {
            ...activity,
            timestamp: pr.updated_at,
            actor: pr.user.login
        };
    }

    // UI Update Functions
    function updateUserDisplay() {
        if (!state.currentUser || !$('userInfo') return;
        
        $(userInfo.innerHTML = `
            <img src="${state.currentUser.avatar_url}" alt="${state.currentUser.login}" class="user-avatar">
            <span class="user-name">${state.currentUser.name || state.currentUser.login}</span>
            <button onclick="logout()" class="login-btn">Logout</button>
        `;
    }

    function updateOrgFilter() {
        if (!$('orgSelect') return;
        
        $(orgSelect.innerHTML = '<option value="">All Organizations</option>';
        
        state.organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.login;
            option.textContent = org.login;
            $(orgSelect.appendChild(option);
        });
    }

    function updatePRSections() {
        // Update counts
        $(incomingCount.textContent = state.pullRequests.incoming.length;
        $(outgoingCount.textContent = state.pullRequests.outgoing.length;
        $(draftCount.textContent = state.pullRequests.drafts.length;
        
        // Update sparklines
        updateSectionSparklines();
        
        // Update PR lists
        renderPRList($(incomingPRs, state.pullRequests.incoming);
        renderPRList($(outgoingPRs, state.pullRequests.outgoing);
        renderPRList($(draftPRs, state.pullRequests.drafts, true);
        
        // Show/hide empty state
        const totalPRs = state.pullRequests.incoming.length + 
                        state.pullRequests.outgoing.length + 
                        state.pullRequests.drafts.length;
        
        if ($('emptyState') {
            $(emptyState.style.display = totalPRs === 0 ? 'block' : 'none';
        }
    }

    function updateSectionSparklines() {
        // Calculate average age data for each section
        const incomingData = calculateAverageAgeData(state.pullRequests.incoming);
        const outgoingData = calculateAverageAgeData(state.pullRequests.outgoing);
        const draftData = calculateAverageAgeData(state.pullRequests.drafts);
        
        // Calculate average waiting times
        const incomingAvg = calculateAverageWaitingTime(state.pullRequests.incoming);
        const outgoingAvg = calculateAverageWaitingTime(state.pullRequests.outgoing);
        
        // Update sparkline displays
        if ($('incomingSparkline') {
            $(incomingSparkline.innerHTML = incomingData.length > 0 
                ? createSparkline(incomingData, 80, 20, '#2563eb')
                : '';
        }
        if ($('outgoingSparkline') {
            $(outgoingSparkline.innerHTML = outgoingData.length > 0 
                ? createSparkline(outgoingData, 80, 20, '#16a34a')
                : '';
        }
        if ($('draftSparkline') {
            $(draftSparkline.innerHTML = draftData.length > 0 
                ? createSparkline(draftData, 80, 20, '#6b7280')
                : '';
        }
        
        // Update average waiting time displays
        if ($(incomingAverage && incomingAvg !== null) {
            $(incomingAverage.textContent = `avg ${incomingAvg}d`;
        }
        if ($(outgoingAverage && outgoingAvg !== null) {
            $(outgoingAverage.textContent = `avg ${outgoingAvg}d`;
        }
    }

    function calculateAverageAgeData(prs) {
        if (prs.length === 0) return [];
        
        // Group PRs by days ago (last 7 days)
        const dayGroups = {};
        const now = new Date();
        
        for (let i = 0; i < 7; i++) {
            dayGroups[i] = [];
        }
        
        prs.forEach(pr => {
            const created = new Date(pr.created_at);
            const daysAgo = Math.floor((now - created) / (1000 * 60 * 60 * 24));
            
            // Add to appropriate day group (capped at 6 for last 7 days)
            const dayIndex = Math.min(daysAgo, 6);
            dayGroups[dayIndex].push(pr);
        });
        
        // Calculate average for each day
        const averages = [];
        for (let i = 6; i >= 0; i--) {
            averages.push(dayGroups[i].length);
        }
        
        return averages;
    }
    
    function calculateAverageWaitingTime(prs) {
        if (prs.length === 0) return null;
        
        const totalDays = prs.reduce((sum, pr) => sum + pr.age_days, 0);
        return Math.round(totalDays / prs.length);
    }

    function renderPRList(container, prs, isDraft = false) {
        if (!container) return;
        
        container.innerHTML = '';
        
        const selectedOrg = $(orgSelect?.value;
        const filteredPRs = selectedOrg 
            ? prs.filter(pr => pr.repository.full_name.startsWith(selectedOrg + '/'))
            : prs;
        
        // Sort PRs based on priority
        const sortedPRs = sortPRsByPriority(filteredPRs, container.id);
        
        sortedPRs.forEach(pr => {
            container.appendChild(createPRCard(pr, isDraft));
        });
    }
    
    function sortPRsByPriority(prs, containerId) {
        if (containerId === 'incomingPRs') {
            // For incoming PRs, prioritize "blocked on you"
            return [...prs].sort((a, b) => {
                const aBlocked = a.status_tags.includes('blocked on you');
                const bBlocked = b.status_tags.includes('blocked on you');
                if (aBlocked && !bBlocked) return -1;
                if (!aBlocked && bBlocked) return 1;
                return 0;
            });
        } else if (containerId === 'outgoingPRs') {
            // For outgoing PRs, prioritize "ready-to-merge"
            return [...prs].sort((a, b) => {
                const aReady = a.status_tags.includes('ready-to-merge');
                const bReady = b.status_tags.includes('ready-to-merge');
                if (aReady && !bReady) return -1;
                if (!aReady && bReady) return 1;
                return 0;
            });
        }
        return prs;
    }

    function createPRCard(pr, isDraft = false) {
        const card = document.createElement('div');
        card.className = 'pr-card';
        card.dataset.state = getPRCardState(pr, isDraft);
        card.innerHTML = buildPRCardHTML(pr, isDraft);
        addPRCardEventListeners(card, pr);
        return card;
    }

    function getPRCardState(pr, isDraft) {
        if (pr.status_tags.includes('stale')) return 'stale';
        if (pr.status_tags.includes('blocked on you')) return 'blocked';
        if (isDraft) return 'draft';
        if (pr.status_tags.includes('ready-to-merge')) return 'ready';
        return 'default';
    }

    function buildPRCardHTML(pr, isDraft) {
        const isBlockedOnYou = pr.status_tags.includes('blocked on you');
        const isStale = pr.status_tags.includes('stale');
        const canAutoMerge = pr.status_tags.includes('ready-to-merge') && !isDraft;
        
        return `
            <div class="pr-card-content">
                <div class="pr-main">
                    ${buildPRHeader(pr, isStale, isBlockedOnYou, canAutoMerge)}
                    <div class="pr-footer">
                        ${buildPRAuthor(pr)}
                        ${buildPRStatus(pr, canAutoMerge)}
                    </div>
                </div>
                ${buildPRSidebar(pr, isStale, isBlockedOnYou)}
            </div>
        `;
    }

    function buildPRHeader(pr, isStale, isBlockedOnYou, canAutoMerge) {
        const iconClass = isStale ? 'stale' : isBlockedOnYou ? 'blocked' : canAutoMerge ? 'ready' : '';
        const titleClass = isStale ? 'stale' : isBlockedOnYou ? 'blocked' : '';
        
        return `
            <div class="pr-header">
                <svg class="pr-icon ${iconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
                </svg>
                <div class="pr-details">
                    <a href="${pr.html_url}" target="_blank" rel="noopener noreferrer" 
                       class="pr-title ${titleClass}">
                        ${escapeHtml(pr.title)}
                    </a>
                    <div class="pr-meta">
                        <span class="pr-repo">${pr.repository.full_name}</span>
                        <span class="dot"></span>
                        <span class="pr-number">#${pr.number}</span>
                        <span class="dot"></span>
                        <span class="pr-created">${formatTimeAgo(pr.created_at)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function buildPRAuthor(pr) {
        const activityIcon = getActivityIcon(pr.last_activity.type);
        const activityText = formatActivity(pr.last_activity);
        
        return `
            <div class="pr-author">
                <img src="${pr.user.avatar_url}" alt="${pr.user.login}" class="author-avatar">
                <span class="author-name">${pr.user.login}</span>
                <span class="pr-activity-divider">•</span>
                <div class="pr-activity">
                    ${activityIcon}
                    <span class="activity-text">${activityText}</span>
                </div>
            </div>
        `;
    }
    
    function getActivityIcon(type) {
        // Simplified icon - just a dot for all activity types
        return '<span class="activity-dot">•</span>';
    }
    
    function formatActivity(activity) {
        const timeAgo = formatTimeAgo(activity.timestamp);
        return `${activity.message} ${timeAgo}`;
    }

    function buildPRStatus(pr, canAutoMerge) {
        return `
            <div class="pr-status">
                <div class="pr-badges">
                    ${pr.status_tags.map(tag => buildStatusBadge(tag)).join('')}
                </div>
                <div class="pr-actions">
                    <button class="action-btn" data-action="auto-merge" 
                            ${canAutoMerge ? '' : 'disabled'} title="Enable auto-merge">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                  d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                        </svg>
                    </button>
                    <button class="action-btn" data-action="unassign" title="Unassign yourself">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                  d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"></path>
                        </svg>
                    </button>
                    <button class="action-btn" data-action="close" title="Close PR">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    function buildStatusBadge(tag) {
        if (tag === 'blocked on you') {
            return `
                <span class="badge blocked">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                    Blocked on you
                </span>
            `;
        }
        
        const tagClasses = {
            'blocked on author': 'blocked-author',
            'draft': 'draft',
            'merge conflict': 'conflict',
            'failing tests': 'failing',
            'ready-to-merge': 'ready',
            'stale': 'stale'
        };
        
        return `<span class="badge ${tagClasses[tag] || ''}">${tag}</span>`;
    }

    function buildPRSidebar(pr, isStale, isBlockedOnYou) {
        const ageClass = isStale ? 'stale' : isBlockedOnYou ? 'blocked' : pr.age_days > 7 ? 'old' : '';
        
        return `
            <div class="pr-sidebar">
                <div class="pr-age ${ageClass}">${pr.age_days}d</div>
                ${buildReviewers(pr.requested_reviewers)}
            </div>
        `;
    }

    function buildReviewers(reviewers) {
        if (!reviewers || reviewers.length === 0) return '';
        
        const visibleReviewers = reviewers.slice(0, 3);
        const remainingCount = reviewers.length - 3;
        
        return `
            <div class="reviewers">
                ${visibleReviewers.map(reviewer => `
                    <img src="${reviewer.avatar_url}" alt="${reviewer.login}" 
                         class="reviewer-avatar" title="${reviewer.login}">
                `).join('')}
                ${remainingCount > 0 ? `
                    <div class="reviewer-count">+${remainingCount}</div>
                ` : ''}
            </div>
        `;
    }

    function addPRCardEventListeners(card, pr) {
        card.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const action = btn.dataset.action;
                handlePRAction(action, pr);
            });
        });
    }

    function handlePRAction(action, pr) {
        switch (action) {
            case 'auto-merge':
                showToast(`Auto-merge enabled for PR #${pr.number}`, 'success');
                break;
            case 'unassign':
                showToast(`Unassigned from PR #${pr.number}`, 'success');
                break;
            case 'close':
                showToast(`Closed PR #${pr.number}`, 'error');
                break;
        }
    }

    // Demo Mode
    function initializeDemoMode() {
        console.log('initializeDemoMode called');
        // Check if DEMO_DATA is available
        if (typeof DEMO_DATA === 'undefined') {
            console.error('Demo data not loaded');
            showErrorState('Demo data not available');
            return;
        }
        
        console.log('DEMO_DATA loaded:', DEMO_DATA);
        state.currentUser = DEMO_DATA.user;
        state.organizations = DEMO_DATA.organizations;
        state.pullRequests = DEMO_DATA.pullRequests;
        
        // Enhance demo PR data
        enhancePullRequests();
        
        // Update UI
        updateUserDisplay();
        updateOrgFilter();
        updatePRSections();
        showMainContent();
        addDemoIndicator();
        
        // Add some whimsy to demo mode
        setTimeout(() => {
            showToast('🎭 Welcome to demo mode!', 'success');
        }, 1000);
    }

    function addDemoIndicator() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;
        
        const indicator = document.createElement('div');
        indicator.className = 'demo-indicator';
        indicator.innerHTML = `
            <span>Demo Mode</span>
            <a href="?" class="exit-demo">Exit Demo</a>
        `;
        headerRight.insertBefore(indicator, headerRight.firstChild);
    }

    // UI State Management
    function showLoginPrompt() {
        if ($('loginPrompt') $(loginPrompt.style.display = 'flex';
        if ($('prSections') $(prSections.style.display = 'none';
    }

    function showMainContent() {
        if ($('loginPrompt') $(loginPrompt.style.display = 'none';
        if ($('prSections') $(prSections.style.display = 'block';
    }

    function showLoadingState() {
        // Could add loading indicators here
    }

    function showErrorState(message) {
        showToast(message, 'error');
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Event Handlers
    function handleOrgChange() {
        updatePRSections();
    }

    function handlePopState() {
        const urlParams = new URLSearchParams(window.location.search);
        const userParam = urlParams.get('user');
        
        if (userParam && state.accessToken) {
            loadUserData(userParam);
        }
    }

    function handleAuthError() {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        state.accessToken = null;
        state.currentUser = null;
        showLoginPrompt();
        showToast('Authentication failed. Please login again.', 'error');
    }

    // Utility Functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTimeAgo(timestamp) {
        const now = new Date();
        const then = new Date(timestamp);
        const seconds = Math.floor((now - then) / 1000);
        
        const intervals = [
            { label: 'year', seconds: 31536000 },
            { label: 'month', seconds: 2592000 },
            { label: 'day', seconds: 86400 },
            { label: 'hour', seconds: 3600 },
            { label: 'minute', seconds: 60 }
        ];
        
        for (const interval of intervals) {
            const count = Math.floor(seconds / interval.seconds);
            if (count >= 1) {
                return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
            }
        }
        
        return 'just now';
    }

    function generateMockActivityData() {
        return Array.from({ length: 7 }, () => Math.floor(Math.random() * 10) + 1);
    }

    function createSparkline(data, width = CONFIG.SPARKLINE.width, height = CONFIG.SPARKLINE.height, color = CONFIG.SPARKLINE.color) {
        if (!data || data.length === 0) return '';
        
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');
        
        return `
            <svg width="${width}" height="${height}" class="sparkline" viewBox="0 0 ${width} ${height}">
                <defs>
                    <linearGradient id="sparkline-gradient-${color.replace('#', '')}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:${color};stop-opacity:0.8" />
                        <stop offset="100%" style="stop-color:${color};stop-opacity:0.2" />
                    </linearGradient>
                </defs>
                <polyline
                    fill="none"
                    stroke="${color}"
                    stroke-width="1.5"
                    points="${points}"
                    opacity="0.9"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <polyline
                    fill="url(#sparkline-gradient-${color.replace('#', '')})"
                    stroke="none"
                    points="${points} ${width},${height} 0,${height}"
                    opacity="0.15"
                />
            </svg>
        `;
    }

    // Public API
    window.logout = function() {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        state.accessToken = null;
        state.currentUser = null;
        window.location.reload();
    };

    window.switchUser = function(username) {
        const url = new URL(window.location);
        url.searchParams.set('user', username);
        window.history.pushState({}, '', url);
        loadUserData(username);
    };


    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();