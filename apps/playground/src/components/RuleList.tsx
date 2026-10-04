'use client';

import { useState } from 'react';
import { ChevronDown, Check, AlertTriangle, Minus, X } from 'lucide-react';
import type { RuleDisplay } from '@/lib/types';

const DOT: Record<RuleDisplay['verdict'], string> = {
  pass: 'text-allow',
  overridden: 'text-allow',
  escalate: 'text-escalate',
  fail: 'text-deny',
  skipped: 'text-mutedText',
  'not-applicable': 'text-mutedText',
};

const ICON: Record<RuleDisplay['verdict'], typeof Check> = {
  pass: Check,
  overridden: Check,
  escalate: AlertTriangle,
  fail: X,
  skipped: Check,
  'not-applicable': Minus,
};

/** The friendly rule list the brief asks for, with a "show details" toggle per rule for the raw
 * RuleResult (id, status, message, details) judges can inspect. */
export function RuleList({ rules }: { rules: RuleDisplay[] }) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}
    </ul>
  );
}

function RuleRow({ rule }: { rule: RuleDisplay }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[rule.verdict];
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-surfaceRaised"
        aria-expanded={open}
      >
        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${DOT[rule.verdict]}`} aria-hidden="true" />
        <span className="flex-1 break-words text-sm text-white/90">{rule.label}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-mutedText transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-5 pb-4 pl-12 text-xs text-mutedText">
          <p className="mb-1 break-words">
            <span className="font-mono text-[11px] uppercase tracking-wide">{rule.id}</span> — {rule.detail}
          </p>
          {Object.keys(rule.raw.details).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 font-mono text-[11px] text-mutedText">
              {JSON.stringify(rule.raw.details, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
