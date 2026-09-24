'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Activity, Ban, CheckCircle2, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { useDecisionStream, type StreamState } from '../../lib/agent-hooks';
import { Card, EmptyState, PageHeader, StatCard } from '../../components/ui';
import { DecisionRow } from '../../components/agent/Bits';
import type { AgentDecisionView, GateDecisionOutcome, MandateView } from '../../lib/agent-types';

type Filter = 'ALL' | GateDecisionOutcome;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ALLOW', label: 'Allowed' },
  { key: 'ESCALATE', label: 'Escalated' },
  { key: 'DENY', label: 'Denied' },
];

const MAX_ROWS = 200;

function StreamPill({ state }: { state: StreamState }) {
  const live = state === 'live';
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        live ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      }`}
      role="status"
    >
      {live ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <Wifi className="h-3.5 w-3.5" /> Live
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5" /> {state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </>
      )}
    </span>
  );
}

export default function DecisionsPage() {
  const { data: mandates } = useApi<MandateView[]>('/v1/agent/mandates');
  const [rows, setRows] = useState<AgentDecisionView[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [state, setState] = useState<StreamState>('connecting');
  const [filter, setFilter] = useState<Filter>('ALL');
  const ready = useRef(false);

  const onState = useCallback((s: StreamState) => {
    if (s !== 'live') ready.current = false;
    else window.setTimeout(() => (ready.current = true), 0);
    setState(s);
  }, []);

  const onDecision = useCallback((d: AgentDecisionView) => {
    setRows((prev) => {
      if (prev.some((r) => r.id === d.id)) return prev;
      return [d, ...prev].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ROWS);
    });
    if (ready.current) {
      setFresh((prev) => new Set(prev).add(d.id));
      window.setTimeout(
        () =>
          setFresh((prev) => {
            const next = new Set(prev);
            next.delete(d.id);
            return next;
          }),
        4000,
      );
    }
  }, []);

  useDecisionStream({ decision: onDecision, state: onState });

  const labels = useMemo(() => new Map((mandates ?? []).map((m) => [m.id, m.mandate.agent.label])), [mandates]);
  const counts = useMemo(
    () => ({
      ALLOW: rows.filter((r) => r.decision === 'ALLOW').length,
      DENY: rows.filter((r) => r.decision === 'DENY').length,
      ESCALATE: rows.filter((r) => r.decision === 'ESCALATE').length,
    }),
    [rows],
  );
  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.decision === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Decisions"
        description="Every payment an agent attempts is judged by the gate. Each row is a signed, replayable record: expand it to see every rule that ran."
        actions={<StreamPill state={state} />}
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard icon={CheckCircle2} label="Allowed" value={counts.ALLOW} accent="green" />
        <StatCard icon={ShieldAlert} label="Escalated" value={counts.ESCALATE} accent="amber" />
        <StatCard icon={Ban} label="Denied" value={counts.DENY} accent="rose" />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter decisions">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filter === f.key
                ? 'border-solana-purple/50 bg-solana-purple/15 text-white'
                : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={state === 'live' ? 'Waiting for the first agent request' : 'Connecting to the decision stream'}
            description={
              state === 'live'
                ? 'Run an agent against a mandate and its allow, deny and escalate decisions will stream in here in real time.'
                : 'This page updates the moment the gate decides a payment.'
            }
          />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {visible.map((d) => (
              <DecisionRow key={d.id} decision={d} fresh={fresh.has(d.id)} agentLabel={labels.get(d.mandateId)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
