import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', '../../packages/ui/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#050611',
        surface: '#0b0d1c',
        surfaceHover: '#141830',
        border: '#1c2038',
        primary: '#9945FF',
        primaryHover: '#a869ff',
        accent: '#14F195',
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
        'solana-gradient-radial':
          'radial-gradient(circle at top, rgba(153,69,255,0.25), transparent 60%)',
        'grid-fade': 'linear-gradient(to bottom, transparent, #050611)',
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
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        shimmer: 'shimmer 1.8s infinite linear',
      },
    },
  },
  plugins: [],
};

export default config;
