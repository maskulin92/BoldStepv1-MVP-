#!/usr/bin/env bash
# Boldstep Daily Cleanup — script-only cronjob (no LLM needed).
#
# Runs the duplicate cleanup script, sends a Telegram summary.
# Silent (no message) when 0 duplicates found — the safety net is clean.
#
# Usage: bash scripts/cron-cleanup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

# --- Load Telegram creds ---
TELEGRAM_BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d '\r')
TELEGRAM_CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d '\r')

send_telegram() {
  local text="$1"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${text}" \
      > /dev/null 2>&1 || true
  fi
}

# --- Step 1: Dry run to count ---
DRY_OUTPUT=$(cd "$SCRIPT_DIR/.." && node scripts/cleanup-duplicate-actions.mjs 2>&1) || {
  send_telegram "⚠️ Boldstep cleanup script failed: ${DRY_OUTPUT}"
  echo "⚠️ Cleanup failed: ${DRY_OUTPUT}"
  exit 1
}

DUPES=$(echo "$DRY_OUTPUT" | grep "Duplicate actions to drop:" | grep -oE '[0-9]+' || echo "0")

if [ "$DUPES" -eq 0 ]; then
  # All clean — stay silent
  echo "🧹 Boldstep daily cleanup: 0 duplicates found. All clean."
  exit 0
fi

# --- Step 2: Apply cleanup ---
cd "$SCRIPT_DIR/.." && node scripts/cleanup-duplicate-actions.mjs --apply > /dev/null 2>&1 || {
  send_telegram "⚠️ Boldstep cleanup: found ${DUPES} duplicates but delete failed"
  echo "⚠️ Cleanup delete failed"
  exit 1
}

MSG="🧹 Boldstep daily cleanup: ${DUPES} duplicates found and deleted. Firestore is clean."
send_telegram "$MSG"
echo "$MSG"
