import { OnchainMandateState, PaymentProof, provePayment } from '@atlas-rail/receipt';
import { ChainClient, Web3ChainClient, fetchMandateAccount, findMandatePda } from '@atlas-rail/solana';

export const DEFAULT_STORE = 'https://atlas-rail-playground.vercel.app';
const DEFAULT_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';

export interface ProveTxOptions {
  txSignature: string;
  rpc: string | null;
  store: string | null;
  trustedKeys: string[];
  json: boolean;
  color: boolean;
}

export interface ProveTxDeps {
  chain?: ChainClient;
  loadReceipt?: (id: string) => Promise<unknown | null>;
  loadMandateState?: (mandateHashHex: string) => Promise<OnchainMandateState | null>;
}

const paint = (enabled: boolean) => ({
  green: (s: string) => (enabled ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (enabled ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (enabled ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (enabled ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (enabled ? `\x1b[1m${s}\x1b[0m` : s),
});

const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const usd = (baseUnits: string) => `$${(Number(baseUnits) / 1e6).toFixed(2)}`;

export function formatProof(proof: PaymentProof, color: boolean): string {
  const c = paint(color);
  const lines = [`Atlas Rail proof of permission: ${proof.txSignature}`, `  ${explorer(proof.txSignature)}`, ''];
  if (proof.verdict === 'NOT_FOUND' || proof.verdict === 'NO_PROOF') {
    lines.push(`  ${proof.verdict === 'NOT_FOUND' ? c.yellow('NOT FOUND') : c.red('NO PROOF')}  ${proof.reason}`);
    return lines.join('\n');
  }
  const f = proof.facts;
  for (const check of proof.verification.checks) {
    const badge = check.status === 'PASS' ? c.green('PASS') : check.status === 'FAIL' ? c.red('FAIL') : c.yellow('SKIP');
    lines.push(`  ${badge}  ${check.title}`);
  }
  lines.push('');
  lines.push(`  Mandate signed by: ${f.signers.map((s) => `${s.role.toLowerCase()} ${s.publicKey}`).join(', ')}`);
  lines.push(`  Limits: ${usd(f.limits.maxPerPayment)} per payment, ${usd(f.limits.maxTotal)} lifetime`);
  lines.push(`  Decision: ${f.decision.outcome}${f.decision.kind === 'APPROVED' ? ' (with human approval)' : ''}`);
  lines.push(`  Paid ${usd(f.payment.amount)} to ${f.payment.payTo}`);
  if (f.anchor) lines.push(`  Anchored (${f.anchor.mechanism}${f.anchor.seq !== null ? ` seq ${f.anchor.seq}` : ''}): ${explorer(f.anchor.txSignature)}`);
  const revoked = f.mandateAtPaymentTime.revoked;
  lines.push(`  Mandate at payment time: ${f.mandateAtPaymentTime.withinValidity ? 'within validity' : 'OUTSIDE validity'}, ${revoked === null ? 'revocation not checked' : revoked ? 'ALREADY REVOKED' : 'not revoked'}`);
  lines.push('');
  lines.push(proof.verdict === 'PROVEN' ? `${c.green(c.bold('PROVEN'))}  ${proof.reason}` : `${c.red(c.bold('INVALID'))}  ${proof.reason}`);
  return lines.join('\n');
}

export async function runProveTx(options: ProveTxOptions, deps: ProveTxDeps = {}, out: (line: string) => void = console.log): Promise<number> {
  const rpc = options.rpc ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  let chain = deps.chain;
  if (!chain) {
    try {
      chain = Web3ChainClient.fromUrl(rpc); // refuses mainnet endpoints
    } catch (error) {
      out(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }
  const store = (options.store ?? process.env.ATLAS_RECEIPT_STORE ?? DEFAULT_STORE).replace(/\/$/, '');
  const loadReceipt =
    deps.loadReceipt ??
    (async (id: string) => {
      const res = await fetch(`${store}/api/receipts/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Receipt store returned HTTP ${res.status}`);
      return res.json();
    });
  const loadMandateState =
    deps.loadMandateState ??
    (async (hashHex: string) => {
      const account = await fetchMandateAccount(rpc, findMandatePda(DEFAULT_PROGRAM_ID, Buffer.from(hashHex, 'hex')).address).catch(() => null);
      return account ? { revoked: account.revoked, revokedAt: Number(account.revokedAt) } : null;
    });

  let proof: PaymentProof;
  try {
    proof = await provePayment(options.txSignature, {
      chain,
      loadReceipt,
      loadMandateState,
      trustedInstanceKeys: options.trustedKeys.length > 0 ? options.trustedKeys : undefined,
    });
  } catch (error) {
    out(`Could not complete the check: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  out(options.json ? JSON.stringify(proof, null, 2) : formatProof(proof, options.color));
  return proof.verdict === 'PROVEN' ? 0 : 1;
}
