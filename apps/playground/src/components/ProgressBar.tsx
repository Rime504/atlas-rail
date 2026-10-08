export function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100);
  // "Step X of N" and the percentage are two separate pieces of information, kept visually apart
  // (opposite ends of the row) and apart for assistive tech too: the step count is the progressbar's
  // single aria-valuetext (so a screen reader hears exactly "Walkthrough progress, Step 1 of 8", not
  // a run-on with the percentage mashed in), and the whole visual row is aria-hidden since it would
  // otherwise be announced a second time, redundantly, right next to the progressbar itself.
  const stepLabel = `Step ${step} of ${total}`;
  return (
    <div className="mb-8">
      <div aria-hidden="true" className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-mutedText">
        <span>{stepLabel}</span>
        <span>{pct}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Walkthrough progress"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuetext={stepLabel}
      >
        <div className="h-full rounded-full bg-solana-gradient transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
