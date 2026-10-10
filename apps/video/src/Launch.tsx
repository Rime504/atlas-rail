import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import capture from '../public/shots/shots.json';

// Brand
const INK = '#07070B';
const VIOLET = '#8B5CF6';
const MINT = '#2EF2B8';
const MUTED = '#A1A1B5';
const FONT = "'Space Grotesk', system-ui, sans-serif";
const ACCENT = `linear-gradient(90deg, ${VIOLET} 0%, ${MINT} 100%)`;

// Timeline (frames at 30 fps), exactly as briefed: 0–4 s, 4–8, 8–11, 11–14, 14–30, 30–36, 36–40.
const SCENES = {
  hook: { from: 0, duration: 120 },
  stat: { from: 120, duration: 120 },
  question: { from: 240, duration: 90 },
  logo: { from: 330, duration: 90 },
  product: { from: 420, duration: 480 },
  proof: { from: 900, duration: 180 },
  end: { from: 1080, duration: 120 },
};
export const LAUNCH_FRAMES = 1200;

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/* ---- shared ---------------------------------------------------------------------------------- */

function Canvas({ children, glow = 0.18 }: { children: ReactNode; glow?: number }) {
  return (
    <AbsoluteFill style={{ background: INK, fontFamily: FONT, color: '#fff' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 620px at 50% 38%, rgba(139,92,246,${glow}), transparent 70%), radial-gradient(900px 500px at 70% 90%, rgba(46,242,184,${glow * 0.5}), transparent 70%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

/** Rises and fades in from `at` (frames), optionally fades out before the scene ends. */
function Reveal({ at, children, style, outAt }: { at: number; children: ReactNode; style?: CSSProperties; outAt?: number }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  const out = outAt === undefined ? 1 : interpolate(frame, [outAt, outAt + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ opacity: p * out, transform: `translateY(${(1 - p) * 24}px)`, ...style }}>{children}</div>;
}

const gradientText: CSSProperties = { background: ACCENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };

/** Fades the whole scene out over its last frames, for clean cuts between scenes. */
function SceneFade({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Logo({ size, draw = 1, dot = 1 }: { size: number; draw?: number; dot?: number }) {
  // Rails draw from the base up; crossties and the signal dot follow.
  const rail = 84;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <defs>
        <linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="20" y1="90" x2="50" y2="10">
          <stop offset="0" stopColor={VIOLET} />
          <stop offset="1" stopColor={MINT} />
        </linearGradient>
      </defs>
      <g stroke="url(#lg)" strokeLinecap="round" fill="none">
        <line x1="20" y1="90" x2="46" y2="12" strokeWidth="7" strokeDasharray={rail} strokeDashoffset={rail * (1 - draw)} />
        <line x1="80" y1="90" x2="54" y2="12" strokeWidth="7" strokeDasharray={rail} strokeDashoffset={rail * (1 - draw)} />
        <line x1="29" y1="72" x2="71" y2="72" strokeWidth="6" opacity={0.55 * clamp01(draw * 3 - 0.9)} />
        <line x1="33.5" y1="50" x2="66.5" y2="50" strokeWidth="5.5" opacity={clamp01(draw * 3 - 1.4)} />
        <line x1="40" y1="31" x2="60" y2="31" strokeWidth="5" opacity={0.55 * clamp01(draw * 3 - 1.9)} />
      </g>
      <circle cx="50" cy="9" r={3.2 * dot} fill={MINT} />
    </svg>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ---- 0–4 s: the hook ------------------------------------------------------------------------- */

function Hook() {
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: FONT, color: '#fff', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <Reveal at={6} style={{ fontSize: 64, fontWeight: 500, letterSpacing: '-0.03em', maxWidth: 1400, lineHeight: 1.15 }}>
        The next wave of customers on Solana won&rsquo;t be people.
      </Reveal>
      <Reveal at={62} style={{ marginTop: 36, fontSize: 88, fontWeight: 600, letterSpacing: '-0.04em', ...gradientText }}>
        They&rsquo;ll be agents.
      </Reveal>
    </AbsoluteFill>
  );
}

/* ---- 4–8 s: the stat ------------------------------------------------------------------------- */

function Counter({ from = 0, to, start, frames = 54, format }: { from?: number; to: number; start: number; frames?: number; format: (v: number) => string }) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [start, start + frames], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  return <>{format(v)}</>;
}

function Stat() {
  return (
    <SceneFade duration={SCENES.stat.duration}>
      <Canvas>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 210, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', ...gradientText }}>
            <Counter to={23.2} start={6} format={(v) => `${v.toFixed(1)}M`} />
          </div>
          <Reveal at={14} style={{ marginTop: 28, fontSize: 52, fontWeight: 500, letterSpacing: '-0.02em' }}>
            agent payments <span style={{ color: MUTED }}>·</span> 4 weeks <span style={{ color: MUTED }}>·</span>{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Counter to={76} start={14} format={(v) => `${Math.round(v)}%`} />
            </span>{' '}
            of x402
          </Reveal>
          <Reveal at={30} style={{ marginTop: 34, fontSize: 24, color: MUTED, letterSpacing: '0.02em' }}>
            Source: Artemis via Solana, Sept 2026
          </Reveal>
        </AbsoluteFill>
      </Canvas>
    </SceneFade>
  );
}

/* ---- 8–11 s: the question -------------------------------------------------------------------- */

function Question() {
  const frame = useCurrentFrame();
  const words = ['Who', 'said', 'you', 'could', 'spend', 'that?'];
  return (
    <SceneFade duration={SCENES.question.duration}>
      <Canvas glow={0.1}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 112, fontWeight: 600, letterSpacing: '-0.045em', display: 'flex', gap: 28 }}>
            {words.map((w, i) => {
              const p = interpolate(frame, [4 + i * 5, 18 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
              return (
                <span key={w} style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, display: 'inline-block', ...(w === 'that?' ? gradientText : {}) }}>
                  {w}
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      </Canvas>
    </SceneFade>
  );
}

/* ---- 11–14 s: logo reveal -------------------------------------------------------------------- */

function LogoReveal() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = interpolate(frame, [2, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  const dot = spring({ frame: frame - 32, fps, config: { damping: 9, stiffness: 160 } });
  return (
    <SceneFade duration={SCENES.logo.duration}>
      <Canvas>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Logo size={220} draw={draw} dot={dot} />
          <Reveal at={36} style={{ marginTop: 34, fontSize: 64, fontWeight: 600, letterSpacing: '0.28em', paddingLeft: '0.28em' }}>
            ATLAS RAIL
          </Reveal>
          <Reveal at={46} style={{ marginTop: 18, fontSize: 34, color: MUTED, letterSpacing: '-0.01em' }}>
            Proof of permission. Onchain.
          </Reveal>
        </AbsoluteFill>
      </Canvas>
    </SceneFade>
  );
}

/* ---- 14–30 s: the product, real screenshots -------------------------------------------------- */

type Shot = (typeof capture.shots)[number];
const shot = (name: string): Shot => {
  const s = capture.shots.find((x) => x.name === name);
  if (!s) throw new Error(`missing screenshot ${name}`);
  return s;
};

const SEGMENTS: Array<{ shot: Shot; frames: number; word?: string; maxZoom?: number }> = [
  { shot: shot('1-landing'), frames: 54 },
  { shot: shot('2-permission'), frames: 72, word: 'Permission' },
  { shot: shot('3-gate'), frames: 72, word: 'Gate' },
  { shot: shot('4-human'), frames: 60, word: 'Human' },
  { shot: shot('5-approve'), frames: 60, word: 'Human' },
  { shot: shot('6-proof'), frames: 84, word: 'Proof', maxZoom: 1.55 }, // keep the whole PROVEN banner in frame
  { shot: shot('7-revoke'), frames: 78, word: 'Revoke' },
];

const FRAME_W = 1560;
const FRAME_H = 975; // 1440×900 screenshots keep their 1.6 aspect

function ZoomShot({ s, frames, maxZoom = 1.9 }: { s: Shot; frames: number; maxZoom?: number }) {
  const frame = useCurrentFrame();
  const k = FRAME_W / s.width;
  const f = s.focus;
  const cx = (f.x + f.width / 2) * k;
  const cy = (f.y + f.height / 2) * k;
  // The key phrase grows to about three quarters of the frame width, within a calm range.
  const zoom = Math.min(maxZoom, Math.max(1.45, (0.75 * FRAME_W) / (f.width * k)));
  const p = interpolate(frame, [12, frames - 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  const z = 1 + (zoom - 1) * p;
  // Move the focus point toward the frame centre while scaling, never past the image edges.
  const tx = Math.min(0, Math.max(FRAME_W - FRAME_W * z, cx + (FRAME_W / 2 - cx) * p - cx * z));
  const ty = Math.min(0, Math.max(FRAME_H - FRAME_H * z, cy + (FRAME_H / 2 - cy) * p - cy * z));
  return (
    <Img
      src={staticFile(s.file)}
      style={{ position: 'absolute', left: 0, top: 0, width: FRAME_W, height: FRAME_H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${z})` }}
    />
  );
}

function WordCard({ word }: { word: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 14, fps, config: { damping: 16, stiffness: 140 } });
  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        bottom: 96,
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px)`,
        background: 'rgba(13,13,20,0.86)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 22,
        padding: '22px 34px 20px',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ fontSize: 58, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }}>{word}</div>
      <div style={{ marginTop: 14, height: 4, width: 72, borderRadius: 4, background: ACCENT }} />
    </div>
  );
}

function Product() {
  let at = 0;
  return (
    <Canvas glow={0.22}>
      {SEGMENTS.map((seg, i) => {
        const from = at;
        at += seg.frames;
        return (
          <Sequence key={seg.shot.name} from={from} durationInFrames={seg.frames + (i < SEGMENTS.length - 1 ? 10 : 0)}>
            <ProductSegment seg={seg} last={i === SEGMENTS.length - 1} first={i === 0} />
          </Sequence>
        );
      })}
    </Canvas>
  );
}

function ProductSegment({ seg, first, last }: { seg: (typeof SEGMENTS)[number]; first: boolean; last: boolean }) {
  const frame = useCurrentFrame();
  const total = seg.frames + (last ? 0 : 10);
  const opacity = interpolate(frame, [0, first ? 12 : 10, total - (last ? 12 : 10), total], [0, 1, 1, last ? 0 : 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const enter = first ? interpolate(frame, [0, 20], [0.94, 1], { extrapolateRight: 'clamp', easing: easeOut }) : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: FRAME_W,
            height: FRAME_H,
            borderRadius: 28,
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 60px 160px -40px rgba(139,92,246,0.35), 0 40px 100px -30px rgba(0,0,0,0.9)',
            transform: `scale(${enter})`,
            background: INK,
          }}
        >
          <ZoomShot s={seg.shot} frames={seg.frames} maxZoom={seg.maxZoom} />
        </div>
      </AbsoluteFill>
      {seg.word && <WordCard word={seg.word} />}
    </AbsoluteFill>
  );
}

/* ---- 30–36 s: the red team ------------------------------------------------------------------- */

function RedTeam() {
  const item = (value: ReactNode, label: string, at: number, accent = false) => (
    <Reveal at={at} style={{ textAlign: 'center', minWidth: 420 }}>
      <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', ...(accent ? gradientText : {}) }}>{value}</div>
      <div style={{ marginTop: 18, fontSize: 36, color: MUTED }}>{label}</div>
    </Reveal>
  );
  return (
    <SceneFade duration={SCENES.proof.duration}>
      <Canvas>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
            {item(<Counter to={51} start={8} format={(v) => `${Math.round(v)}`} />, 'attack types', 6)}
            {item(<Counter to={1014} start={20} format={(v) => Math.round(v).toLocaleString('en-US')} />, 'attempts', 18)}
            {item('$0.00', 'moved', 40, true)}
          </div>
          <Reveal at={64} style={{ marginTop: 70, fontSize: 28, color: MUTED }}>
            Our own red team, assuming a fully compromised agent on every attempt.
          </Reveal>
        </AbsoluteFill>
      </Canvas>
    </SceneFade>
  );
}

/* ---- 36–40 s: end card ----------------------------------------------------------------------- */

function EndCard() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: 'clamp', easing: easeInOut });
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <Canvas>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Logo size={150} draw={draw} dot={draw} />
          <Reveal at={10} style={{ marginTop: 40, fontSize: 72, fontWeight: 600, letterSpacing: '-0.04em', maxWidth: 1500, lineHeight: 1.08 }}>
            Proof of permission for every agent payment.
          </Reveal>
          <Reveal at={20} style={{ marginTop: 40, fontSize: 40, fontWeight: 500, ...gradientText }}>
            atlas-rail-playground.vercel.app
          </Reveal>
          <Reveal at={28} style={{ marginTop: 26, fontSize: 26, color: MUTED, letterSpacing: '0.04em' }}>
            Built on Solana · Live on devnet
          </Reveal>
        </AbsoluteFill>
      </Canvas>
    </AbsoluteFill>
  );
}

/* ---- the film -------------------------------------------------------------------------------- */

export function Launch() {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={SCENES.hook.from} durationInFrames={SCENES.hook.duration}>
        <Hook />
      </Sequence>
      <Sequence from={SCENES.stat.from} durationInFrames={SCENES.stat.duration}>
        <Stat />
      </Sequence>
      <Sequence from={SCENES.question.from} durationInFrames={SCENES.question.duration}>
        <Question />
      </Sequence>
      <Sequence from={SCENES.logo.from} durationInFrames={SCENES.logo.duration}>
        <LogoReveal />
      </Sequence>
      <Sequence from={SCENES.product.from} durationInFrames={SCENES.product.duration}>
        <Product />
      </Sequence>
      <Sequence from={SCENES.proof.from} durationInFrames={SCENES.proof.duration}>
        <RedTeam />
      </Sequence>
      <Sequence from={SCENES.end.from} durationInFrames={SCENES.end.duration}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
}
