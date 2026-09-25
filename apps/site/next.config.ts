import type { NextConfig } from 'next';

// Deliberately standalone: this app shares Atlas Rail's design language (see tailwind.config.ts)
// but imports nothing from apps/web or packages/ui, so it can be deployed to Vercel on its own,
// independently of the console.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
