import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Verdict as VerdictType } from '@/lib/types';

const STYLES: Record<VerdictType, { icon: typeof CheckCircle2; border: string; bg: string; text: string; ring: string }> = {
  ALLOW: { icon: CheckCircle2, border: 'border-allow/40', bg: 'bg-allow/10', text: 'text-allow', ring: 'shadow-glow-green' },
  ESCALATE: { icon: AlertTriangle, border: 'border-escalate/40', bg: 'bg-escalate/10', text: 'text-escalate', ring: '' },
  DENY: { icon: XCircle, border: 'border-deny/40', bg: 'bg-deny/10', text: 'text-deny', ring: '' },
};

export function VerdictBanner({ verdict, headline }: { verdict: VerdictType; headline: string }) {
  const s = STYLES[verdict];
  const Icon = s.icon;
  return (
    <div data-testid="verdict-banner" data-verdict={verdict} className={`animate-pop-in flex items-center gap-4 rounded-2xl border ${s.border} ${s.bg} ${s.ring} px-6 py-5`}>
      <Icon className={`h-9 w-9 flex-shrink-0 ${s.text}`} aria-hidden="true" />
      <p className={`text-xl font-display font-semibold ${s.text}`}>{headline}</p>
    </div>
  );
}
