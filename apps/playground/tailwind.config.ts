import type { Config } from 'tailwindcss';

// Same base tokens as apps/site/tailwind.config.ts (Atlas Rail's dark theme), kept in sync by hand
// since this app is intentionally standalone so it can deploy to Vercel independently. Adds the
// allow/escalate/deny verdict colors the playground's narrative needs throughout.
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#050611',
        surface: '#0b0d1c',
        surfaceRaised: '#12142a',
        border: '#1f2240',
        mutedText: '#8b90ab',
        solana: {
          purple: '#9945FF',
          green: '#14F195',
          blue: '#19FB9B',
          magenta: '#DC1FFF',
        },
        allow: '#14F195',
        escalate: '#F5A623',
        deny: '#FF5C7A',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'solana-gradient': 'linear-gradient(90deg, #9945FF 0%, #14F195 100%)',
        'solana-gradient-radial': 'radial-gradient(circle at top, rgba(153,69,255,0.25), transparent 60%)',
        // Same hues as solana-gradient, lightened at the purple end specifically for text on the
        // #050611 background: #9945FF only reaches ~3.65:1 contrast there (fails WCAG AA's 4.5:1 for
        // normal text); #B98CFF reaches ~6.5:1, and the gradient's own blend only climbs from there
        // toward the green end, so every point along it clears AA.
        'solana-gradient-text': 'linear-gradient(90deg, #B98CFF 0%, #14F195 100%)',
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(153,69,255,0.45)',
        'glow-green': '0 0 40px -10px rgba(20,241,149,0.35)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        'pop-in': 'pop-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
