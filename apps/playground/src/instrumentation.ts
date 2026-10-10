/** Runs once when a server instance starts: production refuses to serve with missing keys or secret. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionConfig } = await import('./lib/devnet-env');
    assertProductionConfig();
  }
}
