// Stats Module for Ready To Review
import { $, show, hide, escapeHtml } from './utils.js';

export const Stats = (() => {
  "use strict";

  // DOM Helpers and utilities are imported from utils.js

  const githubSearchAll = async (searchPath, maxPages = 20, githubAPI) => {
    console.log(`[Stats Debug] githubSearchAll called with path: ${searchPath}`);
    const allItems = [];
    let page = 1;
    let hasMore = true;
    let actualTotalCount = 0;

    // Use per_page=100 for efficiency
    const separator = searchPath.includes("?") ? "&" : "?";
    const baseSearchPath = `${searchPath}${separator}per_page=100`;

    while (hasMore && page <= maxPages && allItems.length < 1000) {
      const pagePath = `${baseSearchPath}&page=${page}`;

      console.log(`[Stats Debug] Fetching page ${page}: ${pagePath}`);
      const response = await githubAPI(pagePath);
      console.log(`[Stats Debug] Page ${page} response:`, {
        hasItems: !!response.items,
        itemCount: response.items?.length || 0,
        totalCount: response.total_count
      });

      // Store the actual total count from GitHub
      if (page === 1) {
        actualTotalCount = response.total_count || 0;
      }

      if (response.items && response.items.length > 0) {
        allItems.push(...response.items);

        // GitHub search API won't return more than 1000 results total
        // If we've hit 1000 items or gotten fewer than 100 items, we're done
        if (
          allItems.length >= 1000 ||
          response.items.length < 100 ||
          allItems.length >= actualTotalCount
        ) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`[Stats Debug] githubSearchAll complete:`, {
      totalItems: allItems.length,
      actualTotalCount: actualTotalCount,
      pages: page,
      hitLimit: allItems.length >= 1000 || actualTotalCount > 1000
    });

    return {
      items: allItems.slice(0, 1000),  // Ensure we never return more than 1000
      total_count: actualTotalCount,  // Return the actual total from GitHub
      limited: actualTotalCount > 1000
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
        container.innerHTML =
          '<div class="loading-indicator">Loading organizations...</div>';

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

      container.innerHTML =
        '<div class="loading-indicator">Loading statistics...</div>';

      container.innerHTML = "";
      const orgSection = createOrgSection(org);
      container.appendChild(orgSection);

      await processOrgStats(org, username, githubAPI);
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
          <div style="font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em; color: #86868b; margin-bottom: 1rem;">Velocity Score</div>
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
              <div style="font-size: 0.9375rem; color: #515154;">PRs stuck >7 days</div>
            </div>
          </a>
          
          <!-- Average Wait Time -->
          <a href="#" id="avgOpenAgeLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Wait Time</div>
              <div class="stat-value loading" id="avgOpenAge-${org}" style="font-size: 3rem; font-weight: 300; color: #1a1a1a; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">Average PR age</div>
            </div>
          </a>
          
          <!-- Cycle Time -->
          <a href="#" id="avgMergeTimeLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Cycle Time</div>
              <div class="stat-value loading" id="avgMergeTime-${org}" style="font-size: 3rem; font-weight: 300; color: #1a1a1a; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">To ship</div>
            </div>
          </a>
          
          <!-- Shipped -->
          <a href="#" id="mergedPRsLink-${org}" target="_blank" rel="noopener" style="text-decoration: none;">
            <div style="background: #ffffff; border-radius: 16px; padding: 2rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.2s; cursor: pointer; border: 2px solid transparent;"
                 onmouseover="this.style.borderColor='#007AFF'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 20px rgba(0,122,255,0.15)';" 
                 onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';">
              <div style="font-size: 0.8125rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Shipped</div>
              <div class="stat-value loading" id="mergedPRs-${org}" style="font-size: 3rem; font-weight: 300; color: #34C759; margin: 0.25rem 0;">-</div>
              <div style="font-size: 0.9375rem; color: #515154;">Last 7 days</div>
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
            *Time averages are based on the most recent 1,000 PRs due to GitHub API limits.
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

      const [openAllResponse, mergedRecentResponse] = await Promise.all([
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(openAllQuery)}&per_page=100`,
          20,
          githubAPI
        ),
        githubSearchAll(
          `/search/issues?q=${encodeURIComponent(mergedRecentQuery)}&per_page=100`,
          20,
          githubAPI
        ),
      ]);

      const openAllPRs = openAllResponse.items || [];
      const mergedRecentPRs = mergedRecentResponse.items || [];
      const openTotalCount = openAllResponse.total_count || openAllPRs.length;
      const mergedTotalCount = mergedRecentResponse.total_count || mergedRecentPRs.length;

      console.log(`[Stats Debug] API Responses:`, {
        openAllCount: openAllPRs.length,
        openTotalCount: openTotalCount,
        openLimited: openAllResponse.limited,
        mergedRecentCount: mergedRecentPRs.length,
        mergedTotalCount: mergedTotalCount,
        mergedLimited: mergedRecentResponse.limited
      });

      const openStalePRs = openAllPRs.filter((pr) => {
        const updatedAt = new Date(pr.updated_at);
        return updatedAt < sevenDaysAgo;
      });

      console.log(`[Stats Debug] Stale PRs (updated before ${sevenDaysAgoISO}):`, openStalePRs.length);

      const mergedLast7Days = mergedRecentPRs.length;
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

      const currentlyOpen = openAllPRs.length;
      const openMoreThan7Days = openStalePRs.length;
      
      console.log(`[Stats Debug] Final calculations:`, {
        currentlyOpen,
        openMoreThan7Days,
        mergedLast7Days,
        avgOpenAge: currentlyOpen > 0 ? totalOpenAge / currentlyOpen / (24*60*60*1000) : 0,
        ratio: openMoreThan7Days > 0 ? mergedLast7Days / openMoreThan7Days : 'infinity'
      });
      
      // Calculate stats data
      const statsData = {
        currentlyOpen,
        openMoreThan7Days,
        mergedLast7Days,
        totalOpenAge,
        totalMergeTime,
        sevenDaysAgoISO,
        now: now.getTime(),
        openTotalCount,
        mergedTotalCount,
        dataLimited: openAllResponse.limited || mergedRecentResponse.limited
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
      openMoreThan7Days,
      mergedLast7Days,
      totalOpenAge,
      totalMergeTime,
      sevenDaysAgoISO,
      now: nowTime,
      openTotalCount,
      mergedTotalCount,
      dataLimited
    } = statsData;
    
    console.log(`[Stats Debug] Extracted values:`, {
      currentlyOpen,
      openMoreThan7Days,
      mergedLast7Days,
      totalOpenAge,
      totalMergeTime,
      sevenDaysAgoISO,
      nowTime,
      openTotalCount,
      mergedTotalCount,
      dataLimited
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

        if (currentlyOpen > 0) {
          const avgOpenAgeMs = totalOpenAge / currentlyOpen;
          const avgOpenAgeMinutes = avgOpenAgeMs / (60 * 1000);
          const avgOpenAgeHours = avgOpenAgeMs / (60 * 60 * 1000);
          const avgOpenAgeDays = avgOpenAgeMs / (24 * 60 * 60 * 1000);

          let displayText;
          let warningColor = "#1a1a1a"; // Default color
          
          if (avgOpenAgeMinutes < 60) {
            displayText = `${Math.round(avgOpenAgeMinutes)}m`;
          } else if (avgOpenAgeHours < 24) {
            displayText = `${Math.round(avgOpenAgeHours)}h`;
          } else {
            displayText = `${Math.round(avgOpenAgeDays)}d`;
            // Color coding for days
            if (avgOpenAgeDays > 30) {
              warningColor = "#FF3B30"; // Red for >30 days
            } else if (avgOpenAgeDays > 14) {
              warningColor = "#FF9500"; // Orange for >14 days
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
        if (mergedTotalCount && mergedTotalCount > mergedLast7Days) {
          mergedElement.textContent = mergedTotalCount.toLocaleString();
        } else {
          mergedElement.textContent = mergedLast7Days;
        }

        const mergedLink = $(`mergedPRsLink-${org}`);
        if (mergedLink) {
          if (mergedLast7Days > 0) {
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
        openElement.textContent = openMoreThan7Days;

        const openLink = $(`openPRsLink-${org}`);
        if (openLink) {
          if (openMoreThan7Days > 0) {
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

        if (mergedLast7Days > 0) {
          const avgMergeMs = totalMergeTime / mergedLast7Days;
          const avgMergeMinutes = avgMergeMs / (60 * 1000);
          const avgMergeHours = avgMergeMs / (60 * 60 * 1000);
          const avgMergeDays = avgMergeMs / (24 * 60 * 60 * 1000);

          let displayText;
          if (avgMergeMinutes < 60) {
            displayText = `${Math.round(avgMergeMinutes)}m`;
          } else if (avgMergeHours <= 120) {
            displayText = `${Math.round(avgMergeHours)}h`;
          } else {
            displayText = `${Math.round(avgMergeDays)}d`;
          }
          avgElement.textContent = displayText;

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
          openMoreThan7Days,
          mergedLast7Days,
          willCalculateRatio: openMoreThan7Days > 0
        });
        
        if (openMoreThan7Days === 0 && mergedLast7Days > 0) {
          ratioText = "∞:1";
          grade = "Smooth";
          description = "Perfect - no bottlenecks, team is shipping at maximum efficiency";
        } else if (openMoreThan7Days === 0 && mergedLast7Days === 0) {
          ratioText = "-";
          grade = "";
          description = "No recent PR activity to measure";
        } else {
          const ratio = mergedLast7Days / openMoreThan7Days;
          console.log(`[Stats Debug] Calculated ratio: ${ratio}`);
          ratioText = `${ratio.toFixed(1)}:1`;
          
          if (ratio === 0) {
            grade = "Abandoned";
            description = "No code shipped in 7 days - completed work is being forgotten";
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

      drawOrgPieChart(org, mergedLast7Days, openMoreThan7Days);
      
      // Show data limit note if applicable
      if (dataLimited) {
        const limitNote = $(`dataLimitNote-${org}`);
        if (limitNote) {
          limitNote.style.display = 'block';
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