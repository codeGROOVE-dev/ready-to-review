// Changelog Module - Displays merged PRs from the last week
import { $, $$, show, hide, showToast } from './utils.js';

export const Changelog = (() => {
  "use strict";

  const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
  const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours
  const CACHE_KEY_PREFIX = 'changelog_cache_';

  // Cache management
  const getCacheKey = (org, username) => {
    if (username && org) {
      return `${CACHE_KEY_PREFIX}${org}_${username}`;
    } else if (org) {
      return `${CACHE_KEY_PREFIX}${org}`;
    } else if (username) {
      return `${CACHE_KEY_PREFIX}user_${username}`;
    }
    return `${CACHE_KEY_PREFIX}all`;
  };

  const getCachedData = (key) => {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;
      
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

  const clearCache = () => {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    showToast('Changelog cache cleared', 'success');
  };

  // GitHub search pagination helper
  const githubSearchAll = async (url, maxPages = 10, githubAPI) => {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const separator = url.includes('?') ? '&' : '?';
      const pageUrl = `${url}${separator}page=${page}`;
      
      try {
        const response = await githubAPI(pageUrl);
        if (response.items && response.items.length > 0) {
          allItems.push(...response.items);
          hasMore = response.items.length === 100; // GitHub returns max 100 per page
        } else {
          hasMore = false;
        }
        page++;
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        hasMore = false;
      }
    }

    return { items: allItems, total_count: allItems.length };
  };

  // Calculate importance score for PR
  const calculatePRScore = (pr) => {
    let score = 0;
    
    // Base score from engagement
    score += pr.comments || 0;
    score += (pr.reactions?.total_count || 0) * 4;
    
    // Analyze title and body
    const text = ((pr.title || '') + ' ' + (pr.body || '')).toLowerCase();
    
    // Major features with 'feat' prefix get highest bonus
    if (text.match(/\b(feat)\b/)) {
      score += 4;
    }
    
    // Other features/additions get bonus
    if (text.match(/\b(add|new|feature|implement|introduce|create)\b/)) {
      score += 2;
    }
    
    // Important operational keywords
    if (text.match(/\b(mitigate|warn|error|oom)\b/)) {
      score += 2;
    }
    
    // Reverts are especially important
    if (text.match(/\b(revert)\b/)) {
      score += 4;
    }
    
    // Breaking changes or major updates
    if (text.match(/\b(breaking|major|refactor|redesign|rework|migrate|replace)\b/)) {
      score += 3;
    }
    
    // Security fixes get highest priority
    if (text.match(/\b(security|vulnerability|cve|exploit|ghsa)\b/i)) {
      score += 8;
    }
    
    // Performance improvements
    if (text.match(/\b(performance|optimize|speed|fast|perf)\b/)) {
      score += 1;
    }
    
    // Minor updates and fixes
    if (text.match(/\b(fix|update|remove|tune|edit|edits|correct|patch)\b/)) {
      score -= 1;
    }
    
    // Routine maintenance
    if (text.match(/\b(chore|bump|typo|cleanup|lint|format|tweak)\b/)) {
      score -= 2;
    }
    
    // Test-related changes are less important
    if (text.match(/\b(test)\b/)) {
      score -= 1;
    }
    
    // Dependencies and automated updates
    if (text.match(/\b(dependabot|dependency|dependencies|deps)\b/) || isBot(pr.user)) {
      score -= 3;
    }
    
    // Label-based scoring
    const labels = pr.labels?.map(l => l.name.toLowerCase()) || [];
    if (labels.some(l => l.includes('breaking'))) score += 3;
    if (labels.some(l => l.includes('feature') || l.includes('enhancement'))) score += 2;
    if (labels.some(l => l.includes('bug') || l.includes('critical'))) score += 1;
    if (labels.some(l => l.includes('documentation') || l.includes('docs'))) score -= 1;
    
    // PR size indicator (more reviewers usually means bigger change)
    if (pr.requested_reviewers && pr.requested_reviewers.length > 2) score += 1;
    
    // Milestone PRs are usually important
    if (pr.milestone) score += 2;
    
    return score;
  };

  // Check if a user is a bot
  const isBot = (user) => {
    if (!user) return false;
    const login = user.login.toLowerCase();
    return user.type === 'Bot' || 
           login.endsWith('[bot]') || 
           login.endsWith('-bot') ||
           login.endsWith('-robot') ||
           login.includes('dependabot');
  };

  const showChangelogPage = async (state, githubAPI, parseURL) => {
    // Hide other content
    $$('[id$="Content"], #prSections, #loginPrompt').forEach(el => el?.setAttribute('hidden', ''));
    
    const changelogContent = $('changelogContent');
    const changelogLoading = $('changelogLoading');
    const changelogEmpty = $('changelogEmpty');
    const changelogProjects = $('changelogProjects');
    const changelogTitleText = $('changelogTitleText');
    const changelogPeriod = $('changelogPeriod');
    const changelogBotToggle = $('changelogBotToggle');
    const changelogSummary = $('changelogSummary');
    const includeBots = $('includeBots');
    const clearCacheLink = $('clearChangelogCache');
    const changelogOrgLink = $('changelogOrgLink');
    const changelogOrgLinkAnchor = $('changelogOrgLinkAnchor');
    
    if (!changelogContent) return;
    
    show(changelogContent);
    show(changelogLoading);
    hide(changelogEmpty);
    hide(changelogProjects);
    
    const urlContext = parseURL();
    const { org, username } = urlContext || {};
    
    try {
      // Determine what we're fetching
      let titleText = 'Changelog';
      let subtitleText = 'Recent pull requests merged in the last 7 days';
      let searchQuery = '';
      
      // Build the search query based on context
      const now = new Date();
      const oneWeekAgo = new Date(Date.now() - WEEK_IN_MS);
      const oneWeekAgoISO = oneWeekAgo.toISOString().split('T')[0];
      
      // Format the date range
      const formatDate = (date) => date.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
      const periodText = `${formatDate(oneWeekAgo)} – ${formatDate(now)}`;
      changelogPeriod.textContent = periodText;
      
      // Show bot toggle only for org view
      if (org && !username) {
        show(changelogBotToggle);
      } else {
        hide(changelogBotToggle);
      }
      
      // Show org link only when viewing a specific user in an org
      if (username && org) {
        show(changelogOrgLink);
        changelogOrgLinkAnchor.href = `/changelog/gh/${org}`;
      } else {
        hide(changelogOrgLink);
      }
      
      if (username && org) {
        // Specific user in specific org
        titleText = `${username} in ${org}`;
        subtitleText = `Pull requests merged by ${username}`;
        searchQuery = `type:pr is:merged org:${org} author:${username} merged:>=${oneWeekAgoISO}`;
      } else if (org) {
        // All repos in org
        titleText = org;
        subtitleText = `All pull requests merged in this organization`;
        searchQuery = `type:pr is:merged org:${org} merged:>=${oneWeekAgoISO}`;
      } else if (username) {
        // User's repos across all orgs
        titleText = username;
        subtitleText = `Pull requests merged across all repositories`;
        searchQuery = `type:pr is:merged author:${username} merged:>=${oneWeekAgoISO}`;
      }
      
      if (username && org) {
        changelogTitleText.textContent = `${username}'s changes to ${org}`;
      } else if (org) {
        changelogTitleText.textContent = `What's New in ${org}`;
      } else if (username) {
        changelogTitleText.textContent = `What's New from ${username}`;
      } else {
        changelogTitleText.textContent = 'What\'s New';
      }
      
      // Check cache first
      const cacheKey = getCacheKey(org, username);
      const cached = getCachedData(cacheKey);
      
      // Setup clear cache handler
      if (clearCacheLink) {
        clearCacheLink.onclick = (e) => {
          e.preventDefault();
          clearCache();
          showChangelogPage(state, githubAPI, parseURL);
        };
      }
      
      let mergedPRs;
      
      if (cached) {
        console.log('Using cached changelog data');
        mergedPRs = cached.data;
        const ageMinutes = Math.floor(cached.age / 60000);
        if (clearCacheLink) {
          const ageText = ageMinutes < 60 
            ? `${ageMinutes}m ago`
            : `${Math.floor(ageMinutes / 60)}h ago`;
          clearCacheLink.title = `Cached ${ageText}. Click to refresh.`;
        }
      } else {
        console.log('Fetching fresh changelog data');
        // Fetch all merged PRs with a single query
        const searchUrl = `/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&order=desc&per_page=100`;
        const searchResults = await githubSearchAll(searchUrl, 20, githubAPI);
        mergedPRs = searchResults.items || [];
        
        // Cache the results
        setCachedData(cacheKey, mergedPRs);
        if (clearCacheLink) {
          clearCacheLink.title = 'Data is fresh. Click to force refresh.';
        }
      }
      
      // Filter and group PRs
      const filterAndRenderPRs = () => {
        const shouldIncludeBots = !includeBots || includeBots.checked;
        
        // Filter PRs based on bot preference
        const filteredPRs = shouldIncludeBots 
          ? mergedPRs 
          : mergedPRs.filter(pr => !isBot(pr.user));
        
        // Group PRs by repository
        const projectsData = {};
        
        for (const pr of filteredPRs) {
          const repoFullName = pr.repository_url.replace('https://api.github.com/repos/', '');
          const [repoOrg, repoName] = repoFullName.split('/');
          
          if (!projectsData[repoFullName]) {
            projectsData[repoFullName] = {
              name: repoName,
              fullName: repoFullName,
              url: `https://github.com/${repoFullName}`,
              prs: [],
              contributors: new Set()
            };
          }
          
          projectsData[repoFullName].prs.push(pr);
          projectsData[repoFullName].contributors.add(pr.user.login);
        }
        
        renderProjects(projectsData);
      };
      
      // Setup bot toggle handler
      if (includeBots) {
        includeBots.onchange = filterAndRenderPRs;
      }
      
      const renderProjects = (projectsData) => {
        hide(changelogLoading);
        
        // Calculate total importance score for each project
        Object.values(projectsData).forEach(project => {
          project.totalScore = project.prs.reduce((sum, pr) => sum + calculatePRScore(pr), 0);
        });
        
        // Sort projects by cumulative importance score
        const projectsArray = Object.values(projectsData).sort((a, b) => b.totalScore - a.totalScore);
        const totalPRs = projectsArray.reduce((sum, p) => sum + p.prs.length, 0);
        const totalContributors = new Set(projectsArray.flatMap(p => Array.from(p.contributors))).size;
        const activeProjects = projectsArray.length;
        
        if (projectsArray.length === 0) {
          show(changelogEmpty);
          hide(changelogProjects);
          hide(changelogSummary);
        } else {
          hide(changelogEmpty);
          show(changelogProjects);
          
          // Show summary for org view
          if (org && !username) {
            show(changelogSummary);
            changelogSummary.innerHTML = `
              <div class="summary-grid">
                <div class="summary-item">
                  <div class="summary-value">${totalPRs}</div>
                  <div class="summary-label">Pull Requests</div>
                </div>
                <div class="summary-item">
                  <div class="summary-value">${activeProjects}</div>
                  <div class="summary-label">Active Projects</div>
                </div>
                <div class="summary-item">
                  <div class="summary-value">${totalContributors}</div>
                  <div class="summary-label">Contributors</div>
                </div>
              </div>
            `;
          } else {
            hide(changelogSummary);
          }
          
          // Create document-style changelog
          changelogProjects.innerHTML = `
            <div class="changelog-document">
              ${projectsArray.map(project => {
                // Sort PRs by importance score (highest first), then by PR number
                const sortedPRs = [...project.prs].sort((a, b) => {
                  const scoreA = calculatePRScore(a);
                  const scoreB = calculatePRScore(b);
                  // Sort by score first, then by PR number as tiebreaker
                  return scoreB - scoreA || b.number - a.number;
                });
                
                return `
                  <section class="changelog-section">
                    <h3 class="section-title">${project.name}</h3>
                    <ul class="change-list">
                      ${sortedPRs.map(pr => {
                        const score = calculatePRScore(pr);
                        return `
                          <li data-score="${score}"><a href="${pr.html_url}" target="_blank" rel="noopener" class="change-title">${pr.title}</a> <span class="change-number">#${pr.number}</span></li>
                        `;
                      }).join('')}
                    </ul>
                  </section>
                `;
              }).join('')}
            </div>
          `;
        }
      };
      
      // Initial render
      filterAndRenderPRs();
      
    } catch (error) {
      console.error('Error loading changelog:', error);
      hide(changelogLoading);
      showToast('Failed to load changelog. Please try again.', 'error');
    }
  };

  return {
    showChangelogPage,
    clearCache
  };
})();