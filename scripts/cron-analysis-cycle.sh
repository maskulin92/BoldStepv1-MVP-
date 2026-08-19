#!/usr/bin/env bash
# Boldstep Analysis Cycle — script-only cronjob (no LLM needed).
#
# Calls the Boldstep API to run analysis for every client, collects results,
# and sends a summary to Telegram using the Boldstep bot token from .env.local.
#
# Usage: bash scripts/cron-analysis-cycle.sh
# Silent (no output) when everything succeeds with 0 actions filed —
# the API already sends its own per-action Telegram notification.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

# --- Load .env.local ---
if [ ! -f "$ENV_FILE" ]; then
  echo "⚠️ Boldstep cycle failed: .env.local not found"
  exit 1
fi

# Parse env vars we need
HERMES_API_KEY=$(grep -E '^HERMES_API_KEY=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d '\r')
TELEGRAM_BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d '\r')
TELEGRAM_CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d '\r')
API_URL="https://bold-stepv1-mvp.vercel.app"

if [ -z "$HERMES_API_KEY" ]; then
  echo "⚠️ Boldstep cycle failed: HERMES_API_KEY not set in .env.local"
  exit 1
fi

# --- Helper: send Telegram message ---
send_telegram() {
  local text="$1"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${text}" \
      > /dev/null 2>&1 || true
  fi
}

# --- Step 1: Get list of clients ---
CLIENTS_RESPONSE=$(curl -s -H "Authorization: Bearer ${HERMES_API_KEY}" "${API_URL}/api/clients" 2>&1) || {
  send_telegram "⚠️ Boldstep analysis cycle failed: could not reach API"
  echo "⚠️ Boldstep analysis cycle failed: could not reach API"
  exit 1
}

# Extract client IDs (simple JSON parse — works for the API response shape)
CLIENT_IDS=$(echo "$CLIENTS_RESPONSE" | node -e "
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const clients = body.data ?? body;
      if (!Array.isArray(clients)) { console.log(''); return; }
      console.log(clients.map(c => c.id).join('\n'));
    } catch { console.log(''); }
  });
")

if [ -z "$CLIENT_IDS" ]; then
  echo "⚠️ Boldstep analysis cycle: no clients found"
  send_telegram "⚠️ Boldstep analysis cycle: no clients found in API response"
  exit 0
fi

# --- Step 2: Run analysis for each client ---
TOTAL_CLIENTS=0
TOTAL_ACTIONS=0
ERRORS=""

while IFS= read -r CLIENT_ID; do
  [ -z "$CLIENT_ID" ] && continue
  TOTAL_CLIENTS=$((TOTAL_CLIENTS + 1))

  RUN_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer ${HERMES_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"${CLIENT_ID}\"}" \
    "${API_URL}/api/hermes/run" 2>&1) || {
    ERRORS="${errors}Client ${CLIENT_ID}: API call failed. "
    continue
  }

  # Extract filed_count from response
  FILED=$(echo "$RUN_RESPONSE" | node -e "
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const data = body.data ?? body;
        console.log(data.filed_count ?? 0);
      } catch { console.log('0'); }
    });
  " 2>/dev/null || echo "0")

  TOTAL_ACTIONS=$((TOTAL_ACTIONS + FILED))
done <<< "$CLIENT_IDS"

# --- Step 3: Summary ---
if [ -n "$ERRORS" ]; then
  MSG="⚠️ Boldstep analysis cycle had errors: ${TOTAL_CLIENTS} clients analyzed, ${TOTAL_ACTIONS} actions filed. Errors: ${ERRORS}"
  send_telegram "$MSG"
  echo "$MSG"
elif [ "$TOTAL_ACTIONS" -gt 0 ]; then
  MSG="✅ Boldstep cycle complete: ${TOTAL_CLIENTS} clients analyzed, ${TOTAL_ACTIONS} actions filed"
  send_telegram "$MSG"
  echo "$MSG"
else
  # All clear, 0 actions — stay silent (no Telegram message)
  echo "✅ Boldstep cycle complete: ${TOTAL_CLIENTS} clients analyzed, 0 actions filed (all clear)"
fi
