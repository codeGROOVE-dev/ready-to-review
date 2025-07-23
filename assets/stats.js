// Stats Module for Ready To Review
import { $, show, hide, escapeHtml } from './utils.js';

export const Stats = (() => {
  "use strict";

  // DOM Helpers and utilities are imported from utils.js

  // Helper function to delay execution
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Wrapper to add retry logic to API calls with progressive delays
  const withRetry = async (apiCall, retryCount = 0, onRetry = null) => {
    // Progressive delays: 5s, 15s, 30s, 60s
    const retryDelays = [5000, 15000, 30000, 60000];
    
    try {
      return await apiCall();
    } catch (error) {
      console.log(`[Stats Debug] API call failed:`, error.message);
      
      if (retryCount < retryDelays.length && (
        error.message.includes('rate limit') ||
        error.message.includes('secondary rate limit') ||
        error.message.includes('API Error') ||
        error.message.includes('Failed to fetch')
      )) {
        const delayMs = retryDelays[retryCount];
        const attemptsLeft = retryDelays.length - retryCount;
        console.log(`[Stats Debug] Retrying after ${delayMs/1000} seconds... (${attemptsLeft} attempts left)`);
        if (onRetry) onRetry(true, delayMs);
        await delay(delayMs);
        return withRetry(apiCall, retryCount + 1, onRetry);
      }
      
      throw error;
    }
  };

  const githubSearchAll = async (searchPath, maxPages = 20, githubAPI, onProgress = null) => {
    console.log(`[Stats Debug] githubSearchAll called with path: ${searchPath}`);
    const allItems = [];
    let actualTotalCount = 0;
    
    // Use per_page=100 for efficiency
    const separator = searchPath.includes("?") ? "&" : "?";
    const baseSearchPath = `${searchPath}${separator}per_page=100`;
    
    // First, get the total count
    const firstPagePath = `${baseSearchPath}&page=1`;
    console.log(`[Stats Debug] Fetching first page to get total count: ${firstPagePath}`);
    
    const firstResponse = await withRetry(() => githubAPI(firstPagePath));
    actualTotalCount = firstResponse.total_count || 0;
    
    console.log(`[Stats Debug] Total count: ${actualTotalCount}`);
    
    // If we have 500 or fewer items, fetch them all normally
    if (actualTotalCount <= 500) {
      // Filter out PRs from archived or disabled repositories
      const activeItems = (firstResponse.items || []).filter(pr => {
        if (!pr.repository) return true; // Keep if no repository data
        return !pr.repository.archived && !pr.repository.disabled;
      });
      allItems.push(...activeItems);
      
      if (onProgress) {
        onProgress(allItems.length, actualTotalCount);
      }
      
      let page = 2;
      const maxPagesToFetch = Math.ceil(actualTotalCount / 100);
      
      while (allItems.length < actualTotalCount && page <= maxPagesToFetch) {
        const pagePath = `${baseSearchPath}&page=${page}`;
        console.log(`[Stats Debug] Fetching page ${page}: ${pagePath}`);
        
        const response = await withRetry(() => githubAPI(pagePath));
        
        if (response.items && response.items.length > 0) {
          // Filter out PRs from archived or disabled repositories
          const activeItems = response.items.filter(pr => {
            if (!pr.repo && !pr.repository) return true; // Keep if no repository data
            const repo = pr.repo || pr.repository;
            return !repo.archived && !repo.disabled;
          });
          allItems.push(...activeItems);
          
          if (onProgress) {
            onProgress(allItems.length, actualTotalCount);
          }
        }
        
        page++;
      }
    } else {
      // Intelligent sampling: use 5 API calls to sample across all results
      const MAX_API_CALLS = 5;
      const DESIRED_SAMPLES = 500;
      const GITHUB_MAX_PAGE = 10; // GitHub search API limit
      
      // Calculate which pages to fetch for even distribution
      const totalPages = Math.ceil(actualTotalCount / 100);
      const availablePages = Math.min(totalPages, GITHUB_MAX_PAGE); // Can't go beyond page 10
      const pageInterval = Math.max(1, Math.floor(availablePages / MAX_API_CALLS));
      
      console.log(`[Stats Debug] Sampling strategy: ${totalPages} total pages (${availablePages} available), fetching every ${pageInterval} pages`);
      
      // Always include the first page (already fetched)
      // Filter out PRs from archived or disabled repositories
      const firstPageActive = (firstResponse.items || []).filter(pr => {
        if (!pr.repo && !pr.repository) return true; // Keep if no repository data
        const repo = pr.repo || pr.repository;
        return !repo.archived && !repo.disabled;
      });
      allItems.push(...firstPageActive);
      
      if (onProgress) {
        onProgress(allItems.length, actualTotalCount);
      }
      
      // Calculate remaining pages to fetch
      const pagesToFetch = [];
      for (let i = 1; i < MAX_API_CALLS && pagesToFetch.length < MAX_API_CALLS - 1; i++) {
        const pageNum = 1 + (i * pageInterval);
        if (pageNum <= availablePages) {
          pagesToFetch.push(pageNum);
        }
      }
      
      // Always include the last available page for most recent data (but not beyond page 10)
      if (availablePages > 1 && !pagesToFetch.includes(availablePages)) {
        pagesToFetch[pagesToFetch.length - 1] = availablePages;
      }
      
      console.log(`[Stats Debug] Pages to fetch: [1, ${pagesToFetch.join(', ')}]`);
      
      // Fetch the selected pages
      for (const pageNum of pagesToFetch) {
        const pagePath = `${baseSearchPath}&page=${pageNum}`;
        console.log(`[Stats Debug] Fetching page ${pageNum}: ${pagePath}`);
        
        const response = await withRetry(() => githubAPI(pagePath));
        
        if (response.items && response.items.length > 0) {
          // Filter out PRs from archived or disabled repositories
          const activeItems = response.items.filter(pr => {
            if (!pr.repo && !pr.repository) return true; // Keep if no repository data
            const repo = pr.repo || pr.repository;
            return !repo.archived && !repo.disabled;
          });
          allItems.push(...activeItems);
          
          if (onProgress) {
            // Report approximate progress based on sampling
            const estimatedProgress = Math.min(
              DESIRED_SAMPLES,
              Math.round((allItems.length / (MAX_API_CALLS * 100)) * DESIRED_SAMPLES)
            );
            onProgress(estimatedProgress, actualTotalCount);
          }
        }
      }
    }
    
    console.log(`[Stats Debug] githubSearchAll complete:`, {
      totalItems: allItems.length,
      actualTotalCount: actualTotalCount,
      sampled: actualTotalCount > 500
    });
    
    return {
      items: allItems,
      total_count: actualTotalCount,
      sampled: actualTotalCount > 500,
      sampleSize: allItems.length
    };
  };

  const showStatsPage = async (state, githubAPI, loadCurrentUser, updateUserDisplay, setupHamburgerMenu, updateOrgFilter, handleOrgChange, handleSearch, parseURL, loadUserOrganizations) => {
    try {
      if (!state.accessToken) {
        const loginPrompt = $("loginPrompt");
        show(loginPrompt);
        hide($("prSections"));
        hide($("emptyState"));
        hide($("statsPage"));
        return;
      }

      if (!state.currentUser) {
        await loadCurrentUser();
      }

      const urlContext = parseURL();
      if (urlContext && urlContext.username) {
        if (!state.viewingUser || typeof state.viewingUser === "string") {
          try {
            state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
          } catch (error) {
            console.error("Error loading viewing user:", error);
            state.viewingUser = state.currentUser;
          }
        }
      }

      updateUserDisplay();
      setupHamburgerMenu();

      // Don't load pull requests on stats page - not needed
      // The stats page makes its own targeted queries

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

      updateOrgFilter();
      
      // Update hamburger menu links after org filter is set
      if (window.App && window.App.updateHamburgerMenuLinks) {
        window.App.updateHamburgerMenuLinks();
      }

      hide($("loginPrompt"));
      hide($("prSections"));
      hide($("emptyState"));
      show($("statsPage"));

      await loadStatsData(state, githubAPI, parseURL, loadUserOrganizations);
    } catch (error) {
      console.error("Error in showStatsPage:", error);
      
      // Show error on the stats page
      hide($("loginPrompt"));
      hide($("prSections"));
      hide($("emptyState"));
      show($("statsPage"));
      
      const container = $("orgStatsContainer");
      if (container) {
        if (error.isRateLimit) {
          container.innerHTML = `
            <div class="empty-state">
              <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <p>GitHub API rate limit exceeded</p>
              <p class="text-secondary">Please wait ${error.minutesUntilReset || 'a few'} minutes before refreshing</p>
              ${error.resetTime ? `<p class="text-secondary" style="font-size: 0.8rem; margin-top: 0.5rem;">Reset time: ${error.resetTime.toLocaleTimeString()}</p>` : ''}
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
              <p class="text-secondary">${escapeHtml(error.message)}</p>
            </div>
          `;
        }
      }
    }
  };

  const loadStatsData = async (state, githubAPI, parseURL, loadUserOrganizations) => {
    try {
      const urlContext = parseURL();
      if (!urlContext) return;

      const { username, org } = urlContext;
      const container = $("orgStatsContainer");

      if (!org) {
        container.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 400px;">
            <div style="text-align: center;">
              <div style="margin-bottom: 1.5rem;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2" style="animation: spin 2s linear infinite;">
                  <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
                </svg>
              </div>
              <div style="font-size: 1.125rem; color: #1a1a1a; font-weight: 500;">Finding your teams...</div>
              <div style="font-size: 0.875rem; color: #86868b; margin-top: 0.5rem;">Discovering where the magic happens ✨</div>
            </div>
          </div>
          <style>
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          </style>
        `;

        // Use the same cached organizations as the dropdown
        const orgs = await loadUserOrganizations(state, githubAPI);

        if (orgs.length === 0) {
          container.innerHTML =
            '<div class="empty-state">No organizations found</div>';
          return;
        }

        container.innerHTML = `
          <div class="org-selector">
            <h2 class="org-selector-title">Select an organization to view statistics</h2>
            <p class="org-selector-subtitle">Choose from your organizations where you've been active</p>
            <div class="org-list">
              ${orgs
                .map(
                  (orgName) => `
                <a href="/stats/gh/${escapeHtml(orgName)}" class="org-list-item">
                  <div class="org-list-name">${escapeHtml(orgName)}</div>
                </a>
              `,
                )
                .join("")}
            </div>
          </div>
        `;
        return;
      }

      // Show loading indicator
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 400px;" id="loadingContainer">
          <div id="statsLoadingIndicator" style="text-align: center;">
            <div style="margin-bottom: 1.5rem;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2" style="animation: spin 2s linear infinite;">
                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
              </svg>
            </div>
            <div style="font-size: 1.125rem; color: #1a1a1a; font-weight: 500;">Loading pull requests...</div>
            <div style="font-size: 0.875rem; color: #86868b; margin-top: 0.5rem;" id="loadingSubtext">Counting all the shipped goodness 📊</div>
          </div>
        </div>
        <style>
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(0.95); }
          }
        </style>
      `;

      // Create a wrapper that can update the loading message
      const githubAPIWithStatus = async (endpoint, options) => {
        const loadingEl = document.getElementById('statsLoadingIndicator');
        
        return withRetry(
          () => githubAPI(endpoint, options),
          0,
          (retrying, delayMs) => {
            if (retrying && loadingEl) {
              const messages = [
                `GitHub needs a breather! Trying again in ${delayMs/1000} seconds... ☕`,
                `Too many requests! Taking a ${delayMs/1000}-second power nap... 😴`,
                `Hit the rate limit! Back in ${delayMs/1000} seconds... 🚦`,
                `GitHub says slow down! Resuming in ${delayMs/1000} seconds... 🐌`
              ];
              const randomMessage = messages[Math.floor(Math.random() * messages.length)];
              
              loadingEl.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="2" style="animation: pulse 2s ease-in-out infinite;">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div style="font-size: 1.125rem; color: #1a1a1a; font-weight: 500;">${randomMessage}</div>
                <div style="font-size: 0.875rem; color: #86868b; margin-top: 0.5rem;">Your stats will be worth the wait!</div>
              `;
            }
          }
        );
      };

      // Create the org section and add it to the DOM immediately (but hidden)
      const orgSection = createOrgSection(org);
      orgSection.style.display = 'none';
      container.appendChild(orgSection);
      
      // Process stats and display them
      await processOrgStats(org, username, githubAPIWithStatus);
      
      // Remove loading screen and show the populated org section
      const loadingContainer = document.getElementById('loadingContainer');
      if (loadingContainer) {
        loadingContainer.remove();
      }
      orgSection.style.display = 'block';
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
      <div class="org-section-content" style="max-width: 1000px; margin: 0 auto;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 3rem;">
          <h2 style="font-size: 2.5rem; font-weight: 600; color: #1a1a1a; margin: 0;">${escapeHtml(org)}</h2>
          <div id="cache-age-${org}" class="cache-age" style="display: none; font-size: 0.8125rem; color: #86868b; margin-top: 0.5rem;"></div>
        </div>
        
        <!-- Hero Score -->
        <div style="background: #ffffff; border-radius: 20px; padding: 3rem; margin-bottom: 2rem; box-shadow: 0 2px 20px rgba(0,0,0,0.08); text-align: center;">
          <div style="font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em; color: #86868b; margin-bottom: 1rem;">Code Review Health Ratio</div>
          <div class="ratio-display loading" id="ratioDisplay-${org}" style="font-size: 4.5rem; font-weight: 300; color: #1a1a1a; margin: 0; line-height: 1;">-</div>
          <div class="ratio-description" id="ratioDescription-${org}" style="font-size: 1.125rem; color: #515154; margin-top: 1rem; font-weight: 400;"></div>
          
          <!-- Visual indicator -->
          <div style="margin: 2.5rem auto 0; max-width: 500px;">
            <div style="display: flex; align-items: center; gap: 2rem;">
              <canvas id="prRatioChart-${org}" width="160" height="160" style="max-width: 160px;"></canvas>
              <div class="chart-legend" id="chartLegend-${org}" style="text-align: left; font-size: 0.9375rem;"></div>
            </div>
          </div>
        </div>

        <!-- Key Metrics Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <!-- Stuck PRs - Most Important -->
          <a href="#" id="openPRsLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;" 
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Forgotten Work</div>
              <div class="stat-value loading" id="openPRs-${org}" style="font-size: 3rem; font-weight: 300; color: #FF3B30; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">PRs stuck >10 days</div>
            </div>
          </a>
          
          <!-- Average Wait Time -->
          <a href="#" id="avgOpenAgeLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Wait Time</div>
              <div class="stat-value loading" id="avgOpenAge-${org}" style="font-size: 3rem; font-weight: 300; color: #1a1a1a; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">Avg age of open PRs</div>
            </div>
          </a>
          
          <!-- Cycle Time -->
          <a href="#" id="avgMergeTimeLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Cycle Time</div>
              <div class="stat-value loading" id="avgMergeTime-${org}" style="font-size: 3rem; font-weight: 300; color: #1a1a1a; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">Create → merge time</div>
            </div>
          </a>
          
          <!-- Shipped -->
          <a href="#" id="mergedPRsLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Shipped</div>
              <div class="stat-value loading" id="mergedPRs-${org}" style="font-size: 3rem; font-weight: 300; color: #34C759; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">Last 10 days</div>
            </div>
          </a>
        </div>
        
        <!-- Insight -->
        <div style="background: #f5f5f7; border-radius: 16px; padding: 2rem; text-align: center;">
          <p style="font-size: 1.0625rem; color: #1a1a1a; line-height: 1.7; margin: 0; max-width: 700px; margin: 0 auto;">
            Focus on reducing forgotten PRs. Each one represents completed work that isn't delivering value. 
            <span style="color: #86868b;">Target: <21 days average wait, <10% stuck.</span>
          </p>
          <p class="data-limit-note" id="dataLimitNote-${org}" style="display: none; font-size: 0.875rem; color: #86868b; margin-top: 1rem;">
            *Statistics based on a representative sample for performance.
          </p>
        </div>
      </div>
    `;

    return section;
  };

  const processOrgStats = async (org, username, githubAPI) => {
    try {
      console.log(`[Stats Debug] Processing stats for org: ${org}`);
      const CACHE_KEY = `r2r_stats_${org}`;
      const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
      const SHOW_CACHE_AGE_AFTER = 60 * 1000; // Show cache age after 1 minute
      
      // Check cache first
      let cacheAge = null;
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          const age = Date.now() - timestamp;
          if (age < CACHE_DURATION) {
            console.log(`[Stats Debug] Using cached stats for ${org}, age: ${Math.floor(age/60000)} minutes`);
            // Apply cached data to UI
            displayOrgStats(org, data);
            
            // Show cache age if older than 1 minute
            if (age > SHOW_CACHE_AGE_AFTER) {
              cacheAge = Math.floor(age / 60000); // Convert to minutes
              showCacheAge(org, cacheAge);
            }
            
            return;
          } else {
            console.log(`[Stats Debug] Cache expired for ${org}, age: ${Math.floor(age/60000)} minutes`);
          }
        }
      } catch (e) {
        console.log("[Stats Debug] Error reading stats cache:", e);
      }
      
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysAgoISO = sevenDaysAgo.toISOString().split("T")[0];

      console.log(`[Stats Debug] Date range: ${sevenDaysAgoISO} to ${now.toISOString().split("T")[0]}`);

      const openAllQuery = `type:pr is:open org:${org}`;
      const mergedRecentQuery = `type:pr is:merged org:${org} merged:>=${sevenDaysAgoISO}`;

      console.log(`[Stats Debug] Queries:`, {
        openAll: openAllQuery,
        mergedRecent: mergedRecentQuery
      });

      // Track progress
      let openPRsFound = 0;
      let mergedPRsFound = 0;
      
      const updateLoadingText = () => {
        const loadingSubtext = document.getElementById('loadingSubtext');
        if (loadingSubtext) {
          const total = openPRsFound + mergedPRsFound;
          if (total > 0) {
            loadingSubtext.textContent = `Found ${total.toLocaleString()} PRs and counting... 🔍`;
          }
        }
      };

      const [openAllResponse, mergedRecentResponse] = await Promise.all([
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(openAllQuery)}&per_page=100`,
          20,
          githubAPI,
          (loaded, total) => {
            openPRsFound = loaded;
            updateLoadingText();
          }
        ),
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(mergedRecentQuery)}&per_page=100`,
          20,
          githubAPI,
          (loaded, total) => {
            mergedPRsFound = loaded;
            updateLoadingText();
          }
        ),
      ]);

      const openAllPRs = openAllResponse.items || [];
      const mergedRecentPRs = mergedRecentResponse.items || [];
      const openTotalCount = openAllResponse.total_count || openAllPRs.length;
      const mergedTotalCount = mergedRecentResponse.total_count || mergedRecentPRs.length;

      console.log(`[Stats Debug] API Responses:`, {
        openAllCount: openAllPRs.length,
        openTotalCount: openTotalCount,
        openSampled: openAllResponse.sampled,
        openSampleSize: openAllResponse.sampleSize,
        mergedRecentCount: mergedRecentPRs.length,
        mergedTotalCount: mergedTotalCount,
        mergedSampled: mergedRecentResponse.sampled,
        mergedSampleSize: mergedRecentResponse.sampleSize
      });

      const openStalePRs = openAllPRs.filter((pr) => {
        const updatedAt = new Date(pr.updated_at);
        return updatedAt < sevenDaysAgo;
      });

      console.log(`[Stats Debug] Stale PRs (updated before ${sevenDaysAgoISO}):`, openStalePRs.length);

      // Use actual total count for merged PRs when available
      const mergedLast10Days = mergedTotalCount || mergedRecentPRs.length;
      
      // Extrapolate open stale PRs if we're sampling
      let openMoreThan10Days = openStalePRs.length;
      if (openAllResponse.sampled && openAllPRs.length > 0) {
        // Calculate the proportion of stale PRs in our sample
        const staleProportion = openStalePRs.length / openAllPRs.length;
        // Extrapolate to the total
        openMoreThan10Days = Math.round(staleProportion * openTotalCount);
        console.log(`[Stats Debug] Extrapolating stale PRs: ${openStalePRs.length} of ${openAllPRs.length} sample = ${(staleProportion * 100).toFixed(1)}% -> estimated ${openMoreThan10Days} of ${openTotalCount} total`);
      }
      let totalMergeTime = 0;
      let mergedWithTimes = 0;

      mergedRecentPRs.forEach((pr, index) => {
        // For the first PR, log its full structure to understand the data
        if (index === 0) {
          console.log(`[Stats Debug] First merged PR structure:`, pr);
        }
        
        // GitHub search API returns PR data differently than the PR API
        // The merged_at field might be at the top level or in pull_request
        const mergedAt = pr.pull_request?.merged_at || pr.merged_at;
        
        console.log(`[Stats Debug] PR #${pr.number} merge info:`, {
          hasPullRequest: !!pr.pull_request,
          mergedAt: mergedAt,
          created_at: pr.created_at
        });
        
        if (mergedAt) {
          const createdAt = new Date(pr.created_at);
          const mergedAtDate = new Date(mergedAt);
          const mergeTime = mergedAtDate - createdAt;
          totalMergeTime += mergeTime;
          mergedWithTimes++;
        }
      });

      console.log(`[Stats Debug] Merge time calculations:`, {
        totalMergeTime,
        mergedWithTimes,
        avgMergeTime: mergedWithTimes > 0 ? totalMergeTime / mergedWithTimes : 0
      });

      let totalOpenAge = 0;
      openAllPRs.forEach((pr) => {
        const createdAt = new Date(pr.created_at);
        const age = now - createdAt;
        totalOpenAge += age;
      });

      // Use exact total count from GitHub
      const currentlyOpen = openTotalCount || openAllPRs.length;
      
      console.log(`[Stats Debug] Final calculations:`, {
        currentlyOpen,
        openMoreThan10Days,
        mergedLast10Days,
        avgOpenAge: currentlyOpen > 0 ? totalOpenAge / currentlyOpen / (24*60*60*1000) : 0,
        ratio: openMoreThan10Days > 0 ? mergedLast10Days / openMoreThan10Days : 'infinity'
      });
      
      // Calculate stats data
      const statsData = {
        currentlyOpen,
        openMoreThan10Days,
        mergedLast10Days,
        totalOpenAge,
        totalMergeTime,
        sevenDaysAgoISO,
        now: now.getTime(),
        openTotalCount,
        mergedTotalCount,
        dataSampled: openAllResponse.sampled || mergedRecentResponse.sampled,
        openSampleSize: openAllPRs.length,  // Actual sample size used for calculations
        mergedSampleSize: mergedRecentPRs.length  // Actual sample size used for calculations
      };
      
      console.log(`[Stats Debug] Stats data to cache/display:`, statsData);
      
      // Cache the results
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          data: statsData,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.log("[Stats Debug] Error caching stats:", e);
      }
      
      // Display the stats
      displayOrgStats(org, statsData);
    } catch (error) {
      console.error(`Error processing stats for ${org}:`, error);
      throw error;
    }
  };
  
  const displayOrgStats = (org, statsData) => {
    console.log(`[Stats Debug] displayOrgStats called with:`, { org, statsData });
    
    const {
      currentlyOpen,
      openMoreThan10Days,
      mergedLast10Days,
      totalOpenAge,
      totalMergeTime,
      sevenDaysAgoISO,
      now: nowTime,
      openTotalCount,
      mergedTotalCount,
      dataSampled,
      openSampleSize,
      mergedSampleSize
    } = statsData;
    
    console.log(`[Stats Debug] Extracted values:`, {
      currentlyOpen,
      openMoreThan10Days,
      mergedLast10Days,
      totalOpenAge,
      totalMergeTime,
      sevenDaysAgoISO,
      nowTime,
      openTotalCount,
      mergedTotalCount,
      dataSampled,
      openSampleSize,
      mergedSampleSize
    });
    
    const now = new Date(nowTime);
      const totalOpenElement = $(`totalOpen-${org}`);
      const avgOpenAgeElement = $(`avgOpenAge-${org}`);
      const mergedElement = $(`mergedPRs-${org}`);
      const openElement = $(`openPRs-${org}`);
      const avgElement = $(`avgMergeTime-${org}`);
      const ratioElement = $(`ratioDisplay-${org}`);

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

      if (avgOpenAgeElement) {
        avgOpenAgeElement.classList.remove("loading");
        const avgOpenAgeLink = $(`avgOpenAgeLink-${org}`);

        if (currentlyOpen > 0 && statsData.totalOpenAge > 0) {
          // When sampling, totalOpenAge is sum of sample ages, so divide by sample size
          const sampleSize = openSampleSize || currentlyOpen;
          const avgOpenAgeMs = totalOpenAge / Math.min(sampleSize, currentlyOpen);
          const avgOpenAgeMinutes = avgOpenAgeMs / (60 * 1000);
          const avgOpenAgeHours = avgOpenAgeMs / (60 * 60 * 1000);
          const avgOpenAgeDays = avgOpenAgeMs / (24 * 60 * 60 * 1000);

          let displayText;
          let warningColor = "#1a1a1a"; // Default color
          
          if (avgOpenAgeMinutes < 60) {
            displayText = `${Math.round(avgOpenAgeMinutes)}m`;
            warningColor = "#34C759"; // Green for < 1 hour
          } else if (avgOpenAgeHours < 24) {
            displayText = `${Math.round(avgOpenAgeHours)}h`;
            warningColor = "#34C759"; // Green for < 1 day
          } else {
            displayText = `${Math.round(avgOpenAgeDays)}d`;
            // Color coding for days: <10 green, 10-20 orange, >20 red
            if (avgOpenAgeDays < 10) {
              warningColor = "#34C759"; // Green
            } else if (avgOpenAgeDays <= 20) {
              warningColor = "#FF9500"; // Orange
            } else {
              warningColor = "#FF3B30"; // Red
            }
          }
          avgOpenAgeElement.textContent = displayText;
          avgOpenAgeElement.style.color = warningColor;

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

      if (mergedElement) {
        mergedElement.classList.remove("loading");
        // Show actual total if it's different from the sample size
        if (mergedTotalCount && mergedTotalCount > mergedLast10Days) {
          mergedElement.textContent = mergedTotalCount.toLocaleString();
        } else {
          mergedElement.textContent = mergedLast10Days;
        }

        const mergedLink = $(`mergedPRsLink-${org}`);
        if (mergedLink) {
          if (mergedLast10Days > 0) {
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${sevenDaysAgoISO}`;
            mergedLink.href = `https://github.com/search?q=${encodeURIComponent(mergedQuery)}&type=pullrequests`;
          } else {
            mergedLink.removeAttribute("href");
            mergedLink.style.cursor = "default";
          }
        }
      }

      if (openElement) {
        openElement.classList.remove("loading");
        openElement.textContent = openMoreThan10Days;

        const openLink = $(`openPRsLink-${org}`);
        if (openLink) {
          if (openMoreThan10Days > 0) {
            const openQuery = `type:pr is:open org:${org} updated:<${sevenDaysAgoISO}`;
            openLink.href = `https://github.com/search?q=${encodeURIComponent(openQuery)}&type=pullrequests`;
          } else {
            openLink.removeAttribute("href");
            openLink.style.cursor = "default";
          }
        }
      }

      if (avgElement) {
        avgElement.classList.remove("loading");
        const avgLink = $(`avgMergeTimeLink-${org}`);

        if (mergedLast10Days > 0 && totalMergeTime > 0) {
          // When sampling, totalMergeTime is sum of sample merge times, so divide by sample size
          const sampleSize = mergedSampleSize || mergedLast10Days;
          const avgMergeMs = totalMergeTime / Math.min(sampleSize, mergedLast10Days);
          const avgMergeMinutes = avgMergeMs / (60 * 1000);
          const avgMergeHours = avgMergeMs / (60 * 60 * 1000);
          const avgMergeDays = avgMergeMs / (24 * 60 * 60 * 1000);

          let displayText;
          let cycleColor = "#1a1a1a"; // Default color
          
          if (avgMergeMinutes < 60) {
            displayText = `${Math.round(avgMergeMinutes)}m`;
            cycleColor = "#34C759"; // Green for < 1 hour
          } else if (avgMergeHours < 24) {
            displayText = `${Math.round(avgMergeHours)}h`;
            cycleColor = "#34C759"; // Green for < 1 day
          } else {
            displayText = `${Math.round(avgMergeDays)}d`;
            // Color coding for days: <1 green, 1-3 orange, >3 red
            if (avgMergeDays < 1) {
              cycleColor = "#34C759"; // Green
            } else if (avgMergeDays <= 3) {
              cycleColor = "#FF9500"; // Orange
            } else {
              cycleColor = "#FF3B30"; // Red
            }
          }
          avgElement.textContent = displayText;
          avgElement.style.color = cycleColor;

          if (avgLink) {
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${sevenDaysAgoISO}`;
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

      if (ratioElement) {
        ratioElement.classList.remove("loading");
        let ratioText = "";
        let grade = "";
        let description = "";
        
        console.log(`[Stats Debug] Ratio calculation:`, {
          openMoreThan10Days,
          mergedLast10Days,
          willCalculateRatio: openMoreThan10Days > 0
        });
        
        if (openMoreThan10Days === 0 && mergedLast10Days > 0) {
          ratioText = "∞:1";
          grade = "Smooth";
          description = "Perfect - no bottlenecks, team is shipping at maximum efficiency";
        } else if (openMoreThan10Days === 0 && mergedLast10Days === 0) {
          ratioText = "-";
          grade = "";
          description = "No recent PR activity to measure";
        } else {
          const ratio = mergedLast10Days / openMoreThan10Days;
          console.log(`[Stats Debug] Calculated ratio: ${ratio}`);
          ratioText = `${ratio.toFixed(1)}:1`;
          
          if (ratio === 0) {
            grade = "Abandoned";
            description = "No code shipped in 10 days - completed work is being forgotten";
          } else if (ratio < 0.2) {
            grade = "Barely functional";
            description = "Extremely low velocity - almost all work is forgotten";
          } else if (ratio < 1) {
            grade = "Haphazard";
            description = "More PRs forgotten than shipped - wasting significant engineering effort";
          } else if (ratio < 2) {
            grade = "OK, but not healthy";
            description = "Some PRs likely forgotten - engineering effort being wasted";
          } else if (ratio < 3) {
            grade = "Nearly healthy";
            description = "Approaching good velocity - minor improvements needed";
          } else if (ratio < 4) {
            grade = "Healthy but not smooth";
            description = "Good throughput with room for optimization";
          } else {
            grade = "Smooth";
            description = "Excellent velocity - team is shipping efficiently";
          }
        }
        
        console.log(`[Stats Debug] Ratio display:`, { ratioText, grade, description });
        
        ratioElement.textContent = grade ? `${ratioText} (${grade})` : ratioText;
        
        // Update description
        const descriptionEl = $(`ratioDescription-${org}`);
        if (descriptionEl) {
          descriptionEl.textContent = description;
        }
      }

      drawOrgPieChart(org, mergedLast10Days, openMoreThan10Days);
      
      // Show data sampling note if applicable
      if (dataSampled) {
        const limitNote = $(`dataLimitNote-${org}`);
        if (limitNote) {
          let noteText = '*Statistics based on a representative sample';
          if (openSampleSize && mergedSampleSize) {
            noteText += ` (${openSampleSize} open PRs, ${mergedSampleSize} merged PRs)`;
          }
          
          // Check if we hit GitHub's 1000 result limit
          const hitGitHubLimit = openTotalCount > 1000 || mergedTotalCount > 1000;
          if (hitGitHubLimit) {
            noteText += ' due to GitHub API limits.';
          } else {
            noteText += ' for performance.';
          }
          
          // Update the innerHTML to show the sampling info
          const noteElement = document.getElementById(`dataLimitNote-${org}`);
          if (noteElement) {
            noteElement.textContent = noteText;
            noteElement.style.display = 'block';
          }
        }
      }
  };
  
  const showCacheAge = (org, ageInMinutes) => {
    const cacheAgeEl = $(`cache-age-${org}`);
    if (cacheAgeEl) {
      let cacheText = '';
      if (ageInMinutes < 60) {
        cacheText = `Cached ${ageInMinutes} minute${ageInMinutes !== 1 ? 's' : ''} ago`;
      } else {
        const hours = Math.floor(ageInMinutes / 60);
        const minutes = ageInMinutes % 60;
        if (minutes === 0) {
          cacheText = `Cached ${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else {
          cacheText = `Cached ${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        }
      }
      
      cacheAgeEl.innerHTML = `${cacheText} <button onclick="window.clearStatsCache('${org}')" style="background: none; border: none; color: #007AFF; cursor: pointer; font-size: 0.8125rem; padding: 0 0 0 0.5rem; text-decoration: underline;">[clear]</button>`;
      cacheAgeEl.style.display = 'block';
    }
  };

  const drawOrgPieChart = (org, merged, openOld) => {
    console.log(`[Stats Debug] drawOrgPieChart called with:`, { org, merged, openOld });
    
    const canvas = $(`prRatioChart-${org}`);
    if (!canvas) {
      console.log(`[Stats Debug] Canvas not found for org: ${org}`);
      return;
    }

    const ctx = canvas.getContext("2d");
    const total = merged + openOld;

    console.log(`[Stats Debug] Pie chart total: ${total}`);

    if (total === 0) {
      // Draw empty state circle
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(centerX, centerY) - 15;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = "#e5e5e7";
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = "#86868b";
      ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No data", centerX, centerY);
      return;
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 15;

    const mergedAngle = (merged / total) * 2 * Math.PI;
    const openAngle = (openOld / total) * 2 * Math.PI;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Enable antialiasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw merged slice (green)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + mergedAngle);
    ctx.closePath();
    ctx.fillStyle = "#34C759";
    ctx.fill();

    // Draw open old slice (orange)
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
    ctx.fillStyle = "#FF9500";
    ctx.fill();

    // Add subtle border
    ctx.strokeStyle = "#00000010";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Update legend
    const legendEl = $(`chartLegend-${org}`);
    if (legendEl) {
      const mergedPercent = Math.round((merged / total) * 100);
      const openPercent = Math.round((openOld / total) * 100);

      legendEl.innerHTML = `
        <div class="legend-item">
          <span class="legend-color" style="background-color: #10b981;"></span>
          <span>Healthy Flow (${merged} PRs)</span>
          <span class="legend-percent">${mergedPercent}%</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background-color: #f59e0b;"></span>
          <span>Bottlenecked (${openOld} PRs)</span>
          <span class="legend-percent">${openPercent}%</span>
        </div>
      `;
    }
  };

  const clearStatsCache = (org) => {
    const CACHE_KEY = `r2r_stats_${org}`;
    localStorage.removeItem(CACHE_KEY);
    console.log(`[Stats] Cleared cache for ${org}`);
    // Reload the page to fetch fresh data
    window.location.reload();
  };

  // Expose clearStatsCache globally for onclick handlers
  window.clearStatsCache = clearStatsCache;

  return {
    showStatsPage,
    loadStatsData,
    clearStatsCache,
  };
})();