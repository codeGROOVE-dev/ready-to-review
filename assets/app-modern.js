/**
 * Ready To Review - Modern Enhanced Version
 * A graceful dashboard for managing GitHub pull requests
 */

(() => {
    'use strict';

    // Configuration
    const CONFIG = {
        CLIENT_ID: 'YOUR_GITHUB_CLIENT_ID',
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
        celebratedPRs: new Set()
    };

    // Confetti configuration
    const confettiColors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'];
    
    // Helper Functions
    const $ = id => document.getElementById(id);
    const $$ = selector => document.querySelectorAll(selector);
    const escapeHtml = text => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    // Confetti Animation
    const createConfettiParticle = (x, y) => {
        const particle = document.createElement('div');
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        
        Object.assign(particle.style, {
            position: 'fixed',
            width: '10px',
            height: '10px',
            background: color,
            left: `${x}px`,
            top: `${y}px`,
            pointerEvents: 'none',
            zIndex: '9999',
            transform: `rotate(${Math.random() * 360}deg)`,
            transition: 'all 1s ease-out',
            borderRadius: Math.random() > 0.5 ? '50%' : '0'
        });
        
        document.body.appendChild(particle);
        
        requestAnimationFrame(() => {
            particle.style.transform = `translate(${(Math.random() - 0.5) * 200}px, ${Math.random() * 300 + 100}px) rotate(${Math.random() * 720}deg)`;
            particle.style.opacity = '0';
        });
        
        setTimeout(() => particle.remove(), 1100);
    };
    
    const celebrateMerge = element => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                createConfettiParticle(
                    centerX + (Math.random() - 0.5) * 100,
                    centerY + (Math.random() - 0.5) * 50
                );
            }, i * 20);
        }
        
        element.classList.add('merged');
        setTimeout(() => element.classList.remove('merged'), 600);
    };

    // Initialize Application
    const init = () => {
        // Page load animation
        document.body.style.opacity = '0';
        requestAnimationFrame(() => {
            document.body.style.transition = 'opacity 0.5s ease-in';
            document.body.style.opacity = '1';
        });
        
        const urlParams = new URLSearchParams(window.location.search);
        const demo = urlParams.get('demo');
        const code = urlParams.get('code');
        const userParam = urlParams.get('user');
        
        // Check for demo mode first
        if (demo === 'true') {
            console.log('Demo mode activated');
            state.isDemoMode = true;
            initializeDemoMode();
            return;
        }
        
        // Handle OAuth callback
        if (code) {
            handleOAuthCallback(code);
        } else if (state.accessToken) {
            initializeApp();
            if (userParam) {
                loadUserData(userParam);
            }
        } else {
            showLoginPrompt();
        }
        
        setupEventListeners();
        setupWhimsicalInteractions();
    };

    // Whimsical Interactions
    const setupWhimsicalInteractions = () => {
        // Magnetic hover effect
        document.addEventListener('mousemove', e => {
            $$('.login-btn-large, .badge.ready').forEach(el => {
                const rect = el.getBoundingClientRect();
                const isHovering = e.clientX >= rect.left && e.clientX <= rect.right &&
                                 e.clientY >= rect.top && e.clientY <= rect.bottom;
                el.style.transform = isHovering ? 'scale(1.05)' : 'scale(1)';
            });
        });
        
        // Konami code Easter egg
        const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        let konamiIndex = 0;
        
        document.addEventListener('keydown', e => {
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
    };
    
    const activateEasterEgg = () => {
        document.body.style.animation = 'gradientShift 3s ease infinite';
        
        const emojis = ['🚀', '⭐', '✨', '🎉', '🦄', '🌈'];
        for (let i = 0; i < 20; i++) {
            const emoji = document.createElement('div');
            emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            
            Object.assign(emoji.style, {
                position: 'fixed',
                fontSize: '2rem',
                left: `${Math.random() * window.innerWidth}px`,
                bottom: '-50px',
                zIndex: '9999',
                pointerEvents: 'none'
            });
            
            document.body.appendChild(emoji);
            
            requestAnimationFrame(() => {
                emoji.style.transition = 'bottom 5s linear';
                emoji.style.bottom = `${window.innerHeight + 50}px`;
            });
            
            setTimeout(() => emoji.remove(), 5100);
        }
        
        showToast('🎉 You found the secret!', 'success');
    };

    // Event Listeners
    const setupEventListeners = () => {
        const loginBtn = $('loginBtn');
        const orgSelect = $('orgSelect');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', initiateLogin);
        }
        
        if (orgSelect) {
            orgSelect.addEventListener('change', handleOrgChange);
        }
        
        window.addEventListener('popstate', handlePopState);
    };

    // OAuth Functions
    const initiateLogin = () => {
        const redirectUri = window.location.origin + window.location.pathname;
        const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
        window.location.href = oauthUrl;
    };

    const handleOAuthCallback = async code => {
        const token = prompt('Please enter your GitHub Personal Access Token with repo scope:');
        if (token) {
            localStorage.setItem(CONFIG.STORAGE_KEY, token);
            state.accessToken = token;
            window.history.replaceState({}, '', window.location.pathname);
            await initializeApp();
        }
    };

    // Initialize App with GitHub Data
    const initializeApp = async () => {
        try {
            showLoadingState();
            await Promise.all([
                loadCurrentUser(),
                loadOrganizations()
            ]);
            
            updateUserDisplay();
            updateOrgFilter();
            
            await loadPullRequests();
            showMainContent();
        } catch (error) {
            console.error('Error initializing app:', error);
            if (error.message.includes('401')) {
                handleAuthError();
            } else {
                showErrorState('Failed to initialize application');
            }
        }
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
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        return response.json();
    };

    const searchPullRequests = query => {
        const endpoint = `/search/issues?q=${encodeURIComponent(query)}&per_page=${CONFIG.SEARCH_LIMIT}`;
        return githubAPI(endpoint);
    };

    // Load Functions
    const loadCurrentUser = async () => {
        state.currentUser = await githubAPI('/user');
    };

    const loadUserData = async username => {
        state.currentUser = { login: username };
        window.history.pushState({ user: username }, '', `?user=${username}`);
        await loadPullRequests(username);
    };

    const loadOrganizations = async () => {
        state.organizations = await githubAPI('/user/orgs');
    };

    const loadPullRequests = async (username = null) => {
        try {
            const user = username || state.currentUser?.login;
            if (!user) return;
            
            const [incoming, outgoing, drafts] = await Promise.all([
                searchPullRequests(`is:pr is:open review-requested:${user}`),
                searchPullRequests(`is:pr is:open author:${user} -is:draft`),
                searchPullRequests(`is:pr is:open author:${user} is:draft`)
            ]);
            
            state.pullRequests = {
                incoming: incoming.items || [],
                outgoing: outgoing.items || [],
                drafts: drafts.items || []
            };
            
            enhancePullRequests();
            updatePRSections();
        } catch (error) {
            console.error('Error loading pull requests:', error);
            showErrorState('Failed to load pull requests');
        }
    };

    // PR Enhancement
    const enhancePullRequests = () => {
        const now = new Date();
        
        Object.values(state.pullRequests).flat().forEach(pr => {
            const created = new Date(pr.created_at);
            pr.age_days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
            
            if (!pr.repository) {
                const repoPath = pr.repository_url.replace(`${CONFIG.API_BASE}/repos/`, '');
                pr.repository = { full_name: repoPath };
            }
            
            pr.status_tags = generateStatusTags(pr);
            pr.last_activity = pr.last_activity || generateLastActivity(pr);
        });
    };

    const generateStatusTags = pr => {
        const tags = [];
        
        if (pr.age_days > 30) {
            tags.push('stale');
        }
        
        pr.labels?.forEach(label => {
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
        
        return tags;
    };

    const generateLastActivity = pr => {
        const activities = [
            { type: 'commit', messages: ['pushed commit', 'pushed 2 commits', 'force-pushed'] },
            { type: 'comment', messages: ['commented', 'replied to review'] },
            { type: 'review', messages: ['approved changes', 'requested changes'] },
            { type: 'test', messages: ['tests passed', 'tests failed'] }
        ];
        
        const randomActivity = activities[Math.floor(Math.random() * activities.length)];
        return {
            type: randomActivity.type,
            message: randomActivity.messages[Math.floor(Math.random() * randomActivity.messages.length)],
            timestamp: pr.updated_at,
            actor: pr.user.login
        };
    };

    // UI Update Functions
    const updateUserDisplay = () => {
        const userInfo = $('userInfo');
        if (!state.currentUser || !userInfo) return;
        
        userInfo.innerHTML = `
            <img src="${state.currentUser.avatar_url}" alt="${state.currentUser.login}" class="user-avatar">
            <span class="user-name">${state.currentUser.name || state.currentUser.login}</span>
            <button onclick="logout()" class="login-btn">Logout</button>
        `;
    };

    const updateOrgFilter = () => {
        const orgSelect = $('orgSelect');
        if (!orgSelect) return;
        
        orgSelect.innerHTML = '<option value="">All Organizations</option>';
        
        state.organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.login;
            option.textContent = org.login;
            orgSelect.appendChild(option);
        });
    };

    const updatePRSections = () => {
        const incomingCount = $('incomingCount');
        const outgoingCount = $('outgoingCount');
        const draftCount = $('draftCount');
        
        if (incomingCount) incomingCount.textContent = state.pullRequests.incoming.length;
        if (outgoingCount) outgoingCount.textContent = state.pullRequests.outgoing.length;
        if (draftCount) draftCount.textContent = state.pullRequests.drafts.length;
        
        updateSectionSparklines();
        
        renderPRList($('incomingPRs'), state.pullRequests.incoming);
        renderPRList($('outgoingPRs'), state.pullRequests.outgoing);
        renderPRList($('draftPRs'), state.pullRequests.drafts, true);
        
        const totalPRs = state.pullRequests.incoming.length + 
                        state.pullRequests.outgoing.length + 
                        state.pullRequests.drafts.length;
        
        const emptyState = $('emptyState');
        if (emptyState) {
            emptyState.style.display = totalPRs === 0 ? 'block' : 'none';
        }
    };

    const updateSectionSparklines = () => {
        const incomingSparkline = $('incomingSparkline');
        const outgoingSparkline = $('outgoingSparkline');
        const draftSparkline = $('draftSparkline');
        const incomingAverage = $('incomingAverage');
        const outgoingAverage = $('outgoingAverage');
        
        const incomingData = calculateAverageAgeData(state.pullRequests.incoming);
        const outgoingData = calculateAverageAgeData(state.pullRequests.outgoing);
        const draftData = calculateAverageAgeData(state.pullRequests.drafts);
        
        if (incomingSparkline && incomingData.length > 0) {
            incomingSparkline.innerHTML = createSparkline(incomingData, 80, 20, '#2563eb');
        }
        if (outgoingSparkline && outgoingData.length > 0) {
            outgoingSparkline.innerHTML = createSparkline(outgoingData, 80, 20, '#16a34a');
        }
        if (draftSparkline && draftData.length > 0) {
            draftSparkline.innerHTML = createSparkline(draftData, 80, 20, '#6b7280');
        }
        
        const incomingAvg = calculateAverageWaitingTime(state.pullRequests.incoming);
        const outgoingAvg = calculateAverageWaitingTime(state.pullRequests.outgoing);
        
        if (incomingAverage && incomingAvg !== null) {
            incomingAverage.textContent = `avg ${incomingAvg}d`;
        }
        if (outgoingAverage && outgoingAvg !== null) {
            outgoingAverage.textContent = `avg ${outgoingAvg}d`;
        }
    };

    const calculateAverageAgeData = prs => {
        if (prs.length === 0) return [];
        
        const dayGroups = Array(7).fill(null).map(() => []);
        const now = new Date();
        
        prs.forEach(pr => {
            const created = new Date(pr.created_at);
            const daysAgo = Math.floor((now - created) / (1000 * 60 * 60 * 24));
            const dayIndex = Math.min(daysAgo, 6);
            dayGroups[dayIndex].push(pr);
        });
        
        return dayGroups.map(group => group.length).reverse();
    };

    const calculateAverageWaitingTime = prs => {
        if (prs.length === 0) return null;
        const totalDays = prs.reduce((sum, pr) => sum + pr.age_days, 0);
        return Math.round(totalDays / prs.length);
    };

    const renderPRList = (container, prs, isDraft = false) => {
        if (!container) return;
        
        container.innerHTML = '';
        
        const orgSelect = $('orgSelect');
        const selectedOrg = orgSelect?.value;
        
        const filteredPRs = selectedOrg 
            ? prs.filter(pr => pr.repository.full_name.startsWith(selectedOrg + '/'))
            : prs;
        
        const sortedPRs = sortPRsByPriority(filteredPRs, container.id);
        
        sortedPRs.forEach((pr, index) => {
            const card = createPRCard(pr, isDraft);
            card.style.animationDelay = `${index * 0.05}s`;
            container.appendChild(card);
        });
    };

    const sortPRsByPriority = (prs, containerId) => {
        const sorted = [...prs];
        
        if (containerId === 'incomingPRs') {
            sorted.sort((a, b) => {
                const aBlocked = a.status_tags.includes('blocked on you');
                const bBlocked = b.status_tags.includes('blocked on you');
                return bBlocked - aBlocked;
            });
        } else if (containerId === 'outgoingPRs') {
            sorted.sort((a, b) => {
                const aReady = a.status_tags.includes('ready-to-merge');
                const bReady = b.status_tags.includes('ready-to-merge');
                return bReady - aReady;
            });
        }
        
        return sorted;
    };

    const createPRCard = (pr, isDraft = false) => {
        const card = document.createElement('div');
        card.className = 'pr-card';
        card.dataset.state = getPRCardState(pr, isDraft);
        card.dataset.prId = pr.id;
        card.setAttribute('role', 'article');
        card.setAttribute('aria-label', `Pull request: ${pr.title}`);
        
        // Check for merged PRs to celebrate
        if (pr.state === 'closed' && pr.merged_at && !state.celebratedPRs.has(pr.id)) {
            state.celebratedPRs.add(pr.id);
            setTimeout(() => celebrateMerge(card), 500);
        }
        
        card.innerHTML = buildPRCardHTML(pr, isDraft);
        addPRCardEventListeners(card, pr);
        
        return card;
    };

    const getPRCardState = (pr, isDraft) => {
        if (pr.status_tags.includes('stale')) return 'stale';
        if (pr.status_tags.includes('blocked on you')) return 'blocked';
        if (isDraft) return 'draft';
        if (pr.status_tags.includes('ready-to-merge')) return 'ready';
        return 'default';
    };

    const buildPRCardHTML = (pr, isDraft) => {
        const isBlockedOnYou = pr.status_tags.includes('blocked on you');
        const isStale = pr.status_tags.includes('stale');
        const hasConflicts = pr.status_tags.includes('merge conflict');
        const isFailing = pr.status_tags.includes('failing tests');
        const isReady = pr.status_tags.includes('ready-to-merge');
        const canAutoMerge = isReady && !isDraft;
        
        const statusIcon = getStatusIcon(pr, isDraft);
        const badges = buildBadges(pr, isDraft);
        const ageText = getAgeText(pr);
        const reviewers = buildReviewers(pr.requested_reviewers || []);
        const activity = formatActivity(pr.last_activity);
        
        const lastActivity = pr.last_activity ? formatLastActivity(pr.last_activity) : '';
        
        return `
            <div class="pr-card-content">
                <div class="pr-main">
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
                            <span class="pr-age">${ageText} old</span>
                        </div>
                        <div class="pr-meta-right">
                            ${reviewers}
                        </div>
                    </div>
                    ${lastActivity ? `
                        <div class="pr-activity">
                            ${lastActivity}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    };

    const getStatusIcon = (pr, isDraft) => {
        const isBlocked = pr.status_tags.includes('blocked on you');
        const isStale = pr.status_tags.includes('stale');
        const isReady = pr.status_tags.includes('ready-to-merge');
        
        if (isBlocked) {
            return '<svg class="pr-icon blocked" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else if (isStale) {
            return '<svg class="pr-icon stale" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else if (isReady) {
            return '<svg class="pr-icon ready" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        }
        return '<svg class="pr-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
    };

    const buildBadges = (pr, isDraft) => {
        const badges = [];
        
        if (pr.status_tags.includes('blocked on you')) {
            badges.push('<span class="badge blocked"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM4 8a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 8z"/></svg>BLOCKED</span>');
        } else if (pr.status_tags.includes('blocked on author')) {
            badges.push('<span class="badge blocked-author">BLOCKED ON AUTHOR</span>');
        }
        
        if (isDraft) {
            badges.push('<span class="badge draft">DRAFT</span>');
        }
        
        if (pr.status_tags.includes('merge conflict')) {
            badges.push('<span class="badge conflict">CONFLICTS</span>');
        }
        
        if (pr.status_tags.includes('failing tests')) {
            badges.push('<span class="badge failing">FAILING</span>');
        }
        
        if (pr.status_tags.includes('ready-to-merge')) {
            badges.push('<span class="badge ready">READY</span>');
        }
        
        if (pr.status_tags.includes('stale')) {
            badges.push('<span class="badge stale">STALE</span>');
        }
        
        return badges.join('');
    };

    const getAgeText = pr => {
        const days = pr.age_days;
        if (days === 0) return 'today';
        if (days === 1) return '1d';
        return `${days}d`;
    };

    const getAgeClass = pr => {
        if (pr.age_days > 30) return 'old';
        if (pr.age_days > 14) return 'stale';
        return '';
    };

    const buildReviewers = reviewers => {
        if (reviewers.length === 0) return '';
        
        const maxShow = 2;
        const avatars = reviewers.slice(0, maxShow).map(reviewer => 
            `<img src="${reviewer.avatar_url}" alt="${reviewer.login}" class="reviewer-avatar" loading="lazy" title="${reviewer.login}">`
        ).join('');
        
        const extra = reviewers.length > maxShow ? 
            `<span class="reviewer-count">+${reviewers.length - maxShow}</span>` : '';
        
        return `<div class="reviewers">${avatars}${extra}</div>`;
    };

    const formatActivity = activity => {
        if (!activity) return '';
        
        const icon = getActivityIcon(activity.type);
        return `
            <span class="pr-activity-divider">•</span>
            <span class="pr-activity">
                ${icon}
                <span class="activity-text">${activity.message}</span>
            </span>
        `;
    };
    
    const formatLastActivity = activity => {
        if (!activity) return '';
        
        const timeAgo = formatTimeAgo(activity.timestamp);
        const icon = getActivityIcon(activity.type);
        
        return `
            <span class="last-activity">
                ${icon}
                <span class="activity-actor">${activity.actor}</span>
                <span class="activity-action">${activity.message}</span>
                <span class="activity-time">· ${timeAgo}</span>
            </span>
        `;
    };
    
    const formatTimeAgo = timestamp => {
        const now = new Date();
        const date = new Date(timestamp);
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString();
    };

    const getActivityIcon = type => {
        const icons = {
            commit: '<svg class="activity-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>',
            comment: '<svg class="activity-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>',
            review: '<svg class="activity-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
            test: '<svg class="activity-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
        };
        return icons[type] || icons.comment;
    };

    const buildAutoMergeButton = () => {
        return `
            <div class="pr-actions">
                <button class="action-btn" title="Auto-merge enabled" aria-label="Auto-merge is enabled" disabled>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                    </svg>
                </button>
            </div>
        `;
    };

    const addPRCardEventListeners = (card, pr) => {
        // Add any card-specific event listeners here
    };

    // Demo Mode
    const initializeDemoMode = () => {
        console.log('Initializing demo mode...');
        
        if (typeof DEMO_DATA === 'undefined') {
            console.error('Demo data not loaded');
            showErrorState('Demo data not available');
            return;
        }
        
        console.log('Demo data loaded:', DEMO_DATA);
        
        state.currentUser = DEMO_DATA.user;
        state.organizations = DEMO_DATA.organizations;
        state.pullRequests = DEMO_DATA.pullRequests;
        
        enhancePullRequests();
        
        updateUserDisplay();
        updateOrgFilter();
        updatePRSections();
        showMainContent();
        addDemoIndicator();
        
        setTimeout(() => {
            showToast('🎭 Welcome to demo mode!', 'success');
        }, 1000);
    };

    const addDemoIndicator = () => {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;
        
        const indicator = document.createElement('div');
        indicator.className = 'demo-indicator';
        indicator.innerHTML = `
            <span>Demo Mode</span>
            <a href="?" class="exit-demo">Exit</a>
        `;
        
        headerRight.insertBefore(indicator, headerRight.firstChild);
    };

    // UI State Management
    const showLoginPrompt = () => {
        const loginPrompt = $('loginPrompt');
        const prSections = $('prSections');
        
        if (loginPrompt) loginPrompt.style.display = 'flex';
        if (prSections) prSections.style.display = 'none';
    };

    const showMainContent = () => {
        const loginPrompt = $('loginPrompt');
        const prSections = $('prSections');
        
        if (loginPrompt) loginPrompt.style.display = 'none';
        if (prSections) prSections.style.display = 'block';
    };

    const showLoadingState = () => {
        // Implement loading state UI
    };

    const showErrorState = message => {
        showToast(message, 'error');
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

    // Event Handlers
    const handleOrgChange = () => {
        updatePRSections();
    };

    const handlePopState = event => {
        if (event.state?.user) {
            loadUserData(event.state.user);
        }
    };

    const handleAuthError = () => {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        state.accessToken = null;
        showLoginPrompt();
        showToast('Authentication failed. Please login again.', 'error');
    };

    // Utility Functions
    const createSparkline = (data, width = CONFIG.SPARKLINE.width, height = CONFIG.SPARKLINE.height, color = CONFIG.SPARKLINE.color) => {
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

    // Global Functions
    window.logout = () => {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        window.location.href = window.location.pathname;
    };

    window.initiateLogin = initiateLogin;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();