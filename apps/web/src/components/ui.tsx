'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Snowflake,
  Radio,
  FileEdit,
  Archive,
  Copy,
  Check,
} from 'lucide-react';

/* ------------------------------------------------------------------------------------------- */
/* Layout primitives                                                                            */
/* ------------------------------------------------------------------------------------------- */

export function Card({
  className = '',
  hover = false,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={`glass-card ${hover ? 'glass-card-hover' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-mutedText">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h3>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'purple',
  loading = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'purple' | 'green' | 'amber' | 'rose' | 'slate';
  loading?: boolean;
}) {
  const accentMap: Record<string, string> = {
    purple: 'text-solana-purple bg-solana-purple/10',
    green: 'text-solana-green bg-solana-green/10',
    amber: 'text-amber-400 bg-amber-400/10',
    rose: 'text-rose-400 bg-rose-400/10',
    slate: 'text-slate-300 bg-slate-500/10',
  };
  return (
    <Card hover className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentMap[accent]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <div className="skeleton mt-3 h-7 w-28" />
      ) : (
        <div className="font-display mt-2 text-2xl font-bold text-white">{value}</div>
      )}
      {sub && <div className="mt-1 text-xs text-mutedText">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] text-slate-500">
        <Icon className="h-6 w-6" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        {description && <p className="mt-1 max-w-sm text-xs text-mutedText">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function SkeletonRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 p-4">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Status badge                                                                                  */
/* ------------------------------------------------------------------------------------------- */

type BadgeTone = 'green' | 'amber' | 'rose' | 'purple' | 'slate';

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  purple: 'bg-solana-purple/10 text-[#c9a3ff] border-solana-purple/25',
  slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

const STATUS_CONFIG: Record<
  string,
  { label?: string; tone: BadgeTone; icon: React.ComponentType<{ className?: string }> }
> = {
  DRAFT: { tone: 'slate', icon: FileEdit },
  PENDING_APPROVAL: { label: 'PENDING APPROVAL', tone: 'amber', icon: Clock },
  APPROVED: { tone: 'green', icon: CheckCircle2 },
  REJECTED: { tone: 'rose', icon: XCircle },
  QUEUED_FOR_EXECUTION: { label: 'QUEUED', tone: 'purple', icon: Radio },
  SIMULATING: { tone: 'purple', icon: Loader2 },
  SIMULATION_FAILED: { label: 'SIMULATION FAILED', tone: 'rose', icon: AlertTriangle },
  READY_TO_SIGN: { tone: 'purple', icon: ShieldCheck },
  SUBMITTED: { tone: 'purple', icon: Radio },
  CONFIRMED: { tone: 'green', icon: CheckCircle2 },
  FAILED: { tone: 'rose', icon: XCircle },
  CANCELLED: { tone: 'slate', icon: Ban },
  BLOCKED: { tone: 'rose', icon: Ban },
  PENDING: { tone: 'amber', icon: Clock },
  VERIFIED: { tone: 'green', icon: CheckCircle2 },
  ARCHIVED: { tone: 'slate', icon: Archive },
  ACTIVE: { tone: 'green', icon: CheckCircle2 },
  FROZEN: { tone: 'rose', icon: Snowflake },
  DISABLED: { tone: 'slate', icon: Ban },
  DELIVERED: { tone: 'green', icon: CheckCircle2 },
  LOW: { tone: 'green', icon: CheckCircle2 },
  MEDIUM: { tone: 'amber', icon: AlertTriangle },
  HIGH: { tone: 'rose', icon: AlertTriangle },
  CRITICAL: { tone: 'rose', icon: AlertTriangle },
  ALLOW: { tone: 'green', icon: CheckCircle2 },
  REQUIRE_APPROVAL: { label: 'REQUIRES APPROVAL', tone: 'amber', icon: Clock },
  BLOCK: { tone: 'rose', icon: Ban },
};

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const config = STATUS_CONFIG[status] || { tone: 'slate' as BadgeTone, icon: CheckCircle2 };
  const Icon = config.icon;
  const spin = status === 'SIMULATING';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${TONE_CLASSES[config.tone]} ${className}`}
    >
      <Icon className={`h-3 w-3 ${spin ? 'animate-spin' : ''}`} />
      {(config.label || status).replace(/_/g, ' ')}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  return <StatusBadge status={level} />;
}

/* ------------------------------------------------------------------------------------------- */
/* Modal                                                                                         */
/* ------------------------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`glass-card relative w-full ${maxWidth} animate-fade-in bg-[#0b0d1c]/95 p-6 shadow-2xl`}
      >
        <div className="mb-5">
          <h2 className="font-display text-lg font-bold text-white">{title}</h2>
          {description && <p className="mt-1 text-xs text-mutedText">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Small utilities                                                                               */
/* ------------------------------------------------------------------------------------------- */

export function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permissions can fail silently — not worth surfacing a toast for.
        }
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 ${className}`}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function MonoAddress({
  value,
  lead = 6,
  trail = 6,
}: {
  value: string;
  lead?: number;
  trail?: number;
}) {
  const truncated =
    value.length <= lead + trail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-trail)}`;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-300">
      {truncated}
      <CopyButton value={value} />
    </span>
  );
}
