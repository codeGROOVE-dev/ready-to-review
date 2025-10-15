#!/usr/bin/env bash -eux -o pipefail
# Deploys Go program to Cloud Run - from cwd or arg[1].
cd "${1:-.}"

PROJECT="ready-two-review"
REGION="us-central1"
APP=$(basename "$(go list -m)")
SA="$APP@$PROJECT.iam.gserviceaccount.com"

gcloud iam service-accounts describe "$SA" &>/dev/null ||
	gcloud iam service-accounts create "$APP" --project="$PROJECT"

grep -q gcr.io $HOME/.docker/config.json ||
    gcloud auth configure-docker gcr.io

KO_DOCKER_REPO="gcr.io/$PROJECT/$APP" ko publish . |
	xargs -I{} gcloud run deploy "$APP" --image={} --region="$REGION" \
		--service-account="$SA" --project="$PROJECT"
