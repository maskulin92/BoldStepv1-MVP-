import { ok, parseJson, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireOwner } from '@/lib/api-auth';
import { getClient, listCampaigns, listInsights } from '@/lib/firestore';
import { buildAnalysisContext, chat, type ChatTurn } from '@/lib/glm-client';
import { defaultDateRange } from '@/lib/utils';
import { hermesChatSchema, validate } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/hermes/chat  { message, client_id?, history? }
 *
 * Loads the last 14 days for the selected client, compacts it into a context
 * block and asks GLM (or Claude, or the local mock) about it.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireOwner(request);
  enforceRateLimit(request, caller, 40, 'hermes-chat');

  const { message, client_id, history } = validate(hermesChatSchema, await parseJson(request));

  let context: string | undefined;
  if (client_id) {
    const client = await getClient(client_id);
    if (client) {
      const range = defaultDateRange(14);
      const [campaigns, insights] = await Promise.all([
        listCampaigns(client_id),
        listInsights(client_id, range.start, range.end),
      ]);
      context = buildAnalysisContext({ clientName: client.name, campaigns, insights });
    }
  }

  const turns: ChatTurn[] = (history ?? []).map((turn) => ({
    role: turn.role === 'hermes' ? 'assistant' : 'user',
    content: turn.content,
  }));

  const reply = await chat({ message, context, history: turns });

  return ok({
    response: reply.response,
    model: reply.model,
    is_mock: reply.is_mock,
    suggestions: reply.suggestions,
    timestamp: new Date().toISOString(),
  });
});
