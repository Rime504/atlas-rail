import type { Config } from 'tailwindcss';

// Atlas Rail brand: near-black canvas, white type, one violet→mint accent used sparingly.
// Standalone on purpose (no shared package import) so the site deploys to Vercel on its own.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07070B',
        panel: '#0D0D14',
        raised: '#13131C',
        line: 'rgba(255,255,255,0.08)',
        muted: '#A1A1B5',
        faint: '#7C7C92',
        violet: '#8B5CF6',
        'violet-text': '#A78BFA',
        mint: '#2EF2B8',
        deny: '#FF6B81',
      },
      fontFamily: {
        sans: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        accent: 'linear-gradient(90deg, #8B5CF6 0%, #2EF2B8 100%)',
      },
      maxWidth: {
        page: '72rem',
      },
    },
  },
  plugins: [],
};

export default config;
