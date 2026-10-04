export function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100);
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-mutedText">
        <span>
          Step {step} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Walkthrough progress"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
      >
        <div className="h-full rounded-full bg-solana-gradient transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
