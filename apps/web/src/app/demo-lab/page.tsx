'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Ban,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { useDemoRun, useDecisionStream, usePendingApprovals, type DemoStatus, type StreamState } from '../../lib/agent-hooks';
import { Card, EmptyState, PageHeader } from '../../components/ui';
import { DecisionRow } from '../../components/agent/Bits';
import type { AgentDecisionView } from '../../lib/agent-types';

interface SceneDef {
  n: number;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}

const SCENES: SceneDef[] = [
  { n: 1, name: 'Grant', icon: ShieldCheck, blurb: 'Owner + approver sign a mandate for the Research Agent.' },
  { n: 2, name: 'Pay', icon: CheckCircle2, blurb: 'A $0.01 research purchase, allowed within the mandate.' },
  { n: 3, name: 'Attack', icon: Ban, blurb: 'A prompt-injected page tries to drain 500 USDC. The gate stops it.' },
  { n: 4, name: 'Escalate', icon: UserCheck, blurb: 'A $40 job needs a human. Approve it on the Approvals page.' },
  { n: 5, name: 'Prove', icon: ShieldCheck, blurb: 'Anchors receipts and runs atlas verify, fully offline.' },
  { n: 6, name: 'Revoke', icon: Ban, blurb: 'The owner revokes the mandate; the next payment is denied.' },
];

function LineColor(text: string): string {
  const t = text.trimStart();
  if (t.startsWith('✔')) return 'text-emerald-400';
  if (t.startsWith('✖')) return 'text-rose-400';
  if (t.startsWith('▸')) return 'text-solana-purple';
  if (/^SCENE\s+\d+/.test(t)) return 'text-white font-bold';
  if (/^━+$/.test(t)) return 'text-slate-700';
  return 'text-slate-400';
}

export default function DemoLabPage() {
  const { data: status, refetch: refetchStatus } = useApi<DemoStatus>('/v1/agent/demo/status');
  const { running, lines, currentScene, result, start, stop } = useDemoRun();
  const { refresh: refreshPending } = usePendingApprovals();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [pendingScenes, setPendingScenes] = useState<number[] | 'all' | null>(null);

  const [liveDecisions, setLiveDecisions] = useState<AgentDecisionView[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  useDecisionStream(
    {
      decision: (d) => setLiveDecisions((prev) => (prev.some((x) => x.id === d.id) ? prev : [d, ...prev].slice(0, 8))),
      state: setStreamState,
    },
    true,
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (!running && result) {
      refetchStatus();
      refreshPending();
    }
  }, [running, result, refetchStatus, refreshPending]);

  const run = useCallback(
    (scenes: number[] | 'all') => {
      setPendingScenes(scenes);
      void start({ scenes: scenes === 'all' ? undefined : scenes, autoApprove }).finally(() => setPendingScenes(null));
    },
    [start, autoApprove],
  );

  const unavailable = status && !status.available;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demo Lab"
        description="Run the scripted agent from the browser — no terminal. Each button is the exact same scene pnpm demo runs, against this organisation's real mandate."
      />

      {unavailable && (
        <Card className="border-amber-500/25 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <p className="text-sm text-slate-300">
              Demo Lab isn&rsquo;t available on this server. It only runs under the demo orchestrator (
              <code className="font-mono text-xs">pnpm demo</code> / <code className="font-mono text-xs">pnpm demo:offline</code>), which is what
              builds and wires up the scripted agent this page drives.
            </p>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              disabled={running}
              className="h-4 w-4 rounded border-white/20 bg-black/30 accent-solana-purple"
            />
            Auto-approve the escalation (scene 4) instead of waiting for a click on Approvals
          </label>
          <div className="flex items-center gap-2">
            {running && (
              <button type="button" onClick={stop} className="btn-ghost !border-rose-500/30 !text-rose-300">
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={() => run('all')}
              disabled={running || Boolean(unavailable)}
              className="btn-gradient"
            >
              {running && pendingScenes === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run all six
            </button>
            <button
              type="button"
              onClick={() => run([1])}
              disabled={running || Boolean(unavailable)}
              className="btn-ghost"
              title="Grants a fresh mandate, ready for a new run"
            >
              {running && Array.isArray(pendingScenes) && pendingScenes[0] === 1 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Reset demo
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {SCENES.map((s) => {
          const Icon = s.icon;
          const needsMandate = s.n > 1 && status && !status.hasActiveMandate;
          const disabled = running || Boolean(unavailable) || Boolean(needsMandate);
          const isCurrent = currentScene?.number === s.n && running;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => run([s.n])}
              disabled={disabled}
              title={needsMandate ? 'Run Grant first' : s.blurb}
              className={`glass-card flex flex-col items-start gap-2 p-4 text-left transition-all duration-200 ${
                disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-white/[0.16] hover:bg-white/[0.05]'
              } ${isCurrent ? 'border-solana-purple/60 shadow-glow' : ''}`}
            >
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Scene {s.n}
                {isCurrent && <Loader2 className="h-3 w-3 animate-spin text-solana-purple" />}
              </span>
              <span className="flex items-center gap-2 font-display text-sm font-bold text-white">
                <Icon className="h-4 w-4 text-solana-green" />
                {s.name}
              </span>
              <span className="text-xs leading-snug text-mutedText">{s.blurb}</span>
            </button>
          );
        })}
      </div>

      {currentScene && running && (
        <div className="flex items-center gap-2 rounded-lg border border-solana-purple/25 bg-solana-purple/[0.06] px-4 py-2.5 text-sm text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin text-solana-purple" />
          Running scene {currentScene.number}: {currentScene.title}
          {currentScene.number === 4 && !autoApprove && (
            <Link href="/approvals" className="ml-auto text-xs font-semibold text-amber-300 hover:underline">
              Go approve it &rarr;
            </Link>
          )}
        </div>
      )}

      {result && !running && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${
            result.ok ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200' : 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200'
          }`}
        >
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          {result.ok ? 'Finished — every scene behaved as designed.' : `Finished with a non-zero exit code (${result.exitCode}) — see the log below.`}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-3">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">Narration</h2>
          </div>
          <div ref={scrollRef} className="h-[420px] overflow-y-auto bg-black/30 p-4 font-mono text-xs leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-slate-600">Press a scene button above to start. Output streams here live, exactly as it prints in a terminal.</p>
            ) : (
              lines.map((l, i) => (
                <div key={i} className={`whitespace-pre-wrap break-words ${LineColor(l.text)} ${l.stream === 'stderr' ? 'text-rose-400' : ''}`}>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">Live decisions</h2>
            <span className={`text-[10px] font-semibold uppercase ${streamState === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {streamState === 'live' ? '● live' : '○ connecting'}
            </span>
          </div>
          {liveDecisions.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing yet" description="Decisions from a running scene appear here the instant the gate makes them." />
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {liveDecisions.map((d) => (
                <DecisionRow key={d.id} decision={d} fresh />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
