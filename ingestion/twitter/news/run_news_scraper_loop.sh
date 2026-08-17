#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_FILE="${NEWS_SCRAPE_LOCK_FILE:-/tmp/news-scrape.lock}"
LOG_FILE="${NEWS_SCRAPE_LOG_FILE:-/var/log/news-scrape.log}"
LOOP_SLEEP_SECONDS="${NEWS_SCRAPE_LOOP_SLEEP_SECONDS:-5}"
ENV_FILE="${ENV_FILE:-/home/ec2-user/ingestion.env}"

while true; do
  printf "\n[%s] starting news scrape loop iteration\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${LOG_FILE}"
  flock -x "${LOCK_FILE}" env ENV_FILE="${ENV_FILE}" "${SCRIPT_DIR}/run_news_scraper.sh" >> "${LOG_FILE}" 2>&1
  status=$?
  printf "[%s] news scrape loop iteration exited code=%s; sleeping %ss\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${status}" "${LOOP_SLEEP_SECONDS}" >> "${LOG_FILE}"
  sleep "${LOOP_SLEEP_SECONDS}"
done
