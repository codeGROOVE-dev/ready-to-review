#!/bin/sh
PROJECT="ready-to-review"
export KO_DOCKER_REPO="gcr.io/${PROJECT}/dashboard"

gcloud run deploy dashboard --image="$(ko publish .)" --region us-central1 --project "${PROJECT}"
