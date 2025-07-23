// Stats Module for Ready To Review
import { $, show, hide, escapeHtml } from './utils.js';

export const Stats = (() => {
  "use strict";

  // DOM Helpers and utilities are imported from utils.js

  const githubSearchAll = async (searchPath, maxPages = 20, githubAPI) => {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const pagePath = searchPath.includes("?")
        ? `${searchPath}&page=${page}`
        : `${searchPath}?page=${page}`;

      const response = await githubAPI(pagePath);

      if (response.items && response.items.length > 0) {
        allItems.push(...response.items);

        if (
          response.total_count <= allItems.length ||
          response.items.length < 100
        ) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return {
      items: allItems,
      total_count: allItems.length,
    };
  };

  const showStatsPage = async (state, githubAPI, loadCurrentUser, updateUserDisplay, setupHamburgerMenu, loadPullRequests, updateOrgFilter, handleOrgChange, handleSearch, parseURL, loadUserOrganizations) => {
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

    if (
      state.pullRequests.incoming.length === 0 &&
      state.pullRequests.outgoing.length === 0
    ) {
      await loadPullRequests();
    }

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

    hide($("loginPrompt"));
    hide($("prSections"));
    hide($("emptyState"));
    show($("statsPage"));

    await loadStatsData(state, githubAPI, parseURL, loadUserOrganizations);
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
            <p class="org-selector-subtitle">Choose from your organizations</p>
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
      <div class="org-header">
        <h2 class="org-name">${escapeHtml(org)}</h2>
      </div>
      <div class="stats-container">
        <!-- PR Ratio Chart -->
        <div class="stat-card">
          <h3 class="stat-card-title">PR Review Ratio (10 day merged vs 10 day open)</h3>
          <p class="stat-card-subtitle">Healthy orgs have a 3:1 or higher ratio of PRs merged within the last 10 days compared to PRs stuck open for over 10 days</p>
          <div class="ratio-display loading" id="ratioDisplay-${org}">Loading...</div>
          <div class="chart-container">
            <canvas id="prRatioChart-${org}" width="300" height="300"></canvas>
          </div>
          <div class="chart-legend" id="chartLegend-${org}"></div>
        </div>

        <!-- Stats Summary -->
        <div class="stat-card">
          <h3 class="stat-card-title">Summary</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <a href="#" class="stat-link" id="totalOpenLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="totalOpen-${org}">-</div>
                <div class="stat-label">Total Open PRs</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="avgOpenAgeLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="avgOpenAge-${org}">-</div>
                <div class="stat-label">Avg Open PR Age</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="mergedPRsLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="mergedPRs-${org}">-</div>
                <div class="stat-label">Merged (10 days)</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="openPRsLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="openPRs-${org}">-</div>
                <div class="stat-label">Open >10 days</div>
              </a>
            </div>
            <div class="stat-item">
              <a href="#" class="stat-link" id="avgMergeTimeLink-${org}" target="_blank" rel="noopener">
                <div class="stat-value loading" id="avgMergeTime-${org}">-</div>
                <div class="stat-label">Avg Push→Merge Delay</div>
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    return section;
  };

  const processOrgStats = async (org, username, githubAPI) => {
    try {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const tenDaysAgoISO = tenDaysAgo.toISOString().split("T")[0];

      const openAllQuery = `type:pr is:open org:${org}`;
      const mergedRecentQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;

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

      const openStalePRs = openAllPRs.filter((pr) => {
        const updatedAt = new Date(pr.updated_at);
        return updatedAt < tenDaysAgo;
      });

      const mergedLast10Days = mergedRecentPRs.length;
      let totalMergeTime = 0;

      mergedRecentPRs.forEach((pr) => {
        if (pr.pull_request?.merged_at) {
          const createdAt = new Date(pr.created_at);
          const mergedAt = new Date(pr.pull_request.merged_at);
          const mergeTime = mergedAt - createdAt;
          totalMergeTime += mergeTime;
        }
      });

      let totalOpenAge = 0;
      openAllPRs.forEach((pr) => {
        const createdAt = new Date(pr.created_at);
        const age = now - createdAt;
        totalOpenAge += age;
      });

      const currentlyOpen = openAllPRs.length;
      const openMoreThan10Days = openStalePRs.length;

      // Update stats display
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
          if (avgOpenAgeMinutes < 60) {
            displayText = `${Math.round(avgOpenAgeMinutes)}m`;
          } else if (avgOpenAgeHours < 24) {
            displayText = `${Math.round(avgOpenAgeHours)}h`;
          } else {
            displayText = `${Math.round(avgOpenAgeDays)}d`;
          }
          avgOpenAgeElement.textContent = displayText;

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
        mergedElement.textContent = mergedLast10Days;

        const mergedLink = $(`mergedPRsLink-${org}`);
        if (mergedLink) {
          if (mergedLast10Days > 0) {
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;
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
            const openQuery = `type:pr is:open org:${org} updated:<${tenDaysAgoISO}`;
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

        if (mergedLast10Days > 0) {
          const avgMergeMs = totalMergeTime / mergedLast10Days;
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
            const mergedQuery = `type:pr is:merged org:${org} merged:>=${tenDaysAgoISO}`;
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
        if (openMoreThan10Days === 0 && mergedLast10Days > 0) {
          ratioElement.textContent = "∞:1";
        } else if (openMoreThan10Days === 0 && mergedLast10Days === 0) {
          ratioElement.textContent = "-";
        } else {
          const ratio = (mergedLast10Days / openMoreThan10Days).toFixed(1);
          ratioElement.textContent = `${ratio}:1`;
        }
      }

      drawOrgPieChart(org, mergedLast10Days, openMoreThan10Days);
    } catch (error) {
      console.error(`Error processing stats for ${org}:`, error);

      const elements = [
        "totalOpen",
        "avgOpenAge",
        "mergedPRs",
        "openPRs",
        "avgMergeTime",
        "ratioDisplay",
      ].map((id) => $(`${id}-${org}`));
      elements.forEach((el) => {
        if (el) {
          el.classList.remove("loading");
          el.textContent = error.isRateLimit ? "Rate Limited" : "Error";
        }
      });

      const canvas = $(`prRatioChart-${org}`);
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ef4444";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          error.isRateLimit ? "Rate limit exceeded" : "Error loading data",
          canvas.width / 2,
          canvas.height / 2,
        );
      }
    }
  };

  const drawOrgPieChart = (org, merged, openOld) => {
    const canvas = $(`prRatioChart-${org}`);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const total = merged + openOld;

    if (total === 0) {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#475569";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No PR data available", canvas.width / 2, canvas.height / 2);
      return;
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 20;

    const mergedAngle = (merged / total) * 2 * Math.PI;
    const openAngle = (openOld / total) * 2 * Math.PI;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw merged slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + mergedAngle);
    ctx.closePath();
    ctx.fillStyle = "#10b981";
    ctx.fill();

    // Draw open old slice
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
    ctx.fillStyle = "#f59e0b";
    ctx.fill();

    // Add border
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
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
          <span>Merged (${merged})</span>
          <span class="legend-percent">${mergedPercent}%</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background-color: #f59e0b;"></span>
          <span>Open >10d (${openOld})</span>
          <span class="legend-percent">${openPercent}%</span>
        </div>
      `;
    }
  };

  return {
    showStatsPage,
    loadStatsData,
  };
})();