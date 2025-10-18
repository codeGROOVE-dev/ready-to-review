package main

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestCSRFConfiguration verifies that CSRF protection can be configured
// with all required origins without errors. This test catches configuration
// bugs that would cause the server to fail at startup.
func TestCSRFConfiguration(t *testing.T) {
	// This test replicates the exact CSRF configuration from main()
	// to ensure it doesn't fail during server startup
	csrf := http.NewCrossOriginProtection()

	// Test base domain
	if err := csrf.AddTrustedOrigin("https://" + baseDomain); err != nil {
		t.Fatalf("Failed to configure CSRF for base domain: %v", err)
	}

	// Test subdomain wildcard
	if err := csrf.AddTrustedOrigin("https://*." + baseDomain); err != nil {
		t.Fatalf("Failed to configure CSRF for subdomains: %v", err)
	}

	// Test localhost (covers all ports)
	if err := csrf.AddTrustedOrigin("http://localhost"); err != nil {
		t.Fatalf("Failed to configure CSRF for localhost: %v", err)
	}
}

// TestCSRFOriginValidation tests various origin configurations to understand
// what the CSRF protection accepts.
func TestCSRFOriginValidation(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		wantErr bool
	}{
		{
			name:    "https base domain",
			origin:  "https://" + baseDomain,
			wantErr: false,
		},
		{
			name:    "https subdomain wildcard",
			origin:  "https://*." + baseDomain,
			wantErr: false,
		},
		{
			name:    "http localhost",
			origin:  "http://localhost",
			wantErr: false,
		},
		{
			name:    "http localhost with specific port",
			origin:  "http://localhost:8080",
			wantErr: false,
		},
		{
			name:    "http localhost with wildcard port",
			origin:  "http://localhost:*",
			wantErr: true, // Expected to fail - invalid port syntax
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			csrf := http.NewCrossOriginProtection()
			err := csrf.AddTrustedOrigin(tt.origin)
			if (err != nil) != tt.wantErr {
				t.Errorf("AddTrustedOrigin(%q) error = %v, wantErr %v", tt.origin, err, tt.wantErr)
			}
		})
	}
}

// TestServerIntegration builds and starts the server binary, verifies it serves
// HTTP requests successfully, then shuts it down. This is a full integration test
// that catches startup failures and configuration errors.
func TestServerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Build the binary
	ctx := context.Background()
	buildCtx, buildCancel := context.WithTimeout(ctx, 30*time.Second)
	defer buildCancel()

	binaryPath := "./dashboard-test"
	t.Cleanup(func() {
		os.Remove(binaryPath)
	})

	buildCmd := exec.CommandContext(buildCtx, "go", "build", "-o", binaryPath, ".")
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build binary: %v\nOutput: %s", err, output)
	}

	// Start the server on a specific test port
	serverCtx, serverCancel := context.WithCancel(ctx)
	defer serverCancel()

	serverCmd := exec.CommandContext(serverCtx, binaryPath)
	serverCmd.Env = append(os.Environ(),
		"PORT=18765", // Use a specific test port
		"GITHUB_CLIENT_ID=test_client_id",
		"GITHUB_CLIENT_SECRET=test_secret",
	)

	// Capture server output for debugging
	serverCmd.Stdout = os.Stdout
	serverCmd.Stderr = os.Stderr

	if err := serverCmd.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}

	// Ensure server is killed when test completes
	t.Cleanup(func() {
		serverCancel()
		if serverCmd.Process != nil {
			serverCmd.Process.Kill()
			serverCmd.Wait()
		}
	})

	// Wait for server to be ready
	serverURL := "http://localhost:18765"
	client := &http.Client{Timeout: 5 * time.Second}

	var lastErr error
	for range 50 {
		time.Sleep(100 * time.Millisecond)

		resp, err := client.Get(serverURL + "/health")
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			t.Log("Server started successfully and responding to requests")
			return
		}

		lastErr = nil
	}

	if lastErr != nil {
		t.Fatalf("Server failed to respond after 5 seconds: %v", lastErr)
	}
	t.Fatal("Server did not return 200 OK within 5 seconds")
}
