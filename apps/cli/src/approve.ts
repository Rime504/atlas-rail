import { readFileSync } from 'fs';
import { LocalEd25519Signer, ownerApprovalText, toBase58, type ApprovalSigner, type OwnerApprovalTerms } from '@atlas-rail/mandate';

export interface ApproveOptions {
  id: string;
  /** Solana CLI key file (JSON array of 64 bytes) of the owner or an approver. */
  keypair: string;
  /** Atlas Rail API base URL. */
  api: string | null;
  /** Without it, show what would be signed and send nothing. */
  yes: boolean;
  fetch?: typeof fetch;
  out?: (line: string) => void;
}

interface ToSign {
  status: string;
  reason: string;
  terms: OwnerApprovalTerms;
  message: string;
  signers: ApprovalSigner[];
}

/**
 * `atlas approve <id>`: the owner's or an approver's key signs one over-limit payment. The text is
 * rebuilt here from the terms and must equal what the API sent, so the server cannot get a
 * signature over anything the owner did not see.
 */
export async function runApprove(options: ApproveOptions): Promise<number> {
  const out = options.out ?? console.log;
  const doFetch = options.fetch ?? fetch;
  const api = (options.api ?? process.env.ATLAS_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  let key: LocalEd25519Signer;
  try {
    key = new LocalEd25519Signer(Uint8Array.from(JSON.parse(readFileSync(options.keypair, 'utf8')) as number[]));
  } catch {
    out(`Cannot read the key file ${options.keypair}`);
    return 2;
  }
  const response = await doFetch(`${api}/v1/owner-approvals/${encodeURIComponent(options.id)}`);
  if (!response.ok) {
    out(`The API did not return approval ${options.id} (HTTP ${response.status})`);
    return 2;
  }
  const found = (await response.json()) as ToSign;
  const expected = ownerApprovalText(found.terms);
  if (found.message !== expected) {
    out('The text the API asks you to sign does not match the payment terms. Nothing was signed.');
    return 1;
  }
  out(found.message);
  out('');
  out(`Why: ${found.reason}`);
  out(`Status: ${found.status}`);
  const signer = found.signers.find((s) => s.publicKey === key.publicKey);
  if (!signer) {
    out(`Key ${key.publicKey} is not an owner or approver of this mandate. Nothing was signed.`);
    return 1;
  }
  if (found.status !== 'PENDING') {
    out('This request is not open any more. Nothing was signed.');
    return 1;
  }
  if (!options.yes) {
    out(`Run again with --yes to sign this as the mandate's ${signer.role.toLowerCase()} ${key.publicKey}.`);
    return 0;
  }
  const signature = toBase58(await key.signMessage(new TextEncoder().encode(expected)));
  const posted = await doFetch(`${api}/v1/owner-approvals/${encodeURIComponent(options.id)}/signature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheme: 'ed25519', signer: key.publicKey, signature }),
  });
  const result = (await posted.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!posted.ok) {
    out(`Not approved: ${result.message ?? `HTTP ${posted.status}`}`);
    return 1;
  }
  out(`Approved (${result.status}). The agent may make this one payment, once.`);
  return 0;
}
