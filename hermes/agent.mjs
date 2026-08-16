/**
 * Hermes Agent — the background automation process from the brief.
 *
 * A standalone Node.js process, separate from the Next.js app. It talks to the
 * app exclusively through its REST API (API-first), authenticating with
 * HERMES_API_KEY. Every cycle it:
 *
 *   1. pulls fresh Meta insights for each client   -> POST /api/meta/sync
 *   2. asks the model to analyse the numbers        -> GLM 5.3, heuristic fallback
 *   3. files worthwhile suggestions as approvals    -> POST /api/approvals
 *   4. (optionally) auto-executes them               -> POST /api/hermes/execute
 *
 * Nothing here touches Firestore directly — the app remains the single source
 * of truth, and the same endpoints serve the dashboard, integrations and this
 * agent.
 *
 * Run:            node hermes/agent.mjs
 * Run one cycle:  node hermes/agent.mjs --once
 * Env:            BOLDSTEP_API_URL, HERMES_API_KEY, HERMES_INTERVAL_HOURS
 */

const API_URL = (process.env.BOLDSTEP_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.HERMES_API_KEY ?? '';
const INTERVAL_HOURS = Number(process.env.HERMES_INTERVAL_HOURS ?? 0);

const FREQUENCY_HOURS = { '6h': 6, '12h': 12, '24h': 24 };

const ANALYSIS_PROMPT = `You are the analysis core of Hermes, the agent behind Boldstep (Malaysian Meta ads agency system).
You receive per-campaign performance context. Decide whether any campaign needs intervention.

Reply ONLY with a JSON object (no markdown fences, no prose):
{"summary":"one or two sentences","actions":[{"action_type":"pause|resume|budget_change|analysis","campaign_id":"...","suggestion_text":"short imperative","reason":"why, tied to numbers","current_cpl":number,"target_cpl":number,"performance_change":number,"proposed_budget":number}]}

Rules:
- Suggest an action ONLY when the data clearly supports it (CPL drifting up across the range, spend with no leads, a campaign far above the client average).
- A 2-day CPL bump is noise; require a sustained trend before suggesting pause.
- budget_change: propose at most a 20-25% change from the current budget.
- No action warranted -> "actions":[] and explain in the summary.
- Never invent campaign ids or numbers; use only what is in the context.`;

main();

async function main() {
  const once = process.argv.includes('--once');

  if (!API_KEY) {
    console.error('[hermes] HERMES_API_KEY is not set. Generate one: node -e "console.log(\'boldstep_sk_\' + require(\'crypto\').randomBytes(24).toString(\'hex\'))" and set it in both .env.local (app) and the agent environment.');
    process.exit(1);
  }

  console.log(`[hermes] agent starting — API at ${API_URL}, mode: ${once ? 'single cycle' : 'scheduled'}`);

  if (once) {
    await runCycle();
    return;
  }

  let timer = null;
  const tick = async () => {
    try {
      await runCycle();
    } catch (error) {
      console.error('[hermes] cycle failed:', error?.message ?? error);
    }
    const nextMs = intervalMs();
    console.log(`[hermes] next cycle in ${Math.round(nextMs / 3_600_000 * 10) / 10}h`);
    timer = setTimeout(tick, nextMs);
    timer.unref?.();
  };
  await tick();
}

/** Honours the frequency set in the dashboard's Hermes settings; env overrides. */
async function intervalMs() {
  if (INTERVAL_HOURS > 0) return INTERVAL_HOURS * 3_600_000;
  try {
    const settings = await api('GET', '/api/hermes/settings');
    const hours = FREQUENCY_HOURS[settings?.frequency] ?? 24;
    return hours * 3_600_000;
  } catch {
    return 24 * 3_600_000;
  }
}

async function runCycle() {
  console.log(`[hermes] cycle start — ${new Date().toISOString()}`);

  const settings = await api('GET', '/api/hermes/settings');
  const result = await api('GET', '/api/clients');
  const clients = Array.isArray(result) ? result : (result.clients ?? []);

  console.log(`[hermes] ${clients.length} client(s), frequency=${settings?.frequency}, auto_execute=${settings?.auto_execute}`);

  for (const client of clients) {
    try {
      await analyseClient(client, settings);
    } catch (error) {
      console.error(`[hermes] ${client.id}: ${error?.message ?? error}`);
    }
  }

  console.log(`[hermes] cycle done — ${new Date().toISOString()}`);
}

async function analyseClient(client, settings) {
  const monitored = settings?.monitored_campaigns ?? 'all';

  const sync = await api('POST', '/api/meta/sync', { client_id: client.id });
  console.log(`[hermes] ${client.id}: synced ${sync.records_updated} rows (${sync.mode})`);

  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 86_400_000);
  const insights = await api(
    'GET',
    `/api/meta/insights/${client.id}?startDate=${rangeStart.toISOString().slice(0, 10)}&endDate=${rangeEnd.toISOString().slice(0, 10)}`,
  );

  const context = buildContext(client, insights, monitored);

  const model = await callModel(context);
  console.log(`[hermes] ${client.id}: model=${model.model}, actions_proposed=${model.actions.length}`);

  for (const action of model.actions) {
    if (monitored !== 'all' && !monitored.includes(action.campaign_id)) {
      console.log(`[hermes] ${client.id}: skipped ${action.campaign_id} (not monitored)`);
      continue;
    }

    const created = await api('POST', '/api/approvals', {
      client_id: client.id,
      campaign_id: action.campaign_id,
      from_model: model.from_model,
      action_type: action.action_type,
      suggestion_text: action.suggestion_text,
      reason: action.reason,
      metadata: {
        current_cpl: action.current_cpl,
        target_cpl: action.target_cpl,
        performance_change: action.performance_change,
        current_budget: action.current_budget,
        proposed_budget: action.proposed_budget,
      },
    });
    console.log(`[hermes] ${client.id}: filed ${created.action.id} (${action.action_type}) ${action.suggestion_text}`);

    if (settings?.auto_execute) {
      try {
        const executed = await api('POST', '/api/hermes/execute', {
          action_id: created.action.id,
        });
        console.log(`[hermes] ${client.id}: auto-executed -> ${executed.action.status}`);
      } catch (error) {
        console.error(`[hermes] ${client.id}: auto-execute refused: ${error?.message ?? error}`);
      }
    }
  }
}

/* ---------------------------------------------------------------- context */

function buildContext(client, insightsPayload, monitored) {
  const rows = Array.isArray(insightsPayload)
    ? insightsPayload
    : (insightsPayload?.insights ?? []);
  const byCampaign = new Map();
  for (const row of rows) {
    if (monitored !== 'all' && !monitored.includes(row.campaign_id)) continue;
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }

  const lines = [
    `Client: ${client.name} (goal: ${client.primary_goal})`,
    `Window: last 7 days, ${rows.length} rows`,
    '',
    'Per campaign (spend, leads, CPL first half -> second half of window):',
  ];

  for (const [campaignId, rows] of byCampaign) {
    const totals = rows.reduce(
      (acc, r) => ({
        spend: acc.spend + (r.spend ?? 0),
        leads: acc.leads + (r.leads ?? 0),
      }),
      { spend: 0, leads: 0 },
    );
    const midpoint = rows[Math.floor(rows.length / 2)]?.date;
    const older = rows.filter((r) => r.date < midpoint);
    const newer = rows.filter((r) => r.date >= midpoint);
    const cplOf = (list) =>
      list.reduce((a, r) => a + (r.spend ?? 0), 0) /
      Math.max(1, list.reduce((a, r) => a + (r.leads ?? 0), 0));
    lines.push(
      `- ${campaignId}: spend ${round2(totals.spend)} RM, leads ${totals.leads}, CPL ${round2(cplOf(older))} -> ${round2(cplOf(newer))} RM`,
    );
  }

  if (byCampaign.size === 0) lines.push('(no insight rows)');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ model */

async function callModel(context) {
  const glmKey = process.env.GLM_API_KEY;
  const glmBase = process.env.GLM_API_BASE ?? 'https://api.z.ai/api/paas/v4';
  const glmModel = process.env.GLM_MODEL ?? 'glm-5.2';

  if (glmKey) {
    try {
      const response = await fetch(`${glmBase.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${glmKey}` },
        body: JSON.stringify({
          model: glmModel,
          temperature: 0.2,
          max_tokens: 900,
          messages: [
            { role: 'system', content: ANALYSIS_PROMPT },
            { role: 'user', content: context },
          ],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const text = body.choices?.[0]?.message?.content?.trim();
      const parsed = parseModelJson(text);
      return { ...parsed, model: glmModel, from_model: 'glm' };
    } catch (error) {
      console.warn(`[hermes] GLM failed (${error.message}); falling back to heuristic`);
    }
  }

  return { ...heuristic(context), model: 'heuristic', from_model: 'glm' };
}

function parseModelJson(text) {
  if (!text) return { summary: 'empty model reply', actions: [] };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { summary: 'unparseable model reply', actions: [] };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      summary: String(parsed.summary ?? ''),
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    return { summary: 'unparseable model reply', actions: [] };
  }
}

/** Deterministic local analysis so the agent works without a GLM key. */
function heuristic(context) {
  const actions = [];
  const lines = context.split('\n');

  for (const line of lines) {
    const match = line.match(/^- ([a-z0-9-]+): spend ([\d.]+) RM, leads (\d+), CPL ([\d.]+) -> ([\d.]+) RM$/);
    if (!match) continue;
    const [, campaignId, , , cplBefore, cplAfter] = match;
    const before = Number(cplBefore);
    const after = Number(cplAfter);
    if (!before || !after) continue;

    const change = ((after - before) / before) * 100;

    if (change >= 40) {
      actions.push({
        action_type: 'pause',
        campaign_id: campaignId,
        suggestion_text: `Pause ${campaignId} — CPL up ${Math.round(change)}% this week`,
        reason: `CPL moved from ${before.toFixed(2)} to ${after.toFixed(2)} RM (+${Math.round(change)}%) across the window. Sustained drift, not a one-day spike.`,
        current_cpl: after,
        performance_change: Math.round(change * 10) / 10,
      });
    } else if (change <= -25) {
      actions.push({
        action_type: 'budget_change',
        campaign_id: campaignId,
        suggestion_text: `Scale ${campaignId} by 20% — CPL down ${Math.round(-change)}%`,
        reason: `CPL improved from ${before.toFixed(2)} to ${after.toFixed(2)} RM (-${Math.round(-change)}%). Room to scale within the 20-25% safety band.`,
        current_cpl: after,
        performance_change: Math.round(change * 10) / 10,
        proposed_budget: null,
      });
    }
  }

  return {
    summary:
      actions.length === 0
        ? 'No campaigns crossed the intervention thresholds this cycle.'
        : `${actions.length} campaign(s) crossed intervention thresholds.`,
    actions,
  };
}

/* -------------------------------------------------------------------- api */

async function api(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.success === false) {
    const detail = json?.error?.code
      ? `${json.error.code}: ${json.error.message}`
      : `HTTP ${response.status}`;
    throw new Error(`${method} ${path} -> ${detail}`);
  }
  return json.data ?? json;
}

const round2 = (value) => Math.round(value * 100) / 100;
