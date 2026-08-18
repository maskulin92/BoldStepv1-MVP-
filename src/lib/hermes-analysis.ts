import 'server-only';
import { chat } from './glm-client';
import type { ActionType } from '@/types';

/**
 * Server-side "Run Now" analysis, shared by POST /api/hermes/run.
 *
 * Kept separate from the standalone agent (hermes/agent.mjs) because that
 * runs as its own Node process against the REST API, while this runs inline
 * in Next.js. Both ultimately file suggestions through the same
 * POST /api/approvals endpoint, so the outcome is identical.
 */

export interface RunSuggestion {
  action_type: ActionType;
  campaign_id: string;
  suggestion_text: string;
  reason: string;
  confidence: number;
  current_cpl?: number;
  performance_change?: number;
}

const SUGGESTION_PROMPT = `Analyse the campaign data above and propose interventions. Reply with ONLY a JSON object (no markdown fences, no prose) of the form:
{"actions":[{"action_type":"pause|resume|budget_change|analysis|rotate|optimize","campaign_id":"...","suggestion_text":"short imperative","reason":"why, tied to numbers","confidence":0,"current_cpl":0,"performance_change":0}]}
Rules: pause when CPL is climbing hard (>=40%), budget_change when CPL improved (scale 20-25%), rotate when CTR fell >=25% while CPL held, optimize for mild CPL creep (15-40%). confidence is 0-100 (below 55 = speculative). Never invent campaign ids or numbers. If nothing warrants action, return {"actions":[]}.`;

/**
 * Runs the analysis and files suggestions via the caller-provided file()
 * callback (so the route controls auth, dedupe and notification).
 */
export async function runAnalysis(options: {
  clientName: string;
  context: string;
  onFile: (suggestion: RunSuggestion) => Promise<void>;
}): Promise<{ filed: number; model: string }> {
  const reply = await chat({ message: SUGGESTION_PROMPT, context: options.context });

  let actions = parseSuggestions(reply.response);
  let model = reply.model;

  // In mock mode (no GLM/Claude key) or an unparseable reply, fall back to a
  // deterministic heuristic so "Run Now" always produces something sane.
  if (reply.is_mock || actions === null) {
    actions = heuristicSuggestions(options.context);
    model = 'heuristic';
  }

  let filed = 0;
  for (const action of actions) {
    await options.onFile(action);
    filed += 1;
  }
  return { filed, model };
}

function parseSuggestions(text: string): RunSuggestion[] | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : null;
    if (!actions) return null;
    return actions.map((a: Record<string, unknown>) => ({
      action_type: (a.action_type as ActionType) ?? 'analysis',
      campaign_id: String(a.campaign_id ?? ''),
      suggestion_text: String(a.suggestion_text ?? '').slice(0, 200),
      reason: String(a.reason ?? '').slice(0, 500),
      confidence: clamp(Number(a.confidence ?? 70)),
      current_cpl: typeof a.current_cpl === 'number' ? a.current_cpl : undefined,
      performance_change:
        typeof a.performance_change === 'number' ? a.performance_change : undefined,
    }));
  } catch {
    return null;
  }
}

function heuristicSuggestions(context: string): RunSuggestion[] {
  const actions: RunSuggestion[] = [];
  for (const line of context.split('\n')) {
    // Matches the per-campaign line shape from buildAnalysisContext.
    const cpl = line.match(/CPL ([\d.]+)$/);
    const budget = line.match(/budget ([\d.]+)\/day/);
    if (!cpl) continue;
    // buildAnalysisContext gives campaign names, not ids — map back via the
    // leading slug. Heuristic here is intentionally conservative (analysis
    // only) because we lack the id on this compact line shape.
    const name = line.match(/^- (.+?) \[/);
    if (!name) continue;
    const cplValue = Number(cpl[1]);
    if (!Number.isFinite(cplValue) || cplValue <= 0) continue;
    actions.push({
      action_type: 'analysis',
      campaign_id: name[1].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      suggestion_text: `Review ${name[1]} — CPL is ${cplValue}`,
      reason: `CPL currently ${cplValue} RM${budget ? ` on a ${budget[1]} RM/day budget` : ''}. Manual review recommended before any change.`,
      confidence: 50,
      current_cpl: cplValue,
    });
  }
  return actions.slice(0, 5);
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
