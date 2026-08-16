'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, User } from 'lucide-react';
import { API } from '@/constants/api-endpoints';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { InlineNotice } from '@/components/common/States';
import { cn } from '@/lib/utils';
import type { HermesChatMessage, PublicClient } from '@/types';

interface ChatResponse {
  response: string;
  model: string;
  is_mock: boolean;
  suggestions: string[];
  timestamp: string;
}

const STARTERS = [
  'Which campaign has the worst CPL this week?',
  'Summarise the last 7 days',
  'Should I scale anything right now?',
];

export default function HermesChat({
  clients,
  defaultClientId,
}: {
  clients: PublicClient[];
  defaultClientId?: string | null;
}) {
  const [clientId, setClientId] = useState<string>(defaultClientId ?? clients[0]?.id ?? '');
  const [messages, setMessages] = useState<HermesChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;

    const userTurn: HermesChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    // Snapshot history before appending, so the model doesn't see the new turn twice.
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userTurn]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const reply = await apiPost<ChatResponse>(API.hermes.chat, {
        message,
        client_id: clientId || undefined,
        history,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `h-${Date.now()}`,
          role: 'hermes',
          content: reply.response,
          timestamp: reply.timestamp,
          is_mock: reply.is_mock,
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Hermes did not respond.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card flex h-[560px] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cream-100/10 text-cream-100/70">
            <Bot className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-cream-100">Hermes</p>
            <p className="text-xs text-cream-100/45">Ask about any client&apos;s performance</p>
          </div>
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-cream-100/50">
          <span className="sr-only sm:not-sr-only">Context</span>
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="text-sm"
          >
            <option value="">No client context</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Bot className="mb-3 h-8 w-8 text-cream-100/25" aria-hidden />
            <p className="text-sm text-cream-100/60">
              Hermes reads the last 14 days for the selected client.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="rounded-full border border-surface-border px-3 py-1.5 text-xs text-cream-100/70 transition hover:border-cream-100/30 hover:text-cream-100"
                  onClick={() => void send(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn('flex gap-3', message.role === 'user' && 'flex-row-reverse')}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  message.role === 'user'
                    ? 'bg-cream-100 text-navy-900'
                    : 'bg-cream-100/10 text-cream-100/70',
                )}
              >
                {message.role === 'user' ? (
                  <User className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                )}
              </span>

              <div
                className={cn(
                  'max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                  message.role === 'user'
                    ? 'bg-cream-100 text-navy-900'
                    : 'border border-surface-border bg-navy-950/50 text-cream-100/90',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          ))
        )}

        {sending ? (
          <div className="flex gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cream-100/10 text-cream-100/70">
              <Bot className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="rounded-xl border border-surface-border bg-navy-950/50 px-3.5 py-2.5">
              <LoadingSpinner size="sm" label="Thinking…" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-surface-border p-3">
        {error ? (
          <InlineNotice tone="danger" className="mb-2">
            {error}
          </InlineNotice>
        ) : null}

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Hermes about a campaign…"
            className="min-w-0 flex-1"
            disabled={sending}
            aria-label="Message to Hermes"
          />
          <button type="submit" className="btn-primary" disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>
    </section>
  );
}
