import 'server-only';
import { env } from './env';
import { formatCurrency } from './utils';
import type { PendingAction } from '@/types';

/**
 * Telegram Bot notifications (free tier of the stack).
 *
 * Unconfigured, it logs the exact message it would have sent — that keeps the
 * approval flow observable during local testing without a bot token.
 */

export interface NotifyResult {
  sent: boolean;
  mode: 'live' | 'mock';
  message: string;
  error?: string;
}

export async function sendTelegramMessage(text: string): Promise<NotifyResult> {
  if (!env.telegram.isConfigured) {
    console.info('[boldstep:telegram:MOCK]\n' + text);
    return { sent: false, mode: 'mock', message: text };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.telegram.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error('[boldstep:telegram] send failed:', detail);
      return { sent: false, mode: 'live', message: text, error: detail };
    }
    return { sent: true, mode: 'live', message: text };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('[boldstep:telegram] send failed:', detail);
    return { sent: false, mode: 'live', message: text, error: detail };
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Hermes suggests X — approve here" — step 2 of the approval workflow. */
export async function notifyPendingAction(action: PendingAction): Promise<NotifyResult> {
  // Deep link into Section B of the owner dashboard with this action highlighted.
  const approvalUrl = `${env.appUrl}/dashboard?action=${encodeURIComponent(action.id)}`;
  const metadataLines = [
    action.metadata.current_cpl !== undefined
      ? `Current CPL: ${formatCurrency(Number(action.metadata.current_cpl))}`
      : null,
    action.metadata.target_cpl !== undefined
      ? `Target CPL: ${formatCurrency(Number(action.metadata.target_cpl))}`
      : null,
    action.metadata.performance_change !== undefined
      ? `Change: ${action.metadata.performance_change}%`
      : null,
  ].filter(Boolean);

  const text = [
    '<b>Boldstep — approval needed</b>',
    '',
    `<b>${escapeHtml(action.client_name)}</b> · ${escapeHtml(action.campaign_name)}`,
    `<b>${escapeHtml(action.suggestion_text)}</b>`,
    '',
    escapeHtml(action.reason),
    ...(metadataLines.length ? ['', ...metadataLines.map((l) => escapeHtml(l!))] : []),
    '',
    `Review: ${approvalUrl}`,
  ].join('\n');

  return sendTelegramMessage(text);
}

export async function notifyExecution(
  action: PendingAction,
  ok: boolean,
  detail: string,
): Promise<NotifyResult> {
  const text = [
    `<b>Boldstep — ${ok ? 'executed' : 'execution failed'}</b>`,
    '',
    `${escapeHtml(action.client_name)} · ${escapeHtml(action.campaign_name)}`,
    escapeHtml(action.suggestion_text),
    '',
    escapeHtml(detail),
  ].join('\n');

  return sendTelegramMessage(text);
}
