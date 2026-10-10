import { useId } from 'react';

/** The Atlas Rail mark: an "A" of two converging rails, three crossties and a signal dot. */
export function LogoMark({ className = 'h-7 w-7', title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 100" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="20" y1="90" x2="50" y2="10">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#2EF2B8" />
        </linearGradient>
      </defs>
      <g stroke={`url(#g${id})`} strokeLinecap="round">
        <line x1="20" y1="90" x2="46" y2="12" strokeWidth="7" />
        <line x1="80" y1="90" x2="54" y2="12" strokeWidth="7" />
        <line x1="29" y1="72" x2="71" y2="72" strokeWidth="6" opacity=".55" />
        <line x1="33.5" y1="50" x2="66.5" y2="50" strokeWidth="5.5" />
        <line x1="40" y1="31" x2="60" y2="31" strokeWidth="5" opacity=".55" />
      </g>
      <circle cx="50" cy="9" r="3.2" fill="#2EF2B8" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-7 w-7" />
      <span className="text-[17px] font-semibold tracking-tight text-white">Atlas Rail</span>
    </span>
  );
}
