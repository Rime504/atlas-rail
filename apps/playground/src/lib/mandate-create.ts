import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export const MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
/** x402 facilitators reject a shorter forced-close grace. */
export const FACILITATOR_MIN_GRACE_SECONDS = 900;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MANDATE_SEED = new TextEncoder().encode('mandate');

export interface MandateFormInput {
  label: string;
  agentPublicKey: string;
  approverPublicKey: string;
  gateAuthority: string;
  mint: string;
  maxPerPayment: string;
  maxPerWindow: string;
  windowSeconds: string;
  maxTotal: string;
  escalationThreshold: string;
  notBefore: string;
  expiresAt: string;
  allowedRecipients: string;
  allowedResources: string;
  mandateHashHex: string;
}

export interface MandateFormErrors {
  [key: string]: string;
}

export function parsePubkeyList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateMandateForm(form: MandateFormInput, owner: string | null): MandateFormErrors {
  const errors: MandateFormErrors = {};
  if (!owner) errors.owner = 'Connect a Devnet wallet as the mandate owner.';
  if (!BASE58.test(form.agentPublicKey.trim())) errors.agentPublicKey = 'Enter the agent public key (base58).';
  if (!BASE58.test(form.approverPublicKey.trim())) errors.approverPublicKey = 'Enter a distinct approver public key.';
  if (!BASE58.test(form.gateAuthority.trim())) errors.gateAuthority = 'Enter the gate authority (instance) public key.';
  if (!BASE58.test(form.mint.trim())) errors.mint = 'Enter the token mint.';
  if (!/^[0-9a-fA-F]{64}$/.test(form.mandateHashHex.trim())) {
    errors.mandateHashHex = 'Mandate hash must be 64 hex characters (SHA-256 of the off-chain mandate body).';
  }
  const agent = form.agentPublicKey.trim();
  const approver = form.approverPublicKey.trim();
  if (owner && approver === owner) errors.approverPublicKey = 'Approver must differ from the owner (on-chain rule).';
  if (owner && agent === owner) errors.agentPublicKey = 'Agent must differ from the owner.';
  if (agent && approver && agent === approver) errors.agentPublicKey = 'Agent must differ from the approver.';
  const maxPerPayment = BigInt(form.maxPerPayment || '0');
  const maxPerWindow = BigInt(form.maxPerWindow || '0');
  const maxTotal = BigInt(form.maxTotal || '0');
  const windowSeconds = BigInt(form.windowSeconds || '0');
  if (maxPerPayment <= 0n) errors.maxPerPayment = 'Max per payment must be > 0 base units.';
  if (maxPerWindow <= 0n) errors.maxPerWindow = 'Max per window must be > 0 base units.';
  if (maxTotal <= 0n) errors.maxTotal = 'Total budget must be > 0 base units.';
  if (maxPerPayment > maxTotal) errors.maxPerPayment = 'Max per payment cannot exceed total budget.';
  if (maxPerWindow > maxTotal) errors.maxPerWindow = 'Max per window cannot exceed total budget.';
  if (windowSeconds < 60n || windowSeconds > 31_536_000n) errors.windowSeconds = 'Window must be between 60 and 31536000 seconds.';
  const notBefore = BigInt(form.notBefore || '0');
  const expiresAt = BigInt(form.expiresAt || '0');
  if (expiresAt <= notBefore) errors.expiresAt = 'Expiry must be after not-before.';
  const recipients = parsePubkeyList(form.allowedRecipients);
  if (recipients.some((r) => !BASE58.test(r))) errors.allowedRecipients = 'Every recipient must be base58.';
  const resources = parsePubkeyList(form.allowedResources);
  if (resources.some((r) => !/^https?:\/\//.test(r))) errors.allowedResources = 'Resources must be http(s) URLs (off-chain only).';
  return errors;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Browser-safe PDA preview (same seeds as the program). */
export function mandatePdaForForm(form: MandateFormInput): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [MANDATE_SEED, hexToBytes(form.mandateHashHex)],
    new PublicKey(MANDATE_PROGRAM_ID),
  );
  return pda.toBase58();
}

export async function prepareCreateMandate(params: {
  form: MandateFormInput;
  owner: string;
  recentBlockhash: string;
}): Promise<{ unsignedBase64: string; mandatePda: string; programId: string }> {
  const f = params.form;
  const res = await fetch('/api/mandate/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      owner: params.owner,
      approver: f.approverPublicKey.trim(),
      agent: f.agentPublicKey.trim(),
      recentBlockhash: params.recentBlockhash,
      mandateHashHex: f.mandateHashHex.trim(),
      gateAuthority: f.gateAuthority.trim(),
      mint: f.mint.trim(),
      maxPerPayment: f.maxPerPayment,
      maxPerWindow: f.maxPerWindow,
      windowSeconds: f.windowSeconds,
      maxTotal: f.maxTotal,
      escalationThreshold: f.escalationThreshold || '0',
      notBefore: f.notBefore,
      expiresAt: f.expiresAt,
    }),
  });
  const json = (await res.json()) as { error?: string; unsignedBase64?: string; mandatePda?: string; programId?: string };
  if (!res.ok || !json.unsignedBase64 || !json.mandatePda) {
    throw new Error(json.error ?? 'Failed to prepare create_mandate');
  }
  return { unsignedBase64: json.unsignedBase64, mandatePda: json.mandatePda, programId: json.programId ?? MANDATE_PROGRAM_ID };
}

export async function prepareRevokeMandate(params: {
  mandatePda: string;
  authority: string;
  recentBlockhash: string;
}): Promise<string> {
  const res = await fetch('/api/mandate/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'revoke',
      mandatePda: params.mandatePda,
      authority: params.authority,
      recentBlockhash: params.recentBlockhash,
    }),
  });
  const json = (await res.json()) as { error?: string; unsignedBase64?: string };
  if (!res.ok || !json.unsignedBase64) throw new Error(json.error ?? 'Failed to prepare revoke_mandate');
  return json.unsignedBase64;
}

export async function fetchMandateExport(address: string): Promise<{
  export: Record<string, unknown>;
  active: boolean;
  owner: string;
  agent: string;
  revoked: boolean;
}> {
  const res = await fetch(`/api/mandate/account?address=${encodeURIComponent(address)}`);
  const json = (await res.json()) as {
    error?: string;
    export?: Record<string, unknown>;
    active?: boolean;
    account?: { owner: string; agent: string; revoked: boolean };
  };
  if (!res.ok || !json.export || !json.account) throw new Error(json.error ?? 'Failed to load mandate');
  return {
    export: json.export,
    active: Boolean(json.active),
    owner: json.account.owner,
    agent: json.account.agent,
    revoked: json.account.revoked,
  };
}

/** Signs a versioned create_mandate tx with local keypairs (approver/agent). Owner signs via wallet. */
export function cosignCreateMandate(
  unsignedBase64: string,
  cosigners: Keypair[],
): VersionedTransaction {
  const raw = Uint8Array.from(atob(unsignedBase64), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(raw);
  tx.sign(cosigners);
  return tx;
}

export function enforcementMap() {
  return [
    { field: 'Owner', onChain: true, enforcedByProgram: 'signer on create/revoke', enforcedByGate: 'off-chain mandate OWNER link' },
    { field: 'Approver', onChain: true, enforcedByProgram: 'distinct signer on create; may revoke', enforcedByGate: 'off-chain APPROVER link' },
    { field: 'Agent', onChain: true, enforcedByProgram: 'proof-of-possession signer on create', enforcedByGate: 'must match voucher signer / mandate.agent' },
    { field: 'Gate authority', onChain: true, enforcedByProgram: 'anchor_root only', enforcedByGate: 'instance attestation key' },
    { field: 'Mint', onChain: true, enforcedByProgram: 'stored; not checked at settle', enforcedByGate: 'allowedAssets / limits.mint' },
    { field: 'maxPerPayment / window / total', onChain: true, enforcedByProgram: 'stored; not checked at settle', enforcedByGate: 'evaluateGate limits' },
    { field: 'Expiry / notBefore / revoked', onChain: true, enforcedByProgram: 'is_active helpers; gate should read account', enforcedByGate: 'when ATLAS_ONCHAIN (+ optional require registry)' },
    { field: 'Allowed recipients / resources / label', onChain: false, enforcedByProgram: 'not stored', enforcedByGate: 'evaluateGate scope only' },
  ] as const;
}

export function randomMandateHashHex(): string {
  return bytesToHex(Keypair.generate().secretKey.subarray(0, 32));
}

export function legacyTransaction(base64: string): Transaction {
  return Transaction.from(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

export async function postChannel(body: Record<string, unknown>): Promise<Record<string, string>> {
  const res = await fetch('/api/mandate/channel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: string } & Record<string, string>;
  if (!res.ok) throw new Error(json.error ?? 'Channel request failed');
  return json;
}

export function isValidPubkey(value: string): boolean {
  try {
    new PublicKey(value);
    return BASE58.test(value);
  } catch {
    return false;
  }
}
