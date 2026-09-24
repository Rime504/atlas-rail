'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken } from './api';
import { useAuth } from './auth-context';
import type { AgentDecisionView, ApprovalView } from './agent-types';

/* ------------------------------------------------------------------------------------------- */
/* Pending-approvals badge                                                                       */
/* ------------------------------------------------------------------------------------------- */

const PendingContext = createContext<{ pending: number; refresh: () => void }>({
  pending: 0,
  refresh: () => undefined,
});

export function PendingApprovalsProvider({
  children,
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
}) {
  const [pending, setPending] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) return;
    api
      .get<ApprovalView[]>('/v1/agent/approvals?status=PENDING&limit=100')
      .then((rows) => setPending(rows.length))
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  return <PendingContext.Provider value={{ pending, refresh }}>{children}</PendingContext.Provider>;
}

export function usePendingApprovals() {
  return useContext(PendingContext);
}

/* ------------------------------------------------------------------------------------------- */
/* Live decision stream (SSE over fetch so the Bearer header can be sent)                        */
/* ------------------------------------------------------------------------------------------- */

export type StreamState = 'connecting' | 'live' | 'reconnecting';

interface StreamHandlers {
  decision: (d: AgentDecisionView) => void;
  approvals?: (pending: number) => void;
  state: (s: StreamState) => void;
}

/** Reads an SSE response body, dispatching each complete event. Resolves when the stream ends. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) onEvent(event, dataLines.join('\n'));
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/**
 * Subscribes to /v1/agent/decisions/stream with automatic reconnection (exponential backoff, capped).
 * The server replays the latest decisions on connect, so reconnects are idempotent: callers dedupe by id.
 */
export function useDecisionStream(handlers: StreamHandlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let attempt = 0;

    const run = async () => {
      while (!controller.signal.aborted) {
        ref.current.state(attempt === 0 ? 'connecting' : 'reconnecting');
        try {
          const token = getToken();
          const res = await fetch(`${api.baseUrl}/v1/agent/decisions/stream`, {
            headers: {
              accept: 'text/event-stream',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!res.ok || !res.body) throw new Error(`stream responded ${res.status}`);
          attempt = 0;
          await readEventStream(res.body, (event, data) => {
            try {
              if (event === 'ready') ref.current.state('live');
              else if (event === 'decision')
                ref.current.decision(JSON.parse(data) as AgentDecisionView);
              else if (event === 'approvals')
                ref.current.approvals?.((JSON.parse(data) as { pending: number }).pending);
            } catch {
              // a malformed frame must not tear the stream down
            }
          });
        } catch {
          if (controller.signal.aborted) return;
        }
        if (controller.signal.aborted) return;
        attempt += 1;
        ref.current.state('reconnecting');
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000)),
        );
      }
    };
    void run();
    return () => controller.abort();
  }, [enabled]);
}

/** Ticks once a second so countdowns re-render. Returns unix seconds. */
export function useNowSeconds(): number {
  const { user } = useAuth();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [user]);
  return now;
}
