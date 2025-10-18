import { Stats } from "./stats.js";
// Leaderboard Module - Shows PR merge activity by contributor
import { $, $$, hide, show, showToast } from "./utils.js";

export const Leaderboard = (() => {
  const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000;
  const CACHE_KEY_PREFIX = "leaderboard_cache_";
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
      console.error("Error reading cache:", e);
      return null;
    }
  };

  const setCachedData = (key, data) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          data,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.error("Error setting cache:", e);
    }
  };

  const showLeaderboardPage = async (
    state,
    githubAPI,
    loadCurrentUser,
    updateUserDisplay,
    setupHamburgerMenu,
    updateOrgFilter,
    handleOrgChange,
    handleSearch,
    parseURL,
    loadUserOrganizations
  ) => {
    // Hide other content
    $$('[id$="Content"], #prSections').forEach((el) => {
      el?.setAttribute("hidden", "");
    });

    // Check for authentication first
    if (!state.accessToken) {
      const loginPrompt = $("loginPrompt");
      show(loginPrompt);
      hide($("leaderboardContent"));
      return;
    }

    const leaderboardContent = $("leaderboardContent");
    if (!leaderboardContent) {
      console.error("Leaderboard content element not found");
      return;
    }

    hide($("loginPrompt"));
    show(leaderboardContent);

    // Load current user if needed
    if (!state.currentUser) {
      try {
        await loadCurrentUser();
      } catch (error) {
        console.error("Failed to load current user:", error);
        showToast("Please login to view leaderboard", "error");
        window.location.href = "/";
        return;
      }
    }

    updateUserDisplay(state, () => undefined);
    setupHamburgerMenu();

    // Update search input placeholder
    const searchInput = $("searchInput");
    if (searchInput) {
      searchInput.placeholder = "Search users...";
      searchInput.value = "";
    }

    // Setup handlers
    const orgSelect = $("orgSelect");
    if (orgSelect) {
      orgSelect.removeEventListener("change", handleOrgChange);
      orgSelect.addEventListener("change", handleOrgChange);
    }

    // Load user organizations for dropdown
    await loadUserOrganizations(state, githubAPI, parseURL);

    // Update org filter
    await updateOrgFilter(state, parseURL, githubAPI);

    // Disable org selector if no org specified
    const urlContext = parseURL();
    let org = urlContext?.org;
    let isPersonalPage = false;

    if (!org) {
      // No org specified - show user's personal contributions
      // Use the current username as the "org" for personal stats
      const personalUsername = urlContext?.username || state.currentUser?.login;
      if (!personalUsername) {
        const loadingDiv = $("leaderboardLoading");
        const contentDiv = $("leaderboardData");
        hide(loadingDiv);
        show(contentDiv);
        contentDiv.innerHTML = '<div class="empty-state">Unable to determine user</div>';
        return;
      }

      // Continue with personal username - will fetch author:username PRs
      org = personalUsername;
      isPersonalPage = true;
    }

    // Show loading state
    const loadingDiv = $("leaderboardLoading");
    const contentDiv = $("leaderboardData");
    show(loadingDiv);
    hide(contentDiv);

    try {
      // Check cache first
      const cacheKey = `${CACHE_KEY_PREFIX}${org}`;
      const cached = getCachedData(cacheKey);

      let mergedPRs;
      if (cached) {
        console.log("Using cached data for leaderboard");
        mergedPRs = cached.data;
        console.log("Cached leaderboard data:", {
          totalPRs: mergedPRs.length,
          cacheAge: `${Math.round(cached.age / 60000)} minutes`,
          dateRange: {
            from: new Date(Date.now() - TEN_DAYS_IN_MS).toISOString().split("T")[0],
            to: new Date().toISOString().split("T")[0],
          },
          samplePRs: mergedPRs.slice(0, 3).map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login || "unknown",
            repo: pr.repository_url?.replace("https://api.github.com/repos/", "") || "unknown",
          })),
        });
      } else {
        console.log("Fetching fresh data for leaderboard");
        // Fetch merged PRs from last 10 days
        const tenDaysAgo = new Date(Date.now() - TEN_DAYS_IN_MS);
        // Use user:username for personal pages (PRs in user's repos), org:orgname for organizations
        const scopeFilter = isPersonalPage ? `user:${org}` : `org:${org}`;
        const mergedQuery = `type:pr is:merged ${scopeFilter} merged:>=${tenDaysAgo.toISOString().split("T")[0]}`;

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

      // Filter out bots and count PRs by author and repo
      const authorCounts = {};
      const repoCounts = {};

      mergedPRs.forEach((pr) => {
        const author = pr.user.login;

        // Count repos
        const repoName = pr.repository_url.split("/").slice(-2).join("/");
        if (!repoCounts[repoName]) {
          repoCounts[repoName] = {
            name: repoName,
            count: 0,
            url: pr.repository_url.replace("api.github.com/repos", "github.com"),
          };
        }
        repoCounts[repoName].count++;

        // Skip bots for author counting
        const authorLower = author.toLowerCase();
        if (
          pr.user.type === "Bot" ||
          authorLower.endsWith("[bot]") ||
          authorLower.endsWith("-bot") ||
          authorLower.endsWith("-robot") ||
          authorLower.includes("dependabot")
        ) {
          return;
        }

        if (!authorCounts[author]) {
          authorCounts[author] = {
            login: author,
            avatar_url: pr.user.avatar_url,
            html_url: pr.user.html_url,
            count: 0,
          };
        }
        authorCounts[author].count++;
      });

      // Convert to array and sort by count
      const allContributors = Object.values(authorCounts);
      const totalContributors = allContributors.length;

      const topContributors = allContributors.sort((a, b) => b.count - a.count).slice(0, 10); // Top 10 contributors

      const topRepos = Object.values(repoCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Top 10 repos

      // Calculate max for scaling
      const maxContributorCount = topContributors[0]?.count || 0;
      const maxRepoCount = topRepos[0]?.count || 0;

      // Render leaderboard
      hide(loadingDiv);
      show(contentDiv);

      if (topContributors.length === 0) {
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
            <h1 class="leaderboard-title">Activity Dashboard</h1>
            <p class="leaderboard-period">Last 10 days in ${org}</p>
          </div>
          <div class="leaderboard-stats-summary">
            <div class="summary-stat">
              <div class="summary-value">${mergedPRs.length}</div>
              <div class="summary-label">Pull Requests</div>
            </div>
            <div class="summary-stat">
              <div class="summary-value">${totalContributors}</div>
              <div class="summary-label">Contributors</div>
            </div>
          </div>
          <div class="leaderboard-grid">
            <!-- Top Contributors -->
            <div class="leaderboard-chart">
              <h3 class="chart-title">Top Contributors</h3>
              <div class="chart-content">
                ${topContributors
                  .slice(0, 5)
                  .map((author, _index) => {
                    const percentage = (author.count / maxContributorCount) * 100;
                    return `
                    <div class="chart-item">
                      <div class="chart-item-header">
                        <img src="${author.avatar_url}" alt="${author.login}" class="chart-avatar">
                        <a href="${author.html_url}" target="_blank" rel="noopener" class="chart-item-name">${author.login}</a>
                        <span class="chart-item-count">${author.count}</span>
                      </div>
                      <div class="chart-bar">
                        <div class="chart-bar-fill" style="width: ${percentage}%"></div>
                      </div>
                    </div>
                  `;
                  })
                  .join("")}
              </div>
            </div>
            
            <!-- Top Repos -->
            <div class="leaderboard-chart">
              <h3 class="chart-title">Top Repositories</h3>
              <div class="chart-content">
                ${topRepos
                  .slice(0, 5)
                  .map((repo, _index) => {
                    const percentage = (repo.count / maxRepoCount) * 100;
                    const shortName = repo.name.split("/")[1] || repo.name;
                    return `
                    <div class="chart-item">
                      <div class="chart-item-header">
                        <a href="${repo.url}" target="_blank" rel="noopener" class="chart-item-name chart-repo-name" title="${repo.name}">${shortName}</a>
                        <span class="chart-item-count">${repo.count}</span>
                      </div>
                      <div class="chart-bar">
                        <div class="chart-bar-fill" style="width: ${percentage}%"></div>
                      </div>
                    </div>
                  `;
                  })
                  .join("")}
              </div>
            </div>
            
            <!-- Top Reviewers by PR Count -->
            <div class="leaderboard-chart">
              <h3 class="chart-title">Top Reviewers <span class="chart-subtitle">by PR count</span></h3>
              <div class="chart-content chart-tbd">
                <div class="tbd-placeholder">
                  <span class="tbd-icon">📊</span>
                  <span class="tbd-text">Coming Soon</span>
                </div>
              </div>
            </div>
            
            <!-- Top Reviewers by Comment Count -->
            <div class="leaderboard-chart">
              <h3 class="chart-title">Top Reviewers <span class="chart-subtitle">by comments</span></h3>
              <div class="chart-content chart-tbd">
                <div class="tbd-placeholder">
                  <span class="tbd-icon">💬</span>
                  <span class="tbd-text">Coming Soon</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Setup search functionality
      if (searchInput) {
        const handleLeaderboardSearch = () => {
          const searchTerm = searchInput.value.toLowerCase();
          const chartItems = $$(".chart-item");

          chartItems.forEach((item) => {
            const name = item.querySelector(".chart-item-name")?.textContent.toLowerCase() || "";
            if (searchTerm === "" || name.includes(searchTerm)) {
              show(item);
            } else {
              hide(item);
            }
          });
        };

        searchInput.removeEventListener("input", handleSearch);
        searchInput.addEventListener("input", handleLeaderboardSearch);
      }
    } catch (error) {
      console.error("Error loading leaderboard:", error);
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
    showLeaderboardPage,
  };
})();
