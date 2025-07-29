// Authentication Module for Ready To Review
console.log('[Auth Module] Loading...');
export const Auth = (() => {
  "use strict";
  console.log('[Auth Module] Initializing...');

  // Configuration
  const CONFIG = {
    CLIENT_ID: "Iv23liYmAKkBpvhHAnQQ",
    API_BASE: "https://api.github.com",
    STORAGE_KEY: "github_token",
    COOKIE_KEY: "github_pat",
    OAUTH_REDIRECT_URI: window.location.origin + "/oauth/callback",
  };

  // Cookie Functions
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
  }

  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  const getStoredToken = () => {
    // Check cookie first (for PAT)
    const cookieToken = getCookie(CONFIG.COOKIE_KEY);
    if (cookieToken) return cookieToken;

    // Fall back to localStorage (for OAuth)
    return localStorage.getItem(CONFIG.STORAGE_KEY);
  };

  const storeToken = (token, useCookie = false) => {
    if (useCookie) {
      setCookie(CONFIG.COOKIE_KEY, token, 365); // 1 year
    } else {
      localStorage.setItem(CONFIG.STORAGE_KEY, token);
    }
  };

  const clearToken = () => {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    deleteCookie(CONFIG.COOKIE_KEY);
  };

  const initiateOAuthLogin = () => {
    console.log('[Auth.initiateOAuthLogin] Starting OAuth flow...');
    
    // Generate state and store in cookie for server validation
    const state = Math.random().toString(36).substr(2, 15);
    
    // Set cookie that the server expects
    document.cookie = `oauth_state=${state};path=/;max-age=900;SameSite=Lax`;
    console.log('[Auth.initiateOAuthLogin] State cookie set:', state);
    
    // Use the actual redirect URI that the server expects
    const redirectUri = window.location.origin + "/oauth/callback";
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20repo&state=${state}`;
    
    console.log('[Auth.initiateOAuthLogin] Opening popup window...');
    
    // Open OAuth flow in popup window as the server expects
    const popup = window.open(authUrl, "github-oauth", "width=600,height=700");
    
    // Listen for OAuth completion message from the popup
    const messageHandler = (event) => {
      console.log('[Auth.initiateOAuthLogin] Received message:', event);
      
      // Verify the message is from our domain
      if (event.origin !== window.location.origin) {
        console.log('[Auth.initiateOAuthLogin] Ignoring message from different origin:', event.origin);
        return;
      }
      
      // Handle the OAuth callback
      if (event.data && event.data.type === 'oauth-callback' && event.data.token) {
        console.log('[Auth.initiateOAuthLogin] Received OAuth token');
        
        // Store the token
        storeToken(event.data.token);
        
        // Close the popup if it's still open
        if (popup && !popup.closed) {
          popup.close();
        }
        
        // Remove the message listener
        window.removeEventListener('message', messageHandler);
        
        // Reload the page to reinitialize with the new token
        window.location.reload();
      }
    };
    
    // Add the message listener
    window.addEventListener('message', messageHandler);
    
    // Also handle if the popup is closed without completing auth
    const checkPopup = setInterval(() => {
      if (popup && popup.closed) {
        console.log('[Auth.initiateOAuthLogin] Popup was closed');
        clearInterval(checkPopup);
        window.removeEventListener('message', messageHandler);
      }
    }, 500);
  };

  const showGitHubAppModal = () => {
    console.log('[Auth.showGitHubAppModal] Called');
    const modal = document.getElementById("githubAppModal");
    console.log('[Auth.showGitHubAppModal] Modal element:', modal);
    if (modal) {
      console.log('[Auth.showGitHubAppModal] Modal hidden attribute:', modal.hasAttribute('hidden'));
      console.log('[Auth.showGitHubAppModal] Modal current display style:', window.getComputedStyle(modal).display);
      
      // Remove hidden attribute if present
      if (modal.hasAttribute('hidden')) {
        console.log('[Auth.showGitHubAppModal] Removing hidden attribute');
        modal.removeAttribute('hidden');
      }
      
      console.log('[Auth.showGitHubAppModal] Setting modal display to block');
      modal.style.display = "block";
      console.log('[Auth.showGitHubAppModal] Modal display style after:', modal.style.display);
      console.log('[Auth.showGitHubAppModal] Modal computed style after:', window.getComputedStyle(modal).display);
    } else {
      console.error('[Auth.showGitHubAppModal] Modal element not found!');
    }
  };

  const closeGitHubAppModal = () => {
    const modal = document.getElementById("githubAppModal");
    if (modal) modal.style.display = "none";
  };

  const proceedWithOAuth = () => {
    closeGitHubAppModal();
    initiateOAuthLogin();
  };

  const initiatePATLogin = () => {
    console.log('[Auth.initiatePATLogin] Called');
    const modal = document.getElementById("patModal");
    console.log('[Auth.initiatePATLogin] Modal element:', modal);
    if (modal) {
      console.log('[Auth.initiatePATLogin] Modal hidden attribute:', modal.hasAttribute('hidden'));
      console.log('[Auth.initiatePATLogin] Modal current display style:', window.getComputedStyle(modal).display);
      
      // Remove hidden attribute if present
      if (modal.hasAttribute('hidden')) {
        console.log('[Auth.initiatePATLogin] Removing hidden attribute');
        modal.removeAttribute('hidden');
      }
      
      console.log('[Auth.initiatePATLogin] Setting modal display to block');
      modal.style.display = "block";
      console.log('[Auth.initiatePATLogin] Modal display style after:', modal.style.display);
      console.log('[Auth.initiatePATLogin] Modal computed style after:', window.getComputedStyle(modal).display);
    } else {
      console.error('[Auth.initiatePATLogin] Modal element not found!');
    }
  };

  const closePATModal = () => {
    const modal = document.getElementById("patModal");
    if (modal) modal.style.display = "none";
    const input = document.getElementById("patInput");
    if (input) input.value = "";
  };

  const submitPAT = async () => {
    const input = document.getElementById("patInput");
    const errorDiv = document.getElementById("patError");

    if (!input || !input.value.trim()) {
      if (errorDiv) {
        errorDiv.textContent = "Please enter a Personal Access Token";
        errorDiv.style.display = "block";
      }
      return;
    }

    const token = input.value.trim();

    try {
      // Validate the token by making a test API call
      const response = await fetch(`${CONFIG.API_BASE}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        storeToken(token, true); // Store in cookie
        closePATModal();
        window.location.reload();
      } else {
        if (errorDiv) {
          errorDiv.textContent = "Invalid token. Please check and try again.";
          errorDiv.style.display = "block";
        }
      }
    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = "Error validating token. Please try again.";
        errorDiv.style.display = "block";
      }
    }
  };

  const handleOAuthCallback = async () => {
    // The server handles the OAuth callback and token exchange
    // This function is kept for backward compatibility
    console.log('[Auth.handleOAuthCallback] Called - server should have handled the OAuth flow');
  };

  const handleAuthError = () => {
    clearToken();
    const currentUrl = window.location.pathname + window.location.search;
    window.location.href = `/?redirect=${encodeURIComponent(currentUrl)}`;
  };

  const logout = () => {
    clearToken();
    window.location.href = "/";
  };

  // API function with auth headers
  const githubAPI = async (endpoint, options = {}, retries = 5) => {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      ...options.headers,
    };

    const token = getStoredToken();
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
          ...options,
          headers,
        });

        // Handle auth errors
        if (!response.ok && response.status === 401) {
          handleAuthError();
        }

        // Log error responses
        if (!response.ok) {
          console.warn(`GitHub REST API request failed: ${response.status} ${response.statusText}`);
          console.warn(`Endpoint: ${endpoint}`);
          console.warn('Response headers:', Object.fromEntries(response.headers.entries()));
          
          // Try to read response body if available (may fail due to CORS)
          if (response.status >= 500) {
            try {
              const responseClone = response.clone();
              const responseText = await responseClone.text();
              console.warn('Response body:', responseText);
            } catch (e) {
              console.warn('Could not read response body due to CORS restrictions');
            }
          }

          // Retry on all 500+ server errors
          if (response.status >= 500 && attempt < retries) {
            const delay = Math.min(250 * Math.pow(2, attempt), 10000); // Exponential backoff starting at 250ms, max 10s
            console.warn(`[githubAPI] Retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}${endpoint} - Status: ${response.status}, Delay: ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        return response;
      } catch (error) {
        lastError = error;
        console.error('GitHub REST API network error:', error);
        
        // If it's a network error and we have retries left, try again
        if (attempt < retries) {
          const delay = Math.min(250 * Math.pow(2, attempt), 10000);
          console.warn(`[githubAPI] Network error retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}${endpoint} - Error: ${error.message}, Delay: ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    console.error('GitHub REST API request failed after all retries:', lastError);
    throw lastError;
  };

  // GraphQL API function with retry logic
  const githubGraphQL = async (query, variables = {}, retries = 5) => {
    const token = getStoredToken();
    if (!token) {
      throw new Error("No authentication token available");
    }

    // Determine token type and use appropriate header format
    let authHeader;
    if (token.startsWith('ghp_') || token.startsWith('github_pat_')) {
      // Personal Access Token (new format)
      authHeader = `Bearer ${token}`;
    } else if (token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghs_')) {
      // OAuth token or other GitHub token types
      authHeader = `Bearer ${token}`;
    } else if (token.length === 40) {
      // Classic OAuth token (40 chars hex)
      authHeader = `Bearer ${token}`;
    } else {
      // Default to Bearer
      authHeader = `Bearer ${token}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${CONFIG.API_BASE}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify({ query, variables })
        });

        if (!response.ok) {
          if (response.status === 401) {
            handleAuthError();
          }
          
          // Retry on all 500+ server errors
          if (response.status >= 500 && attempt < retries) {
            const delay = Math.min(250 * Math.pow(2, attempt), 10000); // Exponential backoff starting at 250ms, max 10s
            
            // Log all available response information
            console.warn(`[githubGraphQL] Retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}/graphql - Status: ${response.status} ${response.statusText}, Delay: ${delay}ms`);
            console.warn('Response headers:', Object.fromEntries(response.headers.entries()));
            
            // Try to read response body if available (may fail due to CORS)
            try {
              const responseText = await response.text();
              console.warn('Response body:', responseText);
            } catch (e) {
              console.warn('Could not read response body due to CORS restrictions');
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // For other errors, log and throw
          console.error(`GraphQL request failed: ${response.status} ${response.statusText}`);
          console.error('Request details:', { query, variables, authHeader: authHeader.substring(0, 20) + '...' });
          throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.errors) {
          console.error('GraphQL errors:', data.errors);
          throw new Error('GraphQL query failed: ' + data.errors[0]?.message);
        }

        return data.data;
      } catch (error) {
        lastError = error;
        
        // If it's a network error and we have retries left, try again
        if (error.name === 'TypeError' && error.message.includes('fetch') && attempt < retries) {
          const delay = Math.min(250 * Math.pow(2, attempt), 10000);
          console.warn(`[githubGraphQL] Network error retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}/graphql - Error: ${error.message}, Delay: ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // For non-retryable errors, throw immediately
        throw error;
      }
    }
    
    console.error('GraphQL request failed after all retries:', lastError);
    throw lastError;
  };

  const loadCurrentUser = async () => {
    const response = await githubAPI("/user");
    if (response.ok) {
      return await response.json();
    }
    throw new Error("Failed to load user");
  };

  console.log('[Auth Module] Exporting functions...');
  const authExports = {
    getStoredToken,
    storeToken,
    clearToken,
    initiateOAuthLogin,
    showGitHubAppModal,
    closeGitHubAppModal,
    proceedWithOAuth,
    initiatePATLogin,
    closePATModal,
    submitPAT,
    handleOAuthCallback,
    handleAuthError,
    logout,
    githubAPI,
    githubGraphQL,
    loadCurrentUser,
    CONFIG,
  };
  console.log('[Auth Module] Exports:', authExports);
  return authExports;
})();
console.log('[Auth Module] Module loaded, Auth object:', Auth);