// Package main implements a secure OAuth2 server for the GitHub PR dashboard.
// It serves static files and handles GitHub OAuth authentication flow.
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/r2r/dashboard/secrets"
)

// Constants for configuration.
const (
	defaultPort        = "8080"
	defaultAppID       = 1546081
	defaultClientID    = "Iv23liYmAKkBpvhHAnQQ"
	defaultRedirectURI = "https://dash.ready-to-review.dev/oauth/callback"

	// Rate limiting.
	rateLimitRequests = 10
	rateLimitWindow   = 1 * time.Minute

	// Timeouts.
	httpTimeout     = 10 * time.Second
	shutdownTimeout = 30 * time.Second
	stateExpiry     = 15 * time.Minute

	// Security.
	maxRequestSize    = 1 << 20 // 1MB
	maxHeaderSize     = 1 << 20 // 1MB
	maxFailedLogins   = 5
	failedLoginWindow = 15 * time.Minute
)

//go:embed index.html
//go:embed assets/*
var staticFiles embed.FS

var (
	port           = flag.String("port", "", "Port to listen on (overrides $PORT)")
	appID          = flag.Int("app-id", defaultAppID, "GitHub App ID")
	clientID       = flag.String("client-id", defaultClientID, "GitHub OAuth Client ID")
	clientSecret   = flag.String("client-secret", "", "GitHub OAuth Client Secret")
	redirectURI    = flag.String("redirect-uri", defaultRedirectURI, "OAuth redirect URI")
	allowedOrigins = flag.String("allowed-origins", "", "Comma-separated list of allowed origins for CORS")

	// Security: Track failed login attempts.
	failedAttempts = make(map[string][]time.Time)
	failedMutex    sync.Mutex
)

// rateLimiter implements a simple in-memory rate limiter.
type rateLimiter struct {
	requests map[string][]time.Time
	mu       sync.Mutex
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

func (rl *rateLimiter) limitHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)

		rl.mu.Lock()
		defer rl.mu.Unlock()

		now := time.Now()
		cutoff := now.Add(-rl.window)

		// Clean old requests - reuse slice to reduce allocations
		validRequests := rl.requests[ip][:0]
		for _, t := range rl.requests[ip] {
			if t.After(cutoff) {
				validRequests = append(validRequests, t)
			}
		}

		if len(validRequests) >= rl.limit {
			log.Printf("[SECURITY] Rate limit exceeded: ip=%s requests=%d limit=%d window=%v", ip, len(validRequests), rl.limit, rl.window)
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		rl.requests[ip] = append(validRequests, now)
		next(w, r)
	}
}

// clientIP extracts the client IP address from the request.
func clientIP(r *http.Request) string {
	// SECURITY: Only use RemoteAddr to prevent header spoofing attacks
	// X-Forwarded-For and X-Real-IP are trivially spoofable and should not be trusted
	// for security-critical functions like rate limiting
	//
	// When behind a trusted proxy (like Cloud Run), RemoteAddr will be the proxy IP
	// This means rate limiting happens at the proxy level, which is acceptable
	// as it still prevents single-source DoS attacks
	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		return ip[:colon]
	}
	return ip
}

// securityHeaders adds security headers to all responses.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Add request ID for tracking
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = generateID(8)
		}
		w.Header().Set("X-Request-ID", requestID)
		// Prevent clickjacking
		w.Header().Set("X-Frame-Options", "DENY")

		// Prevent MIME type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Enable XSS protection
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// Referrer policy
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions policy
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

		// Content Security Policy
		csp := []string{
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline'", // Needed for inline event handlers
			"style-src 'self' 'unsafe-inline'",  // Needed for inline styles
			"img-src 'self' https://avatars.githubusercontent.com data:",
			"connect-src 'self' https://api.github.com https://turn.ready-to-review.dev",
			"font-src 'self'",
			"object-src 'none'",
			"frame-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
		}
		w.Header().Set("Content-Security-Policy", strings.Join(csp, "; "))

		// HSTS (only for HTTPS)
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		next.ServeHTTP(w, r)
	})
}

// oauthTokenResponse represents the GitHub OAuth token response.
type oauthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	Scope            string `json:"scope"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// githubUser represents a GitHub user.
type githubUser struct {
	ID    int    `json:"id"`
	Login string `json:"login"`
	Name  string `json:"name"`
}

// getClientSecret retrieves the GitHub OAuth client secret from environment or Secret Manager.
func getClientSecret(ctx context.Context) string {
	// Check if running in Cloud Run
	isCloudRun := os.Getenv("K_SERVICE") != "" || os.Getenv("CLOUD_RUN_TIMEOUT_SECONDS") != ""
	if !isCloudRun {
		log.Print("Not running in Cloud Run, skipping Secret Manager")
		return ""
	}

	// Fetch secret with environment variable override
	// The gsm library auto-detects the project ID from metadata server
	secretValue, err := secrets.Fetch(ctx, "GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET")
	if err != nil {
		log.Printf("Failed to fetch secret from Secret Manager: %v", err)
		return ""
	}

	// Validate secret is not empty
	if secretValue == "" {
		log.Print("WARNING: Secret Manager returned empty value for GITHUB_CLIENT_SECRET")
	}

	return secretValue
}

func main() {
	flag.Parse()

	// Determine port with flag taking precedence over environment
	serverPort := *port
	if serverPort == "" {
		serverPort = os.Getenv("PORT")
	}
	if serverPort == "" {
		serverPort = defaultPort
	}

	// Allow environment variables to override empty flag values
	if *appID == defaultAppID {
		if envAppID := os.Getenv("GITHUB_APP_ID"); envAppID != "" {
			if id, err := strconv.Atoi(envAppID); err == nil {
				*appID = id
			}
		}
	}

	if *clientID == defaultClientID || *clientID == "" {
		if envClientID := os.Getenv("GITHUB_CLIENT_ID"); envClientID != "" {
			*clientID = envClientID
		}
	}

	// Get client secret from environment or Secret Manager
	if *clientSecret == "" {
		ctx := context.Background()
		*clientSecret = getClientSecret(ctx)
	}

	if *redirectURI == defaultRedirectURI || *redirectURI == "" {
		if envRedirectURI := os.Getenv("OAUTH_REDIRECT_URI"); envRedirectURI != "" {
			*redirectURI = envRedirectURI
		}
	}

	if *allowedOrigins == "" {
		if envAllowedOrigins := os.Getenv("ALLOWED_ORIGINS"); envAllowedOrigins != "" {
			*allowedOrigins = envAllowedOrigins
		}
	}

	// Initialize rate limiter
	rl := newRateLimiter(rateLimitRequests, rateLimitWindow)

	// Set up routes
	mux := http.NewServeMux()

	// OAuth endpoints with rate limiting
	mux.HandleFunc("/oauth/login", rl.limitHandler(handleOAuthLogin))
	mux.HandleFunc("/oauth/callback", rl.limitHandler(handleOAuthCallback))
	mux.HandleFunc("/oauth/user", rl.limitHandler(handleGetUser))

	// Health check endpoint
	mux.HandleFunc("/health", handleHealthCheck)

	// Serve everything else as SPA (including assets)
	mux.HandleFunc("/", serveStaticFiles)

	// Wrap with security middleware
	handler := requestLogger(requestSizeLimiter(securityHeaders(mux)))

	// Start server with graceful shutdown
	addr := ":" + serverPort
	srv := &http.Server{
		Addr:           addr,
		Handler:        handler,
		ReadTimeout:    httpTimeout,
		WriteTimeout:   httpTimeout,
		IdleTimeout:    httpTimeout * 12, // 2 minutes
		MaxHeaderBytes: maxHeaderSize,
	}

	log.Printf("Starting server on %s", addr)
	log.Printf("GitHub App ID: %d", *appID)
	log.Printf("OAuth Client ID: %s", *clientID)
	if *clientSecret == "" {
		log.Print("WARNING: OAuth Client Secret not set. OAuth login will not work.")
		log.Print("Set GITHUB_CLIENT_SECRET environment variable or use --client-secret flag")
	} else {
		log.Printf("OAuth Client Secret: configured (length=%d)", len(*clientSecret))
	}

	// Start server in goroutine
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func serveStaticFiles(w http.ResponseWriter, r *http.Request) {
	// Only allow GET and HEAD methods
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Clean the path
	path := filepath.Clean(r.URL.Path)

	// Prevent directory traversal
	if strings.Contains(path, "..") || strings.Contains(path, "~") {
		http.NotFound(w, r)
		return
	}

	// Remove leading slash for embed.FS
	if path == "/" || path == "." {
		path = "index.html"
	} else {
		path = strings.TrimPrefix(path, "/")
	}

	// Try to read the file from embedded FS
	data, err := staticFiles.ReadFile(path)
	if err != nil {
		// If file not found and not an asset, serve index.html for SPA routing
		if !strings.HasPrefix(path, "assets/") && !strings.HasSuffix(path, ".ico") {
			data, err = staticFiles.ReadFile("index.html")
			if err != nil {
				log.Printf("Failed to serve fallback index.html: %v", err)
				http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			if _, err := w.Write(data); err != nil {
				log.Printf("Failed to write response: %v", err)
			}
			return
		}
		http.NotFound(w, r)
		return
	}

	// Set content type based on file extension
	switch {
	case strings.HasSuffix(path, ".html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case strings.HasSuffix(path, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(path, ".js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case strings.HasSuffix(path, ".json"):
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	case strings.HasSuffix(path, ".png"):
		w.Header().Set("Content-Type", "image/png")
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		w.Header().Set("Content-Type", "image/jpeg")
	case strings.HasSuffix(path, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	case strings.HasSuffix(path, ".ico"):
		w.Header().Set("Content-Type", "image/x-icon")
	default:
		// No specific content type
	}

	// Write the file content
	if _, err := w.Write(data); err != nil {
		log.Printf("Failed to write file content: %v", err)
	}
}

func handleOAuthLogin(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers for popup windows
	requestOrigin := origin(r)
	if isAllowedOrigin(requestOrigin) {
		w.Header().Set("Access-Control-Allow-Origin", requestOrigin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}

	if *clientID == "" {
		log.Print("OAuth login attempted but client ID not configured. Set GITHUB_CLIENT_ID environment variable or use --client-id flag")
		http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// Generate state for CSRF protection
	state := generateID(16)

	// Store state in cookie with secure settings
	cookie := &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(stateExpiry),
	}

	// Set Secure flag for HTTPS
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		cookie.Secure = true
	}

	http.SetCookie(w, cookie)

	// Build authorization URL
	authURL := fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=%s&state=%s",
		url.QueryEscape(*clientID),
		url.QueryEscape(*redirectURI),
		url.QueryEscape("repo read:org"),
		url.QueryEscape(state),
	)

	http.Redirect(w, r, authURL, http.StatusFound)
}

func handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if *clientID == "" || *clientSecret == "" {
		log.Printf("OAuth callback attempted but not configured: client_id=%q client_secret_set=%v",
			*clientID, *clientSecret != "")
		log.Print("Set GITHUB_CLIENT_SECRET environment variable or --client-secret flag")
		http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// Check for OAuth errors from GitHub
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		errDesc := r.URL.Query().Get("error_description")
		log.Printf("OAuth error: %s - %s", errCode, errDesc)

		// Return user-friendly error page
		escapedMsg := strings.NewReplacer(
			"&", "&amp;",
			"<", "&lt;",
			">", "&gt;",
			"\"", "&quot;",
			"'", "&#39;",
		).Replace("Authentication was cancelled or failed. Please try again.")
		html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Failed</title>
</head>
<body>
    <h1>Authentication Failed</h1>
    <p>%s</p>
    <p>You can close this window and try again.</p>
</body>
</html>
`, escapedMsg)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write([]byte(html)); err != nil {
			log.Printf("Failed to write error response: %v", err)
		}
		return
	}

	// Check if this is a GitHub App installation callback
	installationID := r.URL.Query().Get("installation_id")
	setupAction := r.URL.Query().Get("setup_action")

	if installationID != "" && setupAction != "" {
		// This is a GitHub App installation callback
		log.Printf("GitHub App installation callback: installation_id=%s, setup_action=%s", installationID, setupAction)

		// Return a success page for app installations
		escapedAction := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(setupAction)
		escapedID := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(installationID)

		html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>GitHub App Installation</title>
</head>
<body>
    <h1>GitHub App Installed Successfully</h1>
    <p>The GitHub App has been %s successfully.</p>
    <p>Installation ID: %s</p>
    <p>You can close this window and return to the dashboard.</p>
    <script>
        // Notify parent window if it exists
        if (window.opener) {
            window.opener.postMessage({
                type: 'github-app-installed',
                installationId: '%s',
                setupAction: '%s'
            }, '*');
        }
        // Auto-close after 3 seconds
        setTimeout(function() {
            window.close();
        }, 3000);
    </script>
</body>
</html>
`, escapedAction, escapedID, escapedID, escapedAction)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write([]byte(html)); err != nil {
			log.Printf("Failed to write GitHub App installation response: %v", err)
		}
		return
	}

	// Regular OAuth flow - verify state
	state := r.URL.Query().Get("state")
	if state == "" {
		trackFailedAttempt(clientIP(r))
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}

	cookie, err := r.Cookie("oauth_state")
	if err != nil || cookie.Value != state {
		trackFailedAttempt(clientIP(r))
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	// Clear the state cookie immediately
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 512 {
		trackFailedAttempt(clientIP(r))
		http.Error(w, "Invalid authorization code", http.StatusBadRequest)
		return
	}

	// Exchange code for token
	ctx := r.Context()
	token, err := exchangeCodeForToken(ctx, code, *redirectURI)
	if err != nil {
		trackFailedAttempt(clientIP(r))
		log.Printf("Failed to exchange code for token: %v", err)
		http.Error(w, "Authentication failed", http.StatusInternalServerError)
		return
	}

	// For OAuth callbacks, derive the target origin from the redirect URI
	// since the request origin will be GitHub
	parsedRedirectURI, err := url.Parse(*redirectURI)
	if err != nil {
		log.Printf("Failed to parse redirect URI: %v", err)
		http.Error(w, "Configuration error", http.StatusInternalServerError)
		return
	}
	targetOrigin := fmt.Sprintf("%s://%s", parsedRedirectURI.Scheme, parsedRedirectURI.Host)

	// Return HTML that posts the token to the parent window with specific origin
	html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Callback</title>
</head>
<body>
    <script>
        const targetOrigin = '%s';
        if (window.opener && window.opener.origin === targetOrigin) {
            window.opener.postMessage({
                type: 'oauth-callback',
                token: '%s'
            }, targetOrigin);
            window.close();
        } else {
            document.body.innerHTML = 'Authentication successful. You can close this window.';
        }
    </script>
</body>
</html>
`, targetOrigin, token)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write([]byte(html)); err != nil {
		log.Printf("Failed to write OAuth callback response: %v", err)
	}
}

func handleGetUser(w http.ResponseWriter, r *http.Request) {
	// Get token from Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Missing authorization header", http.StatusUnauthorized)
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader {
		http.Error(w, "Invalid authorization header", http.StatusUnauthorized)
		return
	}

	// Get user info from GitHub
	ctx := r.Context()
	user, err := userInfo(ctx, token)
	if err != nil {
		log.Printf("Failed to get user info: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(user); err != nil {
		log.Printf("Failed to encode user response: %v", err)
	}
}

func exchangeCodeForToken(ctx context.Context, code, redirectURI string) (string, error) {
	// Validate inputs
	if code == "" || redirectURI == "" {
		return "", errors.New("invalid parameters")
	}

	// Additional validation for code length to prevent injection
	if len(code) > 512 {
		return "", errors.New("authorization code too long")
	}

	// Prepare request
	data := url.Values{}
	data.Set("client_id", *clientID)
	data.Set("client_secret", *clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)

	reqCtx, cancel := context.WithTimeout(ctx, httpTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	// Make request with timeout
	client := &http.Client{
		Timeout: httpTimeout,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.Printf("Failed to close response body: %v", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange returned status %d", resp.StatusCode)
	}

	// Read the entire response body for debugging
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	// Parse response
	var tokenResp oauthTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		// Log the raw response for debugging
		log.Printf("Token exchange response body: %s", string(body))
		return "", fmt.Errorf("failed to parse token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		// Log the parsed response for debugging
		log.Printf("Token response error: %s, description: %s", tokenResp.Error, tokenResp.ErrorDescription)
		return "", errors.New("no access token in response")
	}

	// Validate token before returning
	if len(tokenResp.AccessToken) < 40 || len(tokenResp.AccessToken) > 255 {
		return "", errors.New("invalid token length")
	}

	// Check token format (GitHub tokens are typically 40 chars of hex)
	// Note: newer GitHub tokens may start with 'ghp_' or similar prefixes
	if !strings.HasPrefix(tokenResp.AccessToken, "ghp_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "gho_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "ghs_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "ghu_") {
		return "", errors.New("unknown token format")
	}

	return tokenResp.AccessToken, nil
}

func userInfo(ctx context.Context, token string) (*githubUser, error) {
	reqCtx, cancel := context.WithTimeout(ctx, httpTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, "https://api.github.com/user", http.NoBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{
		Timeout: httpTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("unexpected redirect")
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.Printf("Failed to close response body: %v", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var user githubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	return &user, nil
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	// Only allow GET
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	health := struct {
		Status     string    `json:"status"`
		Version    string    `json:"version"`
		Timestamp  time.Time `json:"timestamp"`
		OAuthReady bool      `json:"oauth_ready"`
	}{
		Status:     "healthy",
		Version:    "1.0.0",
		Timestamp:  time.Now(),
		OAuthReady: *clientID != "" && *clientSecret != "",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(health); err != nil {
		log.Printf("Failed to encode health response: %v", err)
	}
}

// generateID generates a cryptographically secure random ID.
func generateID(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		// Critical security failure - do not fall back to weak randomness
		panic(fmt.Sprintf("CRITICAL: Failed to generate secure random ID: %v", err))
	}
	return base64.URLEncoding.EncodeToString(b)
}

func trackFailedAttempt(ip string) {
	failedMutex.Lock()
	defer failedMutex.Unlock()

	now := time.Now()
	cutoff := now.Add(-failedLoginWindow)

	// Clean old attempts
	var valid []time.Time
	for _, t := range failedAttempts[ip] {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	failedAttempts[ip] = append(valid, now)

	// Log if there are too many failed attempts
	if len(failedAttempts[ip]) > maxFailedLogins {
		log.Printf("[SECURITY] Excessive failed auth attempts: ip=%s count=%d window=15min", ip, len(failedAttempts[ip]))
	}
}

func origin(r *http.Request) string {
	// Check Origin header first
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin
	}

	// Check Referer as fallback
	if referer := r.Header.Get("Referer"); referer != "" {
		if u, err := url.Parse(referer); err == nil {
			return fmt.Sprintf("%s://%s", u.Scheme, u.Host)
		}
	}

	// Default to request origin
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, r.Host)
}

func isAllowedOrigin(origin string) bool {
	// Always allow same-origin
	if origin == "" {
		return true
	}

	// Parse allowed origins from flag
	if *allowedOrigins != "" {
		allowed := strings.Split(*allowedOrigins, ",")
		for _, ao := range allowed {
			if strings.TrimSpace(ao) == origin {
				return true
			}
		}
		return false
	}

	// Default allowed origins
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	// Allow localhost for development and the production domain
	host := u.Hostname()
	return host == "localhost" ||
		host == "127.0.0.1" ||
		strings.HasPrefix(host, "localhost:") ||
		host == "dash.ready-to-review.dev" ||
		host == "ready-to-review.dev"
}

// requestSizeLimiter prevents large request bodies from exhausting server resources.
func requestSizeLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestSize)

		// Check Content-Length header
		if r.ContentLength > maxRequestSize {
			log.Printf("Request too large from %s: %d bytes", clientIP(r), r.ContentLength)
			http.Error(w, "Request too large", http.StatusRequestEntityTooLarge)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// requestLogger logs all HTTP requests and responses.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := w.Header().Get("X-Request-ID")

		// Create a response writer wrapper to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Log request
		log.Printf("[%s] %s %s %s from %s", requestID, r.Method, r.URL.Path, r.Proto, clientIP(r))

		next.ServeHTTP(wrapped, r)

		// Log response
		duration := time.Since(start)
		log.Printf("[%s] %d %s in %v", requestID, wrapped.statusCode, http.StatusText(wrapped.statusCode), duration)

		// Log security events with structured data
		switch wrapped.statusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			log.Printf("[SECURITY] [%s] Unauthorized access: method=%s path=%s ip=%s", requestID, r.Method, r.URL.Path, clientIP(r))
		case http.StatusTooManyRequests:
			log.Printf("[SECURITY] [%s] Rate limit exceeded: ip=%s", requestID, clientIP(r))
		case http.StatusInternalServerError:
			log.Printf("[ERROR] [%s] Internal server error: method=%s path=%s ip=%s", requestID, r.Method, r.URL.Path, clientIP(r))
		default:
			// Other status codes don't require special logging
		}
	})
}

type responseWriter struct {
	http.ResponseWriter

	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.ResponseWriter.WriteHeader(code)
		rw.written = true
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.WriteHeader(http.StatusOK)
	}
	return rw.ResponseWriter.Write(b)
}
