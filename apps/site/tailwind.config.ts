import type { Config } from 'tailwindcss';

// Same tokens as apps/web/tailwind.config.ts, kept in sync by hand since this app is intentionally
// standalone (no shared package import) so it can deploy to Vercel independently of the console.
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#050611',
        surface: '#0b0d1c',
        mutedText: '#8b90ab',
        solana: {
          purple: '#9945FF',
          green: '#14F195',
          blue: '#19FB9B',
          magenta: '#DC1FFF',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'solana-gradient': 'linear-gradient(90deg, #9945FF 0%, #14F195 100%)',
        'solana-gradient-radial': 'radial-gradient(circle at top, rgba(153,69,255,0.25), transparent 60%)',
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
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
