// Leaderboard Module - Shows PR merge activity by contributor
import { $, $$, show, hide, showToast } from './utils.js';
import { Stats } from './stats.js';

export const Leaderboard = (() => {
  "use strict";

  const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000;
  const CACHE_KEY_PREFIX = 'leaderboard_cache_';
  const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours

  // Reuse cache functions from stats module
  const getCachedData = (key) => {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;
      
      // Cache for 4 hours
      if (age > CACHE_DURATION) {
        localStorage.removeItem(key);
        return null;
      }
      
      return { data, age };
    } catch (e) {
      console.error('Error reading cache:', e);
      return null;
    }
  };

  const setCachedData = (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('Error setting cache:', e);
    }
  };

  const showLeaderboardPage = async (state, githubAPI, loadCurrentUser, updateUserDisplay, setupHamburgerMenu, updateOrgFilter, handleOrgChange, handleSearch, parseURL, loadUserOrganizations) => {
    // Hide other content
    $$('[id$="Content"], #prSections, #loginPrompt').forEach(el => el?.setAttribute('hidden', ''));
    
    const leaderboardContent = $('leaderboardContent');
    if (!leaderboardContent) {
      console.error('Leaderboard content element not found');
      return;
    }
    
    show(leaderboardContent);
    
    // Load current user if needed
    if (!state.currentUser) {
      try {
        await loadCurrentUser();
      } catch (error) {
        console.error('Failed to load current user:', error);
        showToast('Please login to view leaderboard', 'error');
        window.location.href = '/';
        return;
      }
    }
    
    updateUserDisplay(state, () => {});
    setupHamburgerMenu();
    
    // Update search input placeholder
    const searchInput = $('searchInput');
    if (searchInput) {
      searchInput.placeholder = 'Search users...';
      searchInput.value = '';
    }
    
    // Setup handlers
    const orgSelect = $('orgSelect');
    if (orgSelect) {
      orgSelect.removeEventListener('change', handleOrgChange);
      orgSelect.addEventListener('change', handleOrgChange);
    }
    
    // Load user organizations for dropdown
    await loadUserOrganizations(state, githubAPI, parseURL);
    
    // Update org filter
    await updateOrgFilter(state, parseURL, githubAPI);
    
    // Disable org selector if no org specified
    const urlContext = parseURL();
    const org = urlContext?.org;
    
    if (!org && orgSelect) {
      // Force selection of first non-asterisk org
      const firstOrgOption = Array.from(orgSelect.options).find(opt => opt.value !== '*');
      if (firstOrgOption) {
        orgSelect.value = firstOrgOption.value;
        window.location.href = `/leaderboard/gh/${firstOrgOption.value}`;
        return;
      }
    }
    
    if (!org) {
      showToast('Please select an organization', 'info');
      return;
    }
    
    // Show loading state
    const loadingDiv = $('leaderboardLoading');
    const contentDiv = $('leaderboardData');
    show(loadingDiv);
    hide(contentDiv);
    
    try {
      // Check cache first
      const cacheKey = `${CACHE_KEY_PREFIX}${org}`;
      const cached = getCachedData(cacheKey);
      
      let mergedPRs;
      if (cached) {
        console.log('Using cached data for leaderboard');
        mergedPRs = cached.data;
        console.log('Cached leaderboard data:', {
          totalPRs: mergedPRs.length,
          cacheAge: Math.round(cached.age / 60000) + ' minutes',
          dateRange: {
            from: new Date(Date.now() - TEN_DAYS_IN_MS).toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0]
          },
          samplePRs: mergedPRs.slice(0, 3).map(pr => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login || 'unknown',
            repo: pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown'
          }))
        });
      } else {
        console.log('Fetching fresh data for leaderboard');
        // Fetch merged PRs from last 10 days
        const tenDaysAgo = new Date(Date.now() - TEN_DAYS_IN_MS);
        const mergedQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgo.toISOString().split('T')[0]}`;
        
        // Use Stats module's search function
        const mergedResponse = await Stats.githubSearchAll(
          `/search/issues?q=${encodeURIComponent(mergedQuery)}&sort=updated&order=desc&per_page=100`,
          20,
          githubAPI
        );
        
        mergedPRs = mergedResponse.items || [];
        
        // Cache the results
        setCachedData(cacheKey, mergedPRs);
      }
      
      // Filter out bots and count PRs by author
      const authorCounts = {};
      mergedPRs.forEach(pr => {
        const author = pr.user.login;
        
        // Skip bots
        const authorLower = author.toLowerCase();
        if (pr.user.type === 'Bot' || 
            authorLower.endsWith('[bot]') || 
            authorLower.endsWith('-bot') ||
            authorLower.endsWith('-robot') ||
            authorLower.includes('dependabot')) {
          return;
        }
        
        if (!authorCounts[author]) {
          authorCounts[author] = {
            login: author,
            avatar_url: pr.user.avatar_url,
            html_url: pr.user.html_url,
            count: 0
          };
        }
        authorCounts[author].count++;
      });
      
      // Convert to array and sort by count
      const allContributors = Object.values(authorCounts);
      const totalContributors = allContributors.length;
      
      const leaderboard = allContributors
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Top 10 contributors
      
      // Calculate max for scaling
      const maxCount = leaderboard[0]?.count || 0;
      
      // Render leaderboard
      hide(loadingDiv);
      show(contentDiv);
      
      if (leaderboard.length === 0) {
        contentDiv.innerHTML = `
          <div class="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="4" y="12" width="3" height="8" rx="1" />
              <rect x="10.5" y="6" width="3" height="14" rx="1" />
              <rect x="17" y="9" width="3" height="11" rx="1" />
            </svg>
            <p>No pull requests merged in the last 10 days 😴</p>
            <p style="font-size: 0.875rem; color: var(--color-text-secondary); margin-top: 0.5rem;">Time to ship some code!</p>
          </div>
        `;
        return;
      }
      
      contentDiv.innerHTML = `
        <div class="leaderboard-container">
          <div class="leaderboard-header">
            <h1 class="leaderboard-title">Top Contributors 🎆</h1>
            <p class="leaderboard-period">Last 10 days in ${org} ✨</p>
          </div>
          <div class="leaderboard-stats-summary">
            <div class="summary-stat">
              <div class="summary-value">${mergedPRs.length}</div>
              <div class="summary-label">Pull Requests 🎉</div>
            </div>
            <div class="summary-stat">
              <div class="summary-value">${totalContributors}</div>
              <div class="summary-label">Active Contributors 👥</div>
            </div>
          </div>
          <div class="leaderboard-list">
            ${leaderboard.map((author, index) => {
              const percentage = (author.count / maxCount) * 100;
              const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
              const celebrationEmoji = index === 0 ? '👑' : index < 3 ? '⭐' : '';
              return `
                <div class="leaderboard-item ${index < 3 ? 'top-three' : ''}" style="animation-delay: ${index * 0.1}s">
                  <div class="leaderboard-position">
                    <span class="position-number">${index + 1}</span>
                    ${medal ? `<span class="medal">${medal}</span>` : ''}
                  </div>
                  <img src="${author.avatar_url}" alt="${author.login}" class="contributor-avatar">
                  <div class="contributor-info">
                    <a href="${author.html_url}" target="_blank" rel="noopener" class="contributor-name">${author.login}</a>
                    <div class="contribution-bar">
                      <div class="bar-fill" style="width: ${percentage}%"></div>
                    </div>
                  </div>
                  <div class="contribution-count">
                    <span class="count-number">${author.count}</span>
                    <span class="count-label">PR${author.count !== 1 ? 's' : ''} ${celebrationEmoji}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      // Setup search functionality
      if (searchInput) {
        const handleLeaderboardSearch = () => {
          const searchTerm = searchInput.value.toLowerCase();
          const items = $$('.leaderboard-item');
          
          items.forEach(item => {
            const name = item.querySelector('.contributor-name')?.textContent.toLowerCase() || '';
            if (searchTerm === '' || name.includes(searchTerm)) {
              show(item);
            } else {
              hide(item);
            }
          });
        };
        
        searchInput.removeEventListener('input', handleSearch);
        searchInput.addEventListener('input', handleLeaderboardSearch);
      }
      
    } catch (error) {
      console.error('Error loading leaderboard:', error);
      hide(loadingDiv);
      show(contentDiv);
      contentDiv.innerHTML = `
        <div class="error-state">
          <p>Failed to load leaderboard data</p>
          <p class="error-detail">${error.message}</p>
        </div>
      `;
    }
  };

  return {
    showLeaderboardPage
  };
})();
