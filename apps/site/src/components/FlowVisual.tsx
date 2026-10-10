/**
 * Mandate → gate → proof, drawn as rails (the logo's motif). A payment inside the mandate rides
 * through the gate to a receipt on Solana; an attack stops at the gate. CSS-only, 8 s loop, and a
 * still frame of the outcome under prefers-reduced-motion (see globals.css).
 */
export function FlowVisual() {
  return (
    <figure className="card relative overflow-hidden px-4 pb-6 pt-8 sm:px-8 sm:pt-10">
      <figcaption className="sr-only">
        A payment inside the mandate passes the gate and gets a receipt on Solana; an attack is stopped at the gate before anything is signed.
      </figcaption>
      <svg viewBox="0 0 640 200" className="mx-auto block w-full max-w-[720px]" aria-hidden="true">
        <defs>
          <linearGradient id="fv-accent" gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="580" y2="0">
            <stop offset="0" stopColor="#8B5CF6" />
            <stop offset="1" stopColor="#2EF2B8" />
          </linearGradient>
          <radialGradient id="fv-glow">
            <stop offset="0" stopColor="#2EF2B8" stopOpacity=".55" />
            <stop offset="1" stopColor="#2EF2B8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Rails and crossties */}
        <line x1="60" y1="101" x2="580" y2="101" stroke="url(#fv-accent)" strokeWidth="2" opacity=".55" />
        <line x1="60" y1="129" x2="580" y2="129" stroke="url(#fv-accent)" strokeWidth="2" opacity=".55" />
        <line x1="60" y1="115" x2="580" y2="115" stroke="#fff" strokeWidth="26" strokeDasharray="2 22" opacity=".09" className="flow-rail" />

        {/* Mandate: a document with three signatures */}
        <g transform="translate(22 66)">
          <rect width="76" height="98" rx="12" fill="#13131C" stroke="rgba(255,255,255,.14)" />
          <rect x="14" y="16" width="40" height="5" rx="2.5" fill="#fff" opacity=".7" />
          <rect x="14" y="29" width="48" height="4" rx="2" fill="#fff" opacity=".25" />
          <rect x="14" y="39" width="34" height="4" rx="2" fill="#fff" opacity=".25" />
          <rect x="14" y="49" width="44" height="4" rx="2" fill="#fff" opacity=".25" />
          <circle cx="22" cy="76" r="5" fill="#8B5CF6" />
          <circle cx="38" cy="76" r="5" fill="#5DA8D8" />
          <circle cx="54" cy="76" r="5" fill="#2EF2B8" />
        </g>

        {/* Gate: a checkpoint across the rails */}
        <g transform="translate(296 58)">
          <rect width="48" height="114" rx="12" fill="#13131C" stroke="rgba(255,255,255,.14)" />
          <rect x="10" y="50" width="28" height="14" rx="4" fill="url(#fv-accent)" opacity=".9" />
          <circle cx="24" cy="24" r="6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
          <circle cx="24" cy="90" r="6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
        </g>
        <g className="flow-gate-allow">
          <rect x="283" y="14" width="74" height="26" rx="13" fill="rgba(46,242,184,.12)" stroke="rgba(46,242,184,.5)" />
          <text x="320" y="31.5" textAnchor="middle" fontSize="12" fontWeight="600" fill="#2EF2B8" letterSpacing="1.2">ALLOW</text>
        </g>
        <g className="flow-gate-deny">
          <rect x="285" y="14" width="70" height="26" rx="13" fill="rgba(255,107,129,.12)" stroke="rgba(255,107,129,.5)" />
          <text x="320" y="31.5" textAnchor="middle" fontSize="12" fontWeight="600" fill="#FF6B81" letterSpacing="1.2">DENY</text>
        </g>

        {/* Proof: a receipt, anchored on Solana */}
        <circle cx="580" cy="115" r="58" fill="url(#fv-glow)" className="flow-proof" />
        <g transform="translate(542 66)">
          <path d="M0 12a12 12 0 0 1 12-12h52a12 12 0 0 1 12 12v86l-9.5-7-9.5 7-9.5-7-9.5 7-9.5-7-9.5 7-9.5-7L0 98z" fill="#13131C" stroke="rgba(255,255,255,.14)" />
          <circle cx="38" cy="36" r="15" fill="none" stroke="#2EF2B8" strokeWidth="2.5" />
          <path d="m31 36 5 5 9-10" fill="none" stroke="#2EF2B8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="16" y="62" width="44" height="4" rx="2" fill="#fff" opacity=".25" />
          <rect x="22" y="72" width="32" height="4" rx="2" fill="#fff" opacity=".25" />
        </g>

        {/* The payment inside the mandate */}
        <g className="flow-allowed">
          <circle cx="60" cy="115" r="16" fill="#2EF2B8" opacity=".18" />
          <circle cx="60" cy="115" r="7" fill="#2EF2B8" />
        </g>
        {/* The attack */}
        <g className="flow-blocked">
          <circle cx="60" cy="115" r="16" fill="#FF6B81" opacity=".16" />
          <circle cx="60" cy="115" r="7" fill="#FF6B81" />
        </g>
      </svg>

      <div className="mx-auto mt-4 grid max-w-[720px] grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[14px] font-medium text-white sm:text-[15px]">Mandate</p>
          <p className="mt-1 text-[12px] leading-snug text-faint sm:text-[13px]">Signed by owner, approver and agent</p>
        </div>
        <div>
          <p className="text-[14px] font-medium text-white sm:text-[15px]">Gate</p>
          <p className="mt-1 text-[12px] leading-snug text-faint sm:text-[13px]">15 rules before any signature</p>
        </div>
        <div>
          <p className="text-[14px] font-medium text-white sm:text-[15px]">Proof</p>
          <p className="mt-1 text-[12px] leading-snug text-faint sm:text-[13px]">A receipt anyone can check on Solana</p>
        </div>
      </div>
    </figure>
  );
}
