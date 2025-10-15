// Package secrets provides access to Google Cloud Secret Manager with environment variable overrides.
package secrets

import (
	"context"
	"log"
	"os"

	"github.com/codeGROOVE-dev/gsm"
)

// Fetch retrieves a secret value from Google Secret Manager with environment variable override.
// If the environment variable is set, it takes precedence over Secret Manager.
// This function automatically detects the GCP project ID from the metadata server.
func Fetch(ctx context.Context, envVar, secretName string) (string, error) {
	// First check environment variable
	if value := os.Getenv(envVar); value != "" {
		log.Printf("Using environment variable %s (length: %d)", envVar, len(value))
		return value, nil
	}

	// Fetch from Secret Manager
	log.Printf("Fetching secret %s from Google Secret Manager", secretName)
	value, err := gsm.Fetch(ctx, secretName)
	if err != nil {
		return "", err
	}

	log.Printf("Successfully fetched secret %s from Google Secret Manager (length: %d)", secretName, len(value))
	return value, nil
}

// FetchFromProject retrieves a secret value from a specific GCP project with environment variable override.
func FetchFromProject(ctx context.Context, projectID, envVar, secretName string) (string, error) {
	// First check environment variable
	if value := os.Getenv(envVar); value != "" {
		log.Printf("Using environment variable %s (length: %d)", envVar, len(value))
		return value, nil
	}

	// Fetch from Secret Manager
	log.Printf("Fetching secret %s from Google Secret Manager (project: %s)", secretName, projectID)
	value, err := gsm.FetchFromProject(ctx, projectID, secretName)
	if err != nil {
		return "", err
	}

	log.Printf("Successfully fetched secret %s from Google Secret Manager (length: %d)", secretName, len(value))
	return value, nil
}
