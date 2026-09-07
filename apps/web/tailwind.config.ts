import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        surface: '#0f172a',
        surfaceHover: '#1e293b',
        border: '#1e293b',
        primary: '#2563eb',
        primaryHover: '#1d4ed8',
        accent: '#38bdf8',
        mutedText: '#94a3b8',
      },
    },
  },
  plugins: [],
};

export default config;
