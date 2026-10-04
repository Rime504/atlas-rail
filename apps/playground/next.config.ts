import type { NextConfig } from 'next';

// The playground uses the real policy gate and receipt code (packages/mandate, packages/receipt,
// packages/solana), not a mock-up — see src/lib/scenario.ts. All of it runs server-side, in a
// Node.js route handler (never the Edge runtime: these packages use Node's `crypto` and
// `@solana/web3.js`), so none of it enters the client bundle.
const nextConfig: NextConfig = {
  transpilePackages: ['@atlas-rail/mandate', '@atlas-rail/receipt', '@atlas-rail/solana'],
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
