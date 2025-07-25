// Changelog Module - Displays merged PRs from the last week
import { $, $$, show, hide, showToast } from './utils.js';
import { Auth } from './auth.js';

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

  // Scoring configuration for PR importance
  const SCORE_CONFIG = {
    textPatterns: [
      { pattern: /\b(security|vulnerability|cve|exploit|ghsa)\b/i, score: 8 },
      { pattern: /\b(feat)\b/, score: 4 },
      { pattern: /\b(revert)\b/, score: 4 },
      { pattern: /\b(breaking|major|refactor|redesign|rework|migrate|replace)\b/, score: 3 },
      { pattern: /\b(add|new|feature|implement|introduce|create)\b/, score: 2 },
      { pattern: /\b(mitigate|warn|error|oom)\b/, score: 2 },
      { pattern: /\b(performance|optimize|speed|fast|perf)\b/, score: 1 },
      { pattern: /\b(fix|update|remove|tune|edit|edits|correct|patch)\b/, score: -1 },
      { pattern: /\b(test)\b/, score: -1 },
      { pattern: /\b(chore|bump|typo|cleanup|lint|format|tweak)\b/, score: -2 },
      { pattern: /\b(dependabot|dependency|dependencies|deps)\b/, score: -3 }
    ],
    labelPatterns: [
      { check: l => l.includes('breaking'), score: 3 },
      { check: l => l.includes('feature') || l.includes('enhancement'), score: 2 },
      { check: l => l.includes('bug') || l.includes('critical'), score: 1 },
      { check: l => l.includes('documentation') || l.includes('docs'), score: -1 }
    ]
  };

  // Calculate importance score for PR
  const calculatePRScore = (pr) => {
    let score = 0;
    
    // Base score from commit count and engagement
    score += pr.commitCount || 0;
    score += pr.comments || 0;
    score += (pr.reactions?.total_count || 0) * 4;
    
    // Text-based scoring
    const text = ((pr.title || '') + ' ' + (pr.body || '')).toLowerCase();
    for (const { pattern, score: points } of SCORE_CONFIG.textPatterns) {
      if (text.match(pattern)) score += points;
    }
    
    // Bot penalty
    if (isBot(pr.user)) score -= 3;
    
    // Label-based scoring
    const labels = pr.labels?.map(l => l.name.toLowerCase()) || [];
    for (const { check, score: points } of SCORE_CONFIG.labelPatterns) {
      if (labels.some(check)) score += points;
    }
    
    // Other factors
    if (pr.requested_reviewers?.length > 2) score += 1;
    if (pr.milestone) score += 2;
    
    return score;
  };

  // Calculate importance score for direct commits
  const calculateCommitScore = (commit) => {
    // Direct commits get high base score (almost as high as security changes)
    let score = 7;
    
    // Apply text-based modifiers
    const text = (commit.messageHeadline || '').toLowerCase();
    for (const { pattern, score: points } of SCORE_CONFIG.textPatterns) {
      if (text.match(pattern)) score += points;
    }
    
    // Bot penalty for commits
    const author = commit.author?.user || { login: commit.author?.email || 'unknown' };
    if (isBot(author)) score -= 3;
    
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

  // Build GitHub search query for PRs
  const buildPRSearchQuery = (org, username, oneWeekAgoISO) => {
    const base = `type:pr is:merged merged:>=${oneWeekAgoISO}`;
    if (username && org) {
      return `${base} org:${org} author:${username}`;
    } else if (org) {
      return `${base} org:${org}`;
    } else if (username) {
      return `${base} author:${username}`;
    }
    return base;
  };

  // GraphQL with retry logic
  const githubGraphQLWithRetry = async (query, variables = {}, maxRetries = 3) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await Auth.githubGraphQL(query, variables);
      } catch (error) {
        lastError = error;
        console.warn(`GraphQL attempt ${attempt} failed:`, error.message);
        
        // Don't retry on authentication errors
        if (error.message?.includes('authentication') || error.message?.includes('401')) {
          throw error;
        }
        
        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };


  // Fetch merged PRs with commit counts using GraphQL
  const fetchMergedPRsWithCommits = async (org, username, oneWeekAgoISO) => {
    console.log('Attempting to fetch PRs via GraphQL...');
    
    const searchQuery = buildPRSearchQuery(org, username, oneWeekAgoISO);
    
    const query = `
      query SearchPullRequests($query: String!, $first: Int!, $after: String) {
        search(query: $query, type: ISSUE, first: $first, after: $after) {
          issueCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on PullRequest {
              number
              title
              body
              url
              state
              createdAt
              updatedAt
              mergedAt
              comments {
                totalCount
              }
              commits {
                totalCount
              }
              author {
                login
              }
              repository {
                name
                owner {
                  login
                }
              }
              labels(first: 10) {
                nodes {
                  name
                }
              }
              reactions {
                totalCount
              }
              milestone {
                title
              }
            }
          }
        }
      }
    `;
    
    try {
      const allPRs = [];
      let hasNextPage = true;
      let cursor = null;
      
      while (hasNextPage && allPRs.length < 2000) { // Limit to 2000 PRs
        const variables = {
          query: searchQuery,
          first: 100,
          after: cursor
        };
        
        console.log('Fetching PRs with GraphQL, variables:', variables);
        const data = await githubGraphQLWithRetry(query, variables);
        
        if (data?.search?.nodes) {
          const prs = data.search.nodes.map(pr => ({
            number: pr.number,
            title: pr.title,
            body: pr.body,
            html_url: pr.url,
            state: pr.state,
            created_at: pr.createdAt,
            updated_at: pr.updatedAt,
            merged_at: pr.mergedAt,
            comments: pr.comments.totalCount,
            commitCount: pr.commits.totalCount,
            user: pr.author,
            repository_url: `https://api.github.com/repos/${pr.repository.owner.login}/${pr.repository.name}`,
            labels: pr.labels.nodes,
            reactions: pr.reactions,
            milestone: pr.milestone
          }));
          
          allPRs.push(...prs);
        }
        
        hasNextPage = data?.search?.pageInfo?.hasNextPage || false;
        cursor = data?.search?.pageInfo?.endCursor;
      }
      
      return allPRs;
    } catch (error) {
      console.error('Error fetching PRs via GraphQL:', error);
      // Fall back to REST API
      return null;
    }
  };

  // Fetch commits for organization using GraphQL
  const fetchOrgCommits = async (org, oneWeekAgoISO) => {
    const query = `
      query OrganizationCommits($orgLogin: String!, $firstRepos: Int = 50, $since: GitTimestamp!) {
        organization(login: $orgLogin) {
          repositories(first: $firstRepos, orderBy: {field: PUSHED_AT, direction: DESC}) {
            nodes {
              name
              owner {
                login
              }
              pushedAt
              defaultBranchRef {
                target {
                  ... on Commit {
                    history(first: 20, since: $since) {
                      totalCount
                      nodes {
                        oid
                        messageHeadline
                        committedDate
                        author {
                          user {
                            login
                          }
                          name
                        }
                        associatedPullRequests(first: 1) {
                          nodes {
                            number
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    try {
      const data = await githubGraphQLWithRetry(query, {
        orgLogin: org,
        since: oneWeekAgoISO + 'T00:00:00Z'
      });
      
      const commits = [];
      if (data?.organization?.repositories?.nodes) {
        for (const repo of data.organization.repositories.nodes) {
          // Skip repos that haven't been pushed to recently
          if (repo.pushedAt && new Date(repo.pushedAt) < new Date(Date.now() - WEEK_IN_MS)) {
            continue;
          }
          
          if (repo.defaultBranchRef?.target?.history?.nodes) {
            const repoCommits = repo.defaultBranchRef.target.history.nodes;
            repoCommits.forEach(commit => {
              commits.push({
                ...commit,
                repository: {
                  name: repo.name,
                  owner: repo.owner.login,
                  fullName: `${repo.owner.login}/${repo.name}`
                }
              });
            });
          }
        }
      }
      return commits;
    } catch (error) {
      console.error('Error fetching commits via GraphQL:', error);
      return [];
    }
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
      } else if (org) {
        // All repos in org
        titleText = org;
        subtitleText = `All pull requests merged in this organization`;
      } else if (username) {
        // User's repos across all orgs
        titleText = username;
        subtitleText = `Pull requests merged across all repositories`;
      }
      
      searchQuery = buildPRSearchQuery(org, username, oneWeekAgoISO);
      
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
        clearCacheLink.onclick = async (e) => {
          e.preventDefault();
          // Clear the cache for this specific view
          const cacheKey = getCacheKey(org, username);
          localStorage.removeItem(cacheKey);
          
          // Show loading state
          show(changelogLoading);
          hide(changelogProjects);
          hide(changelogEmpty);
          
          // Re-run the page to fetch fresh data (including GraphQL)
          await showChangelogPage(state, githubAPI, parseURL);
        };
      }
      
      let mergedPRs;
      
      let commits = [];
      let commitsFetchFailed = false;
      
      if (cached) {
        console.log('Using cached changelog data');
        if (cached.data.prs) {
          // New cache format
          mergedPRs = cached.data.prs;
          commits = cached.data.commits || [];
          commitsFetchFailed = cached.data.commitsFetchFailed || false;
          console.log('Cached changelog data (new format):', {
            prsCount: mergedPRs.length,
            commitsCount: commits.length,
            commitsFetchFailed: commitsFetchFailed,
            cacheAge: Math.round(cached.age / 60000) + ' minutes',
            samplePRs: mergedPRs.slice(0, 3).map(pr => ({
              number: pr.number,
              title: pr.title,
              repo: pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown'
            })),
            sampleCommits: commits.slice(0, 3).map(c => ({
              sha: c.oid?.substring(0, 7) || 'unknown',
              message: c.messageHeadline || 'no message',
              repo: c.repository?.fullName || 'unknown'
            }))
          });
        } else {
          // Old cache format
          mergedPRs = cached.data;
          console.log('Cached changelog data (old format):', {
            prsCount: mergedPRs.length,
            cacheAge: Math.round(cached.age / 60000) + ' minutes',
            samplePRs: mergedPRs.slice(0, 3).map(pr => ({
              number: pr.number,
              title: pr.title,
              repo: pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown'
            }))
          });
        }
        const ageMinutes = Math.floor(cached.age / 60000);
        if (clearCacheLink) {
          const ageText = ageMinutes < 60 
            ? `${ageMinutes}m ago`
            : `${Math.floor(ageMinutes / 60)}h ago`;
          clearCacheLink.title = `Cached ${ageText}. Click to refresh.`;
        }
      } else {
        console.log('Fetching fresh changelog data');
        
        // Try to fetch PRs with commit counts using GraphQL
        let usedGraphQL = false;
        try {
          mergedPRs = await fetchMergedPRsWithCommits(org, username, oneWeekAgoISO);
          if (mergedPRs && mergedPRs.length > 0) {
            console.log(`Successfully fetched ${mergedPRs.length} PRs via GraphQL with commit counts`);
            usedGraphQL = true;
          } else {
            console.log('GraphQL returned no results, falling back to REST API');
            mergedPRs = null;
          }
        } catch (error) {
          console.warn('GraphQL failed, falling back to REST API:', error);
          mergedPRs = null;
        }
        
        // If GraphQL fails or returns nothing, fall back to REST API
        if (!mergedPRs || mergedPRs.length === 0) {
          const searchUrl = `/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&order=desc&per_page=100`;
          const searchResults = await githubSearchAll(searchUrl, 20, githubAPI);
          mergedPRs = searchResults.items || [];
          console.log(`Fetched ${mergedPRs.length} PRs via REST API`);
        }
        
        // For org view, also fetch commits (for repos without PRs)
        let commits = [];
        let commitsFetchFailed = false;
        if (org && !username && Auth.getStoredToken()) {
          try {
            commits = await fetchOrgCommits(org, oneWeekAgoISO);
            console.log('Successfully fetched commits via GraphQL');
          } catch (error) {
            console.warn('Failed to fetch commits via GraphQL, continuing without commits:', error);
            commits = [];
            commitsFetchFailed = true;
          }
        }
        
        // Cache the results (including the fetch status)
        setCachedData(cacheKey, { prs: mergedPRs, commits, commitsFetchFailed });
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
        
        // Add PRs to projects
        for (const pr of filteredPRs) {
          const repoFullName = pr.repository_url.replace('https://api.github.com/repos/', '');
          const [repoOrg, repoName] = repoFullName.split('/');
          
          if (!projectsData[repoFullName]) {
            projectsData[repoFullName] = {
              name: repoName,
              fullName: repoFullName,
              url: `https://github.com/${repoFullName}`,
              prs: [],
              commits: [],
              contributors: new Set()
            };
          }
          
          projectsData[repoFullName].prs.push(pr);
          projectsData[repoFullName].contributors.add(pr.user.login);
        }
        
        // Add commits to projects (for repos without PRs)
        if (commits && commits.length > 0) {
          for (const commit of commits) {
            const repoFullName = commit.repository.fullName;
            
            // Skip if commit is already associated with a PR we have
            if (commit.associatedPullRequests?.nodes?.length > 0) {
              const prNumber = commit.associatedPullRequests.nodes[0].number;
              const hasPR = projectsData[repoFullName]?.prs.some(pr => pr.number === prNumber);
              if (hasPR) continue;
            }
            
            // Skip bot commits based on preference
            const commitAuthor = commit.author?.user || { login: commit.author?.email || 'unknown' };
            if (!shouldIncludeBots && isBot(commitAuthor)) continue;
            
            if (!projectsData[repoFullName]) {
              projectsData[repoFullName] = {
                name: commit.repository.name,
                fullName: repoFullName,
                url: `https://github.com/${repoFullName}`,
                prs: [],
                commits: [],
                contributors: new Set()
              };
            }
            
            projectsData[repoFullName].commits.push(commit);
            if (commitAuthor.login && commitAuthor.login !== 'unknown') {
              projectsData[repoFullName].contributors.add(commitAuthor.login);
            }
          }
        }
        
        renderProjects(projectsData, commitsFetchFailed);
      };
      
      // Setup bot toggle handler
      if (includeBots) {
        includeBots.onchange = filterAndRenderPRs;
      }
      
      const renderProjects = (projectsData, commitsFetchFailed = false) => {
        hide(changelogLoading);
        
        // Filter out empty projects and calculate total importance score
        const projectsWithContent = Object.values(projectsData).filter(project => 
          project.prs.length > 0 || project.commits.length > 0
        );
        
        projectsWithContent.forEach(project => {
          // Calculate score based on PRs and commits
          const prScore = project.prs.reduce((sum, pr) => sum + calculatePRScore(pr), 0);
          const commitScore = project.commits.length * 2; // Give some weight to commits
          project.totalScore = prScore + commitScore;
        });
        
        // Sort projects by cumulative importance score
        const projectsArray = projectsWithContent.sort((a, b) => b.totalScore - a.totalScore);
        const totalPRs = projectsArray.reduce((sum, p) => sum + p.prs.length, 0);
        const totalCommits = projectsArray.reduce((sum, p) => sum + p.commits.length, 0);
        const totalChanges = totalPRs + totalCommits;
        const totalContributors = new Set(projectsArray.flatMap(p => Array.from(p.contributors))).size;
        const activeProjects = projectsArray.length;
        
        // Check if we have any content to display (PRs or commits)
        const hasContent = projectsArray.length > 0 && 
          projectsArray.some(p => p.prs.length > 0 || p.commits.length > 0);
        
        if (!hasContent) {
          show(changelogEmpty);
          hide(changelogProjects);
          hide(changelogSummary);
          
          // Update empty message based on context
          const emptyMessage = changelogEmpty.querySelector('p');
          if (emptyMessage) {
            if (org && !username) {
              emptyMessage.textContent = 'No pull requests or commits found in the last 7 days';
            } else {
              emptyMessage.textContent = 'No pull requests merged in the last 7 days';
            }
          }
        } else {
          hide(changelogEmpty);
          show(changelogProjects);
          
          // Show summary for org view
          if (org && !username) {
            show(changelogSummary);
            const summaryHTML = `
              <div class="summary-grid">
                <div class="summary-item">
                  <div class="summary-value">${totalPRs}</div>
                  <div class="summary-label">Pull Requests</div>
                </div>
                ${org && !username ? `
                <div class="summary-item">
                  <div class="summary-value">${commitsFetchFailed ? 'N/A' : totalCommits}</div>
                  <div class="summary-label">Direct Commits</div>
                  ${commitsFetchFailed ? '<div class="summary-detail">Unable to fetch</div>' : ''}
                </div>
                ` : ''}
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
            changelogSummary.innerHTML = summaryHTML;
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
                
                // Sort commits by score (highest first), then by date
                const sortedCommits = [...project.commits].sort((a, b) => {
                  const scoreA = calculateCommitScore(a);
                  const scoreB = calculateCommitScore(b);
                  if (scoreA !== scoreB) return scoreB - scoreA;
                  return new Date(b.committedDate) - new Date(a.committedDate);
                });
                
                return `
                  <section class="changelog-section">
                    <h3 class="section-title">${project.name}</h3>
                    <ul class="change-list">
                      ${sortedPRs.map(pr => {
                        const score = calculatePRScore(pr);
                        const commitDataAttr = pr.commitCount ? ` data-commits="${pr.commitCount}"` : '';
                        return `
                          <li data-score="${score}"${commitDataAttr}><a href="${pr.html_url}" target="_blank" rel="noopener" class="change-title">${pr.title}</a> <span class="change-number">#${pr.number}</span></li>
                        `;
                      }).join('')}
                      ${sortedCommits.map(commit => {
                        const score = calculateCommitScore(commit);
                        const commitUrl = `https://github.com/${project.fullName}/commit/${commit.oid}`;
                        const shortSha = commit.oid.substring(0, 7);
                        return `
                          <li data-score="${score}"><a href="${commitUrl}" target="_blank" rel="noopener" class="change-title">${commit.messageHeadline}</a> <span class="change-number">${shortSha}</span></li>
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