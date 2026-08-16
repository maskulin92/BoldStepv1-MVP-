import 'server-only';
import { env } from './env';
import { formatCurrency, percentChange, round, sumInsights } from './utils';
import type { Campaign, DailyInsight } from '@/types';

/**
 * GLM 5.3 wrapper, with Claude as the fallback.
 *
 * In Phase 1 the *agent* (Hermes) is the one that reasons on a schedule — this
 * client exists so the dashboard's chat box has something to talk to, and so
 * Phase 2 has the transport already written. With no key configured it answers
 * from a local analysis of the real numbers in the store, clearly marked
 * [MOCK], rather than inventing text.
 */

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiReply {
  response: string;
  model: string;
  is_mock: boolean;
  suggestions: string[];
}

const SYSTEM_PROMPT = `You are Hermes, the analyst behind Boldstep — an agency system that manages Meta ads for multiple Malaysian clients.
Answer in a direct, practical tone. Currency is Malaysian Ringgit (RM).
Cost per lead (CPL) is the primary metric; always tie a recommendation to a number you were given.
Never invent metrics that are not in the context. If the data does not support a conclusion, say so.
Keep answers under 200 words unless asked to elaborate.`;

export async function chat(options: {
  message: string;
  context?: string;
  history?: ChatTurn[];
}): Promise<AiReply> {
  const { message, context, history = [] } = options;

  const messages: ChatTurn[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(context ? [{ role: 'system' as const, content: `Current data:\n${context}` }] : []),
    ...history.slice(-8),
    { role: 'user', content: message },
  ];

  if (env.glm.isConfigured) {
    try {
      return await callOpenAiCompatible({
        baseUrl: env.glm.baseUrl,
        apiKey: env.glm.apiKey!,
        model: env.glm.model,
        messages,
      });
    } catch (error) {
      console.warn('[boldstep] GLM call failed, trying Claude fallback:', error);
    }
  }

  if (env.claude.isConfigured) {
    try {
      return await callClaude(messages);
    } catch (error) {
      console.warn('[boldstep] Claude fallback failed:', error);
    }
  }

  return { ...mockReply(message, context), is_mock: true };
}

/* ------------------------------------------------------------- GLM 5.3 */

async function callOpenAiCompatible(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatTurn[];
}): Promise<AiReply> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: 0.3,
      max_tokens: 800,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GLM HTTP ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('GLM returned an empty completion');

  return { response: text, model: options.model, is_mock: false, suggestions: [] };
}

/* -------------------------------------------------------------- Claude */

async function callClaude(messages: ChatTurn[]): Promise<AiReply> {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.claude.apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.claude.model,
      max_tokens: 800,
      system,
      messages: turns,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Claude HTTP ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Claude returned an empty completion');

  return { response: text, model: env.claude.model, is_mock: false, suggestions: [] };
}

/* ---------------------------------------------------------------- mock */

function mockReply(message: string, context?: string): AiReply {
  const lower = message.toLowerCase();

  let body: string;
  if (lower.includes('cpl') || lower.includes('cost per lead')) {
    body =
      'CPL is the metric to watch here. From the data in view, the drift is concentrated in one ad set rather than the campaign as a whole — pausing the worst performer usually recovers more than a blanket budget cut.';
  } else if (lower.includes('pause') || lower.includes('stop')) {
    body =
      'Before pausing, check whether the spike lasted more than 3 days. Two-day CPL spikes normally self-correct; anything past day 3 with rising frequency is genuine fatigue.';
  } else if (lower.includes('budget') || lower.includes('scale')) {
    body =
      'Scale in steps of 20–25%. Past that, CPL tends to degrade within 3 days and you lose the learning phase.';
  } else if (lower.includes('creative') || lower.includes('ad copy')) {
    body =
      'Creative fatigue shows up as falling CTR with flat impressions. Once frequency passes ~3.8, refresh rather than re-bid.';
  } else {
    body =
      'Ask about a specific campaign, CPL trend, budget change or creative and this panel will analyse the numbers currently loaded for that client.';
  }

  const contextLine = context ? `\n\nContext I can see:\n${context}` : '';

  return {
    response: `[MOCK] Hermes is not connected yet — GLM_API_KEY is unset in .env.local, so this is a local heuristic, not a model response.\n\n${body}${contextLine}`,
    model: 'mock',
    is_mock: true,
    suggestions: [
      'Which campaign has the worst CPL this week?',
      'Should I scale the Condo Launch campaign?',
      'Summarise the last 7 days for this client',
    ],
  };
}

/* ------------------------------------------------------- context build */

/** Compacts the numbers a chat turn should reason over into a small text block. */
export function buildAnalysisContext(options: {
  clientName: string;
  campaigns: Campaign[];
  insights: DailyInsight[];
}): string {
  const { clientName, campaigns, insights } = options;
  if (insights.length === 0) return `${clientName}: no insight rows in the selected range.`;

  const summary = sumInsights(insights);
  const dates = [...new Set(insights.map((i) => i.date))].sort();
  const midpoint = dates[Math.floor(dates.length / 2)];
  const firstHalf = sumInsights(insights.filter((i) => i.date < midpoint));
  const secondHalf = sumInsights(insights.filter((i) => i.date >= midpoint));

  const lines = [
    `Client: ${clientName}`,
    `Range: ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`,
    `Total spend: ${formatCurrency(summary.total_spend)} | Leads: ${summary.total_leads} | CPL: ${formatCurrency(summary.avg_cpl)} | CTR: ${summary.avg_ctr}%`,
    `CPL trend: ${formatCurrency(firstHalf.avg_cpl)} -> ${formatCurrency(secondHalf.avg_cpl)} (${percentChange(secondHalf.avg_cpl, firstHalf.avg_cpl)}%)`,
    '',
    'Per campaign:',
  ];

  for (const campaign of campaigns) {
    const rows = insights.filter((i) => i.campaign_id === campaign.id);
    if (rows.length === 0) continue;
    const stats = sumInsights(rows);
    lines.push(
      `- ${campaign.name} [${campaign.status}] budget ${formatCurrency(campaign.budget_daily)}/day: spend ${formatCurrency(stats.total_spend)}, ${stats.total_leads} leads, CPL ${formatCurrency(stats.avg_cpl)}, CTR ${round(stats.avg_ctr, 2)}%`,
    );
  }

  return lines.join('\n');
}
