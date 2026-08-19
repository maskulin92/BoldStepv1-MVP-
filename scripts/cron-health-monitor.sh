#!/usr/bin/env bash
# Boldstep Health Monitor — script-only cronjob (no LLM needed).
#
# Checks the Boldstep API health endpoint, sends a Telegram alert if critical
# services are down. Silent (no message) when everything is GREEN.
#
# Usage: bash scripts/cron-health-monitor.sh

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

API_URL="https://bold-stepv1-mvp.vercel.app"

# --- Step 1: Check health endpoint ---
HEALTH_RESPONSE=$(curl -s --max-time 15 "${API_URL}/api/health" 2>&1) || {
  MSG="🔴 Boldstep API is DOWN: connection failed or timeout"
  send_telegram "$MSG"
  echo "$MSG"
  exit 0
}

# --- Step 2: Parse response ---
STATUS=$(echo "$HEALTH_RESPONSE" | node -e "
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const d = body.data ?? body;
      const services = d.services ?? {};
      const issues = [];
      if (d.status !== 'ok') issues.push('status=' + d.status);
      if (d.mock_mode === true) issues.push('mock_mode=true');
      if (services.firestore === false) issues.push('firestore=false');
      if (services.glm === false) issues.push('glm=false');
      if (services.meta_ads === false) issues.push('meta_ads=false');
      if (services.telegram === false) issues.push('telegram=false');
      if (issues.length === 0) {
        console.log('GREEN');
      } else {
        console.log('ISSUES:' + issues.join(', '));
      }
    } catch (e) {
      console.log('PARSE_ERROR:' + e.message);
    }
  });
" 2>/dev/null || echo "PARSE_ERROR:node-failed")

# --- Step 3: Evaluate and alert ---
if [ "$STATUS" = "GREEN" ]; then
  # Everything healthy — stay silent
  echo "💚 Boldstep health: all GREEN"
  exit 0
elif [[ "$STATUS" == "PARSE_ERROR"* ]]; then
  MSG="🔴 Boldstep health check CRITICAL: could not parse API response"
  send_telegram "$MSG"
  echo "$MSG"
elif [[ "$STATUS" == "ISSUES:"* ]]; then
  ISSUES="${STATUS#ISSUES:}"
  # Critical = firestore or glm down, or mock_mode, or status not ok
  if echo "$ISSUES" | grep -qiE "firestore=false|glm=false|mock_mode=true|status="; then
    MSG="🔴 Boldstep health check CRITICAL: ${ISSUES}"
  else
    MSG="🟡 Boldstep health check: ${ISSUES} (non-critical)"
  fi
  send_telegram "$MSG"
  echo "$MSG"
else
  MSG="🔴 Boldstep health check: unexpected response from API"
  send_telegram "$MSG"
  echo "$MSG"
fi
