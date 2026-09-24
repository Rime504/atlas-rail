import {
  MessageSigner,
  hashCanonical,
  signDomainHash,
  verifyDomainHash,
  SIGNATURE_DOMAIN,
  toHex,
} from './crypto';
import { JsonValue } from './jcs';
import {
  AgentMandate,
  AgentMandateBody,
  DelegationLink,
  DelegationRole,
  MANDATE_TYPE,
  MANDATE_VERSION,
  agentMandateSchema,
  mandateBodySchema,
} from './schema';

/* -------------------------------------------------------------------------------------------------
 * Creation
 * -----------------------------------------------------------------------------------------------*/

export interface CreateMandateInput {
  issuer: AgentMandateBody['issuer'];
  agent: AgentMandateBody['agent'];
  scope: AgentMandateBody['scope'];
  escalation: AgentMandateBody['escalation'];
  delegation?: Partial<AgentMandateBody['delegation']>;
  notBefore: number;
  expiresAt: number;
  /** Provide for deterministic tests; generated from a CSPRNG otherwise. */
  id?: string;
  nonce?: string;
}

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateMandateId(): string {
  const bytes = randomBytes(20);
  let suffix = '';
  for (const byte of bytes) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `mnd_${suffix}`;
}

export function generateMandateNonce(): string {
  return toHex(randomBytes(16));
}

/** Validates and assembles an unsigned mandate (empty delegation chain). Throws on invalid input. */
export function createMandate(input: CreateMandateInput): AgentMandate {
  const body = mandateBodySchema.parse({
    type: MANDATE_TYPE,
    version: MANDATE_VERSION,
    id: input.id ?? generateMandateId(),
    issuer: input.issuer,
    agent: input.agent,
    delegation: { requiredApprovals: 1, preventIssuerApproval: true, ...input.delegation },
    scope: input.scope,
    escalation: input.escalation,
    notBefore: input.notBefore,
    expiresAt: input.expiresAt,
    nonce: input.nonce ?? generateMandateNonce(),
    revocable: true,
  });
  return { ...body, delegationChain: [] };
}

/* -------------------------------------------------------------------------------------------------
 * Hashing and delegation-link signing
 * -----------------------------------------------------------------------------------------------*/

/** The signed content of a mandate: everything except the delegation chain. */
export function mandateBody(mandate: AgentMandate): AgentMandateBody {
  const { delegationChain: _chain, ...body } = mandate;
  void _chain;
  return body;
}

/** SHA-256 (hex) of the JCS-canonical mandate body. Independent of the delegation chain. */
export function hashMandate(mandate: AgentMandate | AgentMandateBody): string {
  const { delegationChain: _chain, ...body } = mandate as AgentMandate;
  void _chain;
  return hashCanonical(body as unknown as JsonValue);
}

interface LinkPayload {
  type: 'atlasrail.mandate-link';
  version: typeof MANDATE_VERSION;
  mandateHash: string;
  index: number;
  role: DelegationRole;
  publicKey: string;
  previousSignature: string | null;
}

/**
 * The hash each link signs. It commits to the mandate hash, the link's position and role, the
 * signer's key and the previous link's signature, so links cannot be re-ordered, dropped,
 * duplicated or moved between mandates without invalidating every later signature.
 */
export function linkHash(
  mandateHash: string,
  index: number,
  role: DelegationRole,
  publicKey: string,
  previousSignature: string | null,
): string {
  const payload: LinkPayload = {
    type: 'atlasrail.mandate-link',
    version: MANDATE_VERSION,
    mandateHash,
    index,
    role,
    publicKey,
    previousSignature,
  };
  return hashCanonical(payload as unknown as JsonValue);
}

const NEXT_ROLES: Record<DelegationRole | 'START', DelegationRole[]> = {
  START: ['OWNER'],
  OWNER: ['APPROVER'],
  APPROVER: ['APPROVER', 'AGENT'],
  AGENT: [],
};

export class MandateSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MandateSigningError';
  }
}

/**
 * Appends a signature link for `role`. Enforces chain order (OWNER, then one or more APPROVERs,
 * then the AGENT), that no key signs twice, and that an AGENT link is made by the key named in
 * `mandate.agent`. Returns a new mandate; the input is not mutated.
 */
export async function signMandate(
  mandate: AgentMandate,
  options: { role: DelegationRole; signer: MessageSigner },
): Promise<AgentMandate> {
  const { role, signer } = options;
  const chain = mandate.delegationChain;
  const previous = chain.length > 0 ? chain[chain.length - 1] : null;
  const allowed = NEXT_ROLES[previous ? previous.role : 'START'];

  if (!allowed.includes(role)) {
    throw new MandateSigningError(
      `Cannot add a ${role} signature after ${previous ? previous.role : 'an empty chain'}; expected ${
        allowed.join(' or ') || 'no further signatures'
      }`,
    );
  }
  if (chain.some((link) => link.publicKey === signer.publicKey)) {
    throw new MandateSigningError('This key has already signed the mandate; approvers must be independent');
  }
  if (role === 'AGENT' && signer.publicKey !== mandate.agent.publicKey) {
    throw new MandateSigningError('The AGENT link must be signed by the key named in mandate.agent');
  }
  if (role === 'AGENT') {
    const approvals = chain.filter((link) => link.role === 'APPROVER').length;
    if (approvals < mandate.delegation.requiredApprovals) {
      throw new MandateSigningError(
        `Mandate requires ${mandate.delegation.requiredApprovals} independent approver signature(s) before the agent accepts`,
      );
    }
  }

  const hash = linkHash(hashMandate(mandate), chain.length, role, signer.publicKey, previous?.signature ?? null);
  const signature = await signDomainHash(signer, SIGNATURE_DOMAIN.mandateLink, hash);
  const link: DelegationLink = { role, publicKey: signer.publicKey, signature };
  return { ...mandate, delegationChain: [...chain, link] };
}

/* -------------------------------------------------------------------------------------------------
 * Verification
 * -----------------------------------------------------------------------------------------------*/

export interface VerificationCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface MandateVerification {
  valid: boolean;
  checks: VerificationCheck[];
  /** Messages of failed checks, for logging and error responses. */
  errors: string[];
}

function finish(checks: VerificationCheck[]): MandateVerification {
  return { valid: checks.every((c) => c.ok), checks, errors: checks.filter((c) => !c.ok).map((c) => c.message) };
}

export interface VerifyChainOptions {
  /** When set, every signer key must be present here with a role it is allowed to sign as. */
  trustedKeys?: ReadonlyMap<string, readonly DelegationRole[]>;
}

/**
 * Verifies everything that can be checked from the mandate document alone: schema, chain shape,
 * every Ed25519 signature, distinct signers, the independent-approver rule and that the accepting
 * agent is the agent the mandate names. It does NOT look at time or revocation; see
 * {@link verifyMandate} for those.
 */
export function verifyMandateChain(input: unknown, options: VerifyChainOptions = {}): MandateVerification {
  const checks: VerificationCheck[] = [];
  const parsed = agentMandateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    checks.push({
      id: 'SCHEMA',
      ok: false,
      message: `Mandate does not match the v${MANDATE_VERSION} schema: ${first.path.join('.') || '<root>'}: ${first.message}`,
    });
    return finish(checks);
  }
  checks.push({ id: 'SCHEMA', ok: true, message: `Mandate matches the v${MANDATE_VERSION} schema` });

  const mandate = parsed.data as AgentMandate;
  const chain = mandate.delegationChain;
  const mandateHash = hashMandate(mandate);

  // Shape: OWNER, APPROVER+, AGENT — nothing else, nothing missing.
  let shapeError: string | null = null;
  let expectedFrom: DelegationRole | 'START' = 'START';
  for (const link of chain) {
    if (!NEXT_ROLES[expectedFrom].includes(link.role)) {
      shapeError = `Unexpected ${link.role} link after ${expectedFrom === 'START' ? 'start' : expectedFrom}`;
      break;
    }
    expectedFrom = link.role;
  }
  if (!shapeError && expectedFrom !== 'AGENT') {
    shapeError = 'Delegation chain is incomplete: it must end with the AGENT acceptance';
  }
  checks.push({
    id: 'CHAIN_SHAPE',
    ok: shapeError === null,
    message: shapeError ?? 'Delegation chain is ordered OWNER → APPROVER(s) → AGENT',
  });
  if (shapeError) return finish(checks);

  // Signatures: each link commits to the previous signature and its own position.
  let signatureError: string | null = null;
  chain.forEach((link, index) => {
    if (signatureError) return;
    const previous = index > 0 ? chain[index - 1].signature : null;
    const hash = linkHash(mandateHash, index, link.role, link.publicKey, previous);
    if (!verifyDomainHash(link.publicKey, SIGNATURE_DOMAIN.mandateLink, hash, link.signature)) {
      signatureError = `Signature of link ${index} (${link.role}) does not verify`;
    }
  });
  checks.push({
    id: 'CHAIN_SIGNATURES',
    ok: signatureError === null,
    message: signatureError ?? `All ${chain.length} delegation signatures verify against the mandate hash`,
  });

  // Independent signers.
  const keys = chain.map((link) => link.publicKey);
  const distinct = new Set(keys).size === keys.length;
  checks.push({
    id: 'DISTINCT_SIGNERS',
    ok: distinct,
    message: distinct ? 'Every link is signed by a different key' : 'A key appears more than once in the delegation chain',
  });

  const approverCount = chain.filter((link) => link.role === 'APPROVER').length;
  const enoughApprovers = approverCount >= mandate.delegation.requiredApprovals;
  checks.push({
    id: 'INDEPENDENT_APPROVERS',
    ok: enoughApprovers && distinct,
    message:
      enoughApprovers && distinct
        ? `${approverCount} independent approver(s) signed (required ${mandate.delegation.requiredApprovals}); issuer key did not approve`
        : `Mandate requires ${mandate.delegation.requiredApprovals} independent approver(s) but has ${approverCount}`,
  });

  const agentLink = chain[chain.length - 1];
  const agentMatches = agentLink.publicKey === mandate.agent.publicKey;
  checks.push({
    id: 'AGENT_ACCEPTANCE',
    ok: agentMatches,
    message: agentMatches
      ? 'The named agent key accepted the mandate'
      : 'The AGENT link was not signed by the key named in mandate.agent',
  });

  if (options.trustedKeys) {
    const untrusted = chain.find((link) => !options.trustedKeys?.get(link.publicKey)?.includes(link.role));
    checks.push({
      id: 'TRUSTED_SIGNERS',
      ok: !untrusted,
      message: untrusted
        ? `Key ${untrusted.publicKey} is not trusted to sign as ${untrusted.role}`
        : 'Every signer is a trusted key for its role',
    });
  }

  return finish(checks);
}

export interface RevocationRecord {
  revokedAt: number;
  reason?: string | null;
}

export interface VerifyMandateOptions extends VerifyChainOptions {
  /** Epoch seconds. Required: the verifier decides what "now" is, never the mandate. */
  now: number;
  /** Returns the revocation record for this mandate id, if any. */
  revocation?: (mandateId: string) => RevocationRecord | null | undefined;
  /** Returns true if the (issuer, nonce) pair has been registered before by a different mandate id. */
  nonceSeen?: (organizationId: string, nonce: string, mandateId: string) => boolean;
}

/** Chain verification plus validity window, revocation and nonce-replay checks. */
export function verifyMandate(input: unknown, options: VerifyMandateOptions): MandateVerification {
  const chainResult = verifyMandateChain(input, options);
  if (!chainResult.checks.find((c) => c.id === 'SCHEMA')?.ok) return chainResult;
  const mandate = input as AgentMandate;
  const checks = [...chainResult.checks];

  const started = options.now >= mandate.notBefore;
  const notExpired = options.now < mandate.expiresAt;
  checks.push({
    id: 'VALIDITY_WINDOW',
    ok: started && notExpired,
    message: !started
      ? `Mandate is not valid before ${mandate.notBefore}`
      : !notExpired
        ? `Mandate expired at ${mandate.expiresAt}`
        : 'Current time is inside the mandate validity window',
  });

  const revocation = options.revocation?.(mandate.id) ?? null;
  checks.push({
    id: 'NOT_REVOKED',
    ok: revocation === null,
    message: revocation ? `Mandate was revoked at ${revocation.revokedAt}` : 'Mandate has not been revoked',
  });

  const replayed = options.nonceSeen?.(mandate.issuer.organizationId, mandate.nonce, mandate.id) ?? false;
  checks.push({
    id: 'NONCE_FRESH',
    ok: !replayed,
    message: replayed ? 'Mandate nonce was already used by another mandate (replay)' : 'Mandate nonce is unique',
  });

  return finish(checks);
}

