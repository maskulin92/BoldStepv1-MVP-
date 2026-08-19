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
{"summary":"one or two sentences","actions":[{"action_type":"pause|resume|budget_change|analysis|rotate|optimize","campaign_id":"...","suggestion_text":"short imperative","reason":"why, tied to numbers","current_cpl":number,"target_cpl":number,"performance_change":number,"proposed_budget":number,"confidence":number}]}

Rules:
- action_type meanings: pause (CPL climbing hard), resume (CPL recovered), budget_change (scale up/down), rotate (creative fatigued — CTR falling while spend holds), optimize (audience/placement tuning), analysis (observation only, no change).
- confidence is 0-100: how sure you are the action will help. Below 60 = speculative; do not file a rotate/optimize below 55 confidence.
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
    // intervalMs() can throw if the settings API is unreachable and the
    // internal try-catch is bypassed (e.g. network error before catch).
    // Without this guard the agent would stop scheduling — silently die —
    // because setTimeout(tick, undefined) never fires. Fall back to 24h
    // so the agent always schedules its next attempt.
    let nextMs;
    try {
      nextMs = await intervalMs();
    } catch (error) {
      console.warn(`[hermes] interval lookup failed: ${error?.message ?? error}, defaulting to 24h`);
      nextMs = 24 * 3_600_000;
    }
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

  // Load learned preferences once per cycle and share across all clients.
  const learning = await loadLearning();

  console.log(`[hermes] ${clients.length} client(s), frequency=${settings?.frequency}, auto_execute=${settings?.auto_execute}, learned=${learning.decisions} decisions`);

  for (const client of clients) {
    try {
      await analyseClient(client, settings, learning);
    } catch (error) {
      console.error(`[hermes] ${client.id}: ${error?.message ?? error}`);
    }
  }

  console.log(`[hermes] cycle done — ${new Date().toISOString()}`);
}

/**
 * Reads approval history and derives per-action-type preference weights.
 * approve +1, modify +0.5, reject -1. Weight nudges confidence up/down so
 * suggestion types Fadhil keeps accepting rise to the top, and ones he
 * rejects sink — without ever crossing the never-auto-execute line.
 */
async function loadLearning() {
  try {
    const memory = await api('GET', '/api/hermes/memory');
    const history = memory.approval_history ?? [];
    const weights = new Map();
    let decisions = 0;

    for (const entry of history) {
      if (!entry.action_type) continue;
      decisions += 1;
      const current = weights.get(entry.action_type) ?? 0;
      if (entry.decision === 'approved') weights.set(entry.action_type, current + 1);
      else if (entry.decision === 'modified') weights.set(entry.action_type, current + 0.5);
      else if (entry.decision === 'rejected') weights.set(entry.action_type, current - 1);
    }

    return { weights, decisions };
  } catch (error) {
    console.warn(`[hermes] learning unavailable: ${error?.message ?? error}`);
    return { weights: new Map(), decisions: 0 };
  }
}

async function analyseClient(client, settings, learning) {
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

  const model = await callModel(context, learning);
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
      confidence: action.confidence,
      metadata: {
        current_cpl: action.current_cpl,
        target_cpl: action.target_cpl,
        performance_change: action.performance_change,
        current_budget: action.current_budget,
        proposed_budget: action.proposed_budget,
      },
    });
    console.log(`[hermes] ${client.id}: filed ${created.action.id} (${action.action_type}, conf ${action.confidence ?? '—'}) ${action.suggestion_text}`);

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
        clicks: acc.clicks + (r.clicks ?? 0),
        impressions: acc.impressions + (r.impressions ?? 0),
      }),
      { spend: 0, leads: 0, clicks: 0, impressions: 0 },
    );
    const midpoint = rows[Math.floor(rows.length / 2)]?.date;
    const older = rows.filter((r) => r.date < midpoint);
    const newer = rows.filter((r) => r.date >= midpoint);
    const cplOf = (list) =>
      list.reduce((a, r) => a + (r.spend ?? 0), 0) /
      Math.max(1, list.reduce((a, r) => a + (r.leads ?? 0), 0));
    const ctrOf = (list) =>
      (list.reduce((a, r) => a + (r.clicks ?? 0), 0) /
        Math.max(1, list.reduce((a, r) => a + (r.impressions ?? 0), 0))) *
      100;
    lines.push(
      `- ${campaignId}: spend ${round2(totals.spend)} RM, leads ${totals.leads}, CPL ${round2(cplOf(older))} -> ${round2(cplOf(newer))} RM, CTR ${round2(ctrOf(older))}% -> ${round2(ctrOf(newer))}%`,
    );
  }

  if (byCampaign.size === 0) lines.push('(no insight rows)');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ model */

async function callModel(context, learning) {
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
      return { ...parsed, actions: applyLearning(parsed.actions, learning), model: glmModel, from_model: 'glm' };
    } catch (error) {
      console.warn(`[hermes] GLM failed (${error.message}); falling back to heuristic`);
    }
  }

  const heuristicResult = heuristic(context);
  return {
    ...heuristicResult,
    actions: applyLearning(heuristicResult.actions, learning),
    model: 'heuristic',
    from_model: 'heuristic',
  };
}

/**
 * Nudges each action's confidence by the learned preference weight for its
 * type. The weight is bounded to +/-15 points so one rejected suggestion
 * cannot over-correct; it ranks, never decides.
 */
function applyLearning(actions, learning) {
  const { weights } = learning;
  return actions.map((action) => {
    const weight = weights?.get(action.action_type) ?? 0;
    const delta = Math.max(-15, Math.min(15, weight * 5));
    const base = typeof action.confidence === 'number' ? action.confidence : 70;
    return { ...action, confidence: Math.max(0, Math.min(100, Math.round(base + delta))) };
  });
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
    const match = line.match(
      /^- ([a-z0-9-]+): spend ([\d.]+) RM, leads (\d+), CPL ([\d.]+) -> ([\d.]+) RM, CTR ([\d.]+)% -> ([\d.]+)%$/,
    );
    if (!match) continue;
    const [, campaignId, , , cplBefore, cplAfter, ctrBefore, ctrAfter] = match;
    const before = Number(cplBefore);
    const after = Number(cplAfter);
    const ctrB = Number(ctrBefore);
    const ctrA = Number(ctrAfter);
    if (!before || !after) continue;

    const change = ((after - before) / before) * 100;
    const ctrDrop = ctrB > 0 ? ((ctrB - ctrA) / ctrB) * 100 : 0;

    if (change >= 40) {
      actions.push({
        action_type: 'pause',
        campaign_id: campaignId,
        suggestion_text: `Pause ${campaignId} — CPL up ${Math.round(change)}% this week`,
        reason: `CPL moved from ${before.toFixed(2)} to ${after.toFixed(2)} RM (+${Math.round(change)}%) across the window. Sustained drift, not a one-day spike.`,
        current_cpl: after,
        performance_change: Math.round(change * 10) / 10,
        confidence: 85,
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
        confidence: 70,
      });
    } else if (ctrDrop >= 25) {
      // CPL roughly stable but CTR collapsing -> creative fatigue.
      actions.push({
        action_type: 'rotate',
        campaign_id: campaignId,
        suggestion_text: `Rotate creative on ${campaignId} — CTR down ${Math.round(ctrDrop)}%`,
        reason: `CTR fell from ${ctrB.toFixed(2)}% to ${ctrA.toFixed(2)}% (-${Math.round(ctrDrop)}%) while CPL held near ${after.toFixed(2)} RM — a sign the current creative is wearing out.`,
        current_cpl: after,
        performance_change: Math.round(ctrDrop * 10) / 10,
        confidence: 60,
      });
    } else if (change >= 15 && change < 40) {
      // Mild CPL creep, not bad enough to pause -> tune audience/placement.
      actions.push({
        action_type: 'optimize',
        campaign_id: campaignId,
        suggestion_text: `Optimize targeting on ${campaignId} — CPL up ${Math.round(change)}%`,
        reason: `CPL rose ${Math.round(change)}% (${before.toFixed(2)} -> ${after.toFixed(2)} RM) but is not yet alarming — review audience and placement before it worsens.`,
        current_cpl: after,
        performance_change: Math.round(change * 10) / 10,
        confidence: 55,
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
