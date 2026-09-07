export function assertNotMainnet(endpointOrCluster: string): void {
  const normalized = endpointOrCluster.toLowerCase();
  if (
    normalized.includes('mainnet') ||
    normalized.includes('api.mainnet-beta.solana.com') ||
    normalized.includes('solana-mainnet')
  ) {
    throw new Error(
      'CRITICAL SAFETY FATAL: Mainnet execution is prohibited in Atlas Rail v1. Use devnet RPC configuration only.',
    );
  }
}
