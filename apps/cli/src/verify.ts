import { readFileSync } from 'fs';
import { verifyMandateChain } from '@atlas-rail/mandate';
import { ReceiptCheck, ReceiptVerification, verifyReceipt } from '@atlas-rail/receipt';
import { Web3ChainClient } from '@atlas-rail/solana';

export interface VerifyCliOptions {
  file: string;
  rpc: string | null;
  offline: boolean;
  trustedKeys: string[];
  checkSettlement: boolean;
  requireAnchor: boolean;
  json: boolean;
  color: boolean;
}

const useColor = (enabled: boolean) => ({
  green: (s: string) => (enabled ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (enabled ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (enabled ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (enabled ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (enabled ? `\x1b[1m${s}\x1b[0m` : s),
});

const BADGE: Record<ReceiptCheck['status'], string> = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' };

export function formatReport(file: string, result: ReceiptVerification, color: boolean, offline: boolean): string {
  const c = useColor(color);
  const lines: string[] = [];
  lines.push(c.bold(`Atlas Rail receipt verification — ${file}`));
  lines.push('');
  for (const check of result.checks) {
    const badge = BADGE[check.status];
    const painted = check.status === 'PASS' ? c.green(badge) : check.status === 'FAIL' ? c.red(badge) : c.yellow(badge);
    lines.push(`  ${painted}  ${check.title}`);
    lines.push(c.dim(`        ${check.message}`));
  }
  lines.push('');
  const failed = result.checks.filter((k) => k.status === 'FAIL').length;
  const skipped = result.checks.filter((k) => k.status === 'SKIP').length;
  lines.push(
    result.pass
      ? c.green(c.bold(`RESULT: PASS`)) + c.dim(`  (${result.checks.length - skipped} checks passed${skipped ? `, ${skipped} skipped` : ''}${offline ? ', offline mode' : ''})`)
      : c.red(c.bold(`RESULT: FAIL`)) + c.dim(`  (${failed} check${failed === 1 ? '' : 's'} failed)`),
  );
  return lines.join('\n');
}

/** Verifies a receipt file. Returns the process exit code: 0 PASS, 1 FAIL, 2 usage or I/O error. */
export async function runVerify(options: VerifyCliOptions, out: (line: string) => void = console.log): Promise<number> {
  let raw: string;
  try {
    raw = readFileSync(options.file, 'utf8');
  } catch (error) {
    out(`Cannot read ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    out(`${options.file} is not valid JSON`);
    return 2;
  }

  const rpc = options.offline ? null : (options.rpc ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
  let chain: Web3ChainClient | null = null;
  if (rpc) {
    try {
      chain = Web3ChainClient.fromUrl(rpc); // refuses mainnet endpoints
    } catch (error) {
      out(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  const result = await verifyReceipt(document, {
    chain,
    trustedInstanceKeys: options.trustedKeys.length > 0 ? options.trustedKeys : undefined,
    checkSettlementOnChain: options.checkSettlement && chain !== null,
    requireAnchor: options.requireAnchor,
  });

  out(options.json ? JSON.stringify(result, null, 2) : formatReport(options.file, result, options.color, options.offline));
  return result.pass ? 0 : 1;
}

/** Verifies a standalone mandate document (delegation chain, signatures, independent approvers). */
export function runVerifyMandate(file: string, color: boolean, out: (line: string) => void = console.log): number {
  const c = useColor(color);
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    out(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const result = verifyMandateChain(document);
  out(c.bold(`Atlas Rail mandate verification — ${file}`));
  out('');
  for (const check of result.checks) {
    out(`  ${check.ok ? c.green('PASS') : c.red('FAIL')}  ${check.id}`);
    out(c.dim(`        ${check.message}`));
  }
  out('');
  out(result.valid ? c.green(c.bold('RESULT: PASS')) : c.red(c.bold('RESULT: FAIL')));
  return result.valid ? 0 : 1;
}
