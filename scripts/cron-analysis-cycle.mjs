#!/usr/bin/env node
/**
 * Boldstep Analysis Cycle — script-only cronjob (no LLM needed).
 *
 * Uses Firebase Admin SDK directly to:
 *   1. List all clients
 *   2. Call POST /api/hermes/run for each (the API handles sync + analysis
 *      + filing + Telegram notification internally)
 *   3. Send a Telegram summary via the Boldstep bot
 *
 * Why not call the API directly? The HERMES_API_KEY in .env.local may not
 * match the one configured in Vercel's environment. Going through Firebase
 * for the client list avoids the auth mismatch. The /api/hermes/run call
 * still needs the key, so we also try a direct-DB fallback for filing.
 *
 * Actually — simpler: this script calls POST /api/hermes/run with the key
 * from .env.local. If that fails (401), it falls back to logging + alerting.
 *
 * Usage: node scripts/cron-analysis-cycle.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');

function loadEnv(path) {
  const text = readFileSync(path, 'utf8');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    v = v.replace(/\\\$/g, '$');
    vars[m[1]] = v;
  }
  return vars;
}

const env = loadEnv(envPath);
const API_URL = 'https://bold-stepv1-mvp.vercel.app';
const API_KEY = env.HERMES_API_KEY ?? '';
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN ?? '';
const TG_CHAT = env.TELEGRAM_CHAT_ID ?? '';

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
    });
  } catch { /* best-effort */ }
}

async function apiCall(method, path, body) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const err = json?.error?.code ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(`${method} ${path} -> ${err}`);
  }
  return json.data ?? json;
}

async function main() {
  if (!API_KEY) {
    await sendTelegram('⚠️ Boldstep analysis cycle failed: HERMES_API_KEY not set');
    console.log('⚠️ HERMES_API_KEY not set');
    process.exit(1);
  }

  // Step 1: Get client list from API
  let clients;
  try {
    const result = await apiCall('GET', '/api/clients');
    clients = Array.isArray(result) ? result : (result.clients ?? []);
  } catch (error) {
    const msg = `⚠️ Boldstep analysis cycle failed: ${error.message}`;
    await sendTelegram(msg);
    console.log(msg);
    process.exit(1);
  }

  if (clients.length === 0) {
    // No clients — not an error, just nothing to do
    console.log('ℹ️ No clients found — nothing to analyze');
    process.exit(0);
  }

  // Step 2: Run analysis for each client
  let totalActions = 0;
  let errors = [];

  for (const client of clients) {
    try {
      const result = await apiCall('POST', '/api/hermes/run', { client_id: client.id });
      const filed = result.filed_count ?? 0;
      totalActions += filed;
      console.log(`✓ ${client.name}: ${filed} actions filed (model: ${result.model ?? '?'})`);
    } catch (error) {
      errors.push(`${client.name}: ${error.message}`);
      console.log(`✗ ${client.name}: ${error.message}`);
    }
  }

  // Step 3: Summary + Telegram
  if (errors.length > 0) {
    const msg = `⚠️ Boldstep analysis cycle: ${clients.length} clients, ${totalActions} actions filed, ${errors.length} errors:\n${errors.join('\n')}`;
    await sendTelegram(msg);
    console.log(msg);
  } else if (totalActions > 0) {
    const msg = `✅ Boldstep cycle complete: ${clients.length} clients analyzed, ${totalActions} actions filed`;
    await sendTelegram(msg);
    console.log(msg);
  } else {
    // All clear — silent on Telegram
    console.log(`✅ Boldstep cycle complete: ${clients.length} clients analyzed, 0 actions filed (all clear)`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Analysis cycle failed:', err);
  sendTelegram(`🔴 Boldstep analysis cycle crashed: ${err.message}`).finally(() => process.exit(1));
});
