import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@atlas-rail/ui', '@atlas-rail/config', '@atlas-rail/domain', '@atlas-rail/api-client'],
  reactStrictMode: true,
};

export default nextConfig;
