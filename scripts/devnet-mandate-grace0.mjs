/**
 * Devnet run: package mandate, three voucher wires, then return the remainder.
 * Asks the payment program for grace 0. The program rejects 0, so the open
 * stores 1 second and the payer refund follows as soon as that second elapses.
 *
 *   node scripts/devnet-mandate-grace0.mjs --execute
 */
import { executeMandatePackageRun } from './devnet-mandate-package.mjs';

if (!process.argv.includes('--execute')) {
  console.error('Refusing to broadcast. Re-run with --execute to use the funder wallet on Devnet.');
  process.exit(1);
}

executeMandatePackageRun(undefined, {
  graceSeconds: 0,
  refundRemainder: true,
  agentFile: 'mandate-grace0-agent.json',
  reportFile: 'devnet-mandate-grace0-2026-10-20.json',
}).then((result) => {
  console.log(JSON.stringify({
    reportPath: result.reportPath,
    mandatePda: result.report.mandatePda,
    channel: result.report.channel,
    escrow: result.report.escrow,
    graceRequested: result.report.graceRequested,
    graceStored: result.report.graceStored,
    payerRefund: result.report.refund?.payerDelta ?? null,
    escrowAfter: result.report.refund?.escrowAfter ?? null,
    signatures: result.report.confirmedSignatures,
  }, null, 2));
}).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : 'grace 0 mandate run failed');
  process.exit(1);
});
