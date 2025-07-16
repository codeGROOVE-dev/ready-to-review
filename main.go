// Package main implements a secure OAuth2 server for the GitHub PR dashboard.
// It serves static files and handles GitHub OAuth authentication flow.
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
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
)

// Constants for configuration
const (
	defaultPort        = "8080"
	defaultAppID       = 1546081
	defaultClientID    = "Iv23liYmAKkBpvhHAnQQ"
	defaultRedirectURI = "https://dash.ready-to-review.dev/oauth/callback"

	// Rate limiting
	rateLimitRequests = 10
	rateLimitWindow   = 1 * time.Minute

	// Timeouts
	httpTimeout     = 10 * time.Second
	shutdownTimeout = 30 * time.Second
	stateExpiry     = 15 * time.Minute

	// Security
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

	// Security: Track failed login attempts
	failedAttempts = make(map[string][]time.Time)
	failedMutex    sync.Mutex
)

// rateLimiter implements a simple in-memory rate limiter
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

		// Clean old requests
		var validRequests []time.Time
		for _, t := range rl.requests[ip] {
			if t.After(cutoff) {
				validRequests = append(validRequests, t)
			}
		}

		if len(validRequests) >= rl.limit {
			log.Printf("[SECURITY] Rate limit exceeded for %s", ip)
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		rl.requests[ip] = append(validRequests, now)
		next(w, r)
	}
}

// clientIP extracts the client IP address from the request
func clientIP(r *http.Request) string {
	// Check X-Forwarded-For header first
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			return strings.TrimSpace(ips[0])
		}
	}

	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		ip = ip[:colon]
	}
	return ip
}

// securityHeaders adds security headers to all responses
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

// oauthTokenResponse represents the GitHub OAuth token response
type oauthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	Scope            string `json:"scope"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// githubUser represents a GitHub user
type githubUser struct {
	Login string `json:"login"`
	ID    int    `json:"id"`
	Name  string `json:"name"`
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

	if *clientSecret == "" {
		if envSecret := os.Getenv("GITHUB_CLIENT_SECRET"); envSecret != "" {
			*clientSecret = envSecret
		}
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

	// Serve static files
	mux.HandleFunc("/", serveStaticFiles)
	mux.HandleFunc("/assets/", serveStaticFiles)

	// OAuth endpoints with rate limiting
	mux.HandleFunc("/oauth/login", rl.limitHandler(handleOAuthLogin))
	mux.HandleFunc("/oauth/callback", rl.limitHandler(handleOAuthCallback))
	mux.HandleFunc("/oauth/user", rl.limitHandler(handleGetUser))

	// Wrap with security middleware
	handler := requestLogger(requestSizeLimiter(securityHeaders(mux)))

	// Add health check endpoint
	mux.HandleFunc("/health", handleHealthCheck)

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
		log.Printf("Warning: OAuth Client Secret not set. OAuth login will not work.")
	}

	// Start server in goroutine
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
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
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

func serveStaticFiles(w http.ResponseWriter, r *http.Request) {
	// Only allow GET and HEAD methods
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Clean and validate the path
	path := filepath.Clean(r.URL.Path)
	if path == "/" || path == "." {
		path = "index.html"
	} else {
		// Remove leading slash for embed.FS
		path = strings.TrimPrefix(path, "/")
	}

	// Prevent directory traversal
	if strings.Contains(path, "..") || strings.Contains(path, "~") {
		http.NotFound(w, r)
		return
	}

	// Only serve files from allowed paths
	if !isAllowedPath(path) {
		http.NotFound(w, r)
		return
	}

	// Try to read the file from embedded FS
	data, err := staticFiles.ReadFile(path)
	if err != nil {
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
	case strings.HasSuffix(path, ".md"):
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}

	// Write the file content
	w.Write(data)
}

func isAllowedPath(path string) bool {
	// Only allow serving specific files and directories
	allowedPaths := []string{
		"index.html",
		"assets/",
	}

	for _, allowed := range allowedPaths {
		if path == allowed || strings.HasPrefix(path, allowed) {
			return true
		}
	}
	return false
}

func handleOAuthLogin(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers for popup windows
	origin := getOrigin(r)
	if isAllowedOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}

	if *clientID == "" {
		log.Printf("OAuth login attempted but client ID not configured")
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
		log.Printf("OAuth callback attempted but not configured")
		http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// Check for OAuth errors from GitHub
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		errDesc := r.URL.Query().Get("error_description")
		log.Printf("OAuth error: %s - %s", errCode, errDesc)

		// Return user-friendly error page
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
`, escapeHtml("Authentication was cancelled or failed. Please try again."))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
		return
	}

	// Check if this is a GitHub App installation callback
	installationID := r.URL.Query().Get("installation_id")
	setupAction := r.URL.Query().Get("setup_action")
	
	if installationID != "" && setupAction != "" {
		// This is a GitHub App installation callback
		log.Printf("GitHub App installation callback: installation_id=%s, setup_action=%s", installationID, setupAction)
		
		// Return a success page for app installations
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
`, escapeHtml(setupAction), escapeHtml(installationID), escapeHtml(installationID), escapeHtml(setupAction))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
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
	token, err := exchangeCodeForToken(code, *redirectURI)
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
	w.Write([]byte(html))
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
	user, err := getUserInfo(token)
	if err != nil {
		log.Printf("Failed to get user info: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func exchangeCodeForToken(code, redirectURI string) (string, error) {
	// Validate inputs
	if code == "" || redirectURI == "" {
		return "", fmt.Errorf("invalid parameters")
	}

	// Prepare request
	data := url.Values{}
	data.Set("client_id", *clientID)
	data.Set("client_secret", *clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)

	ctx, cancel := context.WithTimeout(context.Background(), httpTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	// Make request with timeout
	client := &http.Client{
		Timeout: httpTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}
	defer resp.Body.Close()

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
		return "", fmt.Errorf("no access token in response")
	}

	// Validate token before returning
	if err := validateToken(tokenResp.AccessToken); err != nil {
		return "", fmt.Errorf("token validation failed: %w", err)
	}

	return tokenResp.AccessToken, nil
}

func getUserInfo(token string) (*githubUser, error) {
	ctx, cancel := context.WithTimeout(context.Background(), httpTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{
		Timeout: httpTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return fmt.Errorf("unexpected redirect")
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var user githubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	return &user, nil
}

func validateToken(token string) error {
	// Basic validation
	if len(token) < 40 || len(token) > 255 {
		return fmt.Errorf("invalid token length")
	}

	// Check token format (GitHub tokens are typically 40 chars of hex)
	// Note: newer GitHub tokens may start with 'ghp_' or similar prefixes
	if strings.HasPrefix(token, "ghp_") || strings.HasPrefix(token, "gho_") || strings.HasPrefix(token, "ghs_") || strings.HasPrefix(token, "ghu_") {
		// Validate the format for new-style tokens
		if len(token) < 40 {
			return fmt.Errorf("invalid token format - too long - %s", token)
		}
	} else {
		return fmt.Errorf("unknown token prefix: %q", token[6])
	}

	return nil
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	// Only allow GET
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	health := struct {
		Status     string    `json:"status"`
		Timestamp  time.Time `json:"timestamp"`
		OAuthReady bool      `json:"oauth_ready"`
		Version    string    `json:"version"`
	}{
		Status:     "healthy",
		Timestamp:  time.Now(),
		OAuthReady: *clientID != "" && *clientSecret != "",
		Version:    "1.0.0",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(health)
}

// generateID generates a cryptographically secure random ID
func generateID(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		log.Printf("Failed to generate random ID: %v", err)
		// Fall back to less secure method
		return fmt.Sprintf("%d", time.Now().UnixNano())
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
		log.Printf("[SECURITY] Multiple failed authentication attempts from %s (%d in 15 minutes)", ip, len(failedAttempts[ip]))
	}
}

func escapeHtml(text string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&#39;",
	)
	return replacer.Replace(text)
}

func getRedirectURI(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/oauth/callback", scheme, r.Host)
}

func getOrigin(r *http.Request) string {
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

// requestSizeLimiter prevents large request bodies from exhausting server resources
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

// requestLogger logs all HTTP requests and responses
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

		// Log security events
		switch wrapped.statusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			log.Printf("[SECURITY] [%s] Unauthorized access attempt: %s %s from %s", requestID, r.Method, r.URL.Path, clientIP(r))
		case http.StatusTooManyRequests:
			log.Printf("[SECURITY] [%s] Rate limit exceeded from %s", requestID, clientIP(r))
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
