import {
  AgentMandate,
  GateAuthorization,
  MessageSigner,
  SIGNATURE_DOMAIN,
  SignedDecision,
  sha256Hex,
  verifyGateAuthorization,
} from '@atlas-rail/mandate';
import { createHash } from 'node:crypto';
import { DEFAULT_MANDATE_PROGRAM_ID, SignerAdapter, decodeTransaction, transactionMessageHash } from '@atlas-rail/solana';
import { GateAuthorizationRequiredError } from './errors';

/** What the agent side needs from its wallet: the in-process {@link GatedSignerAdapter} or a remote signer service. */
export interface AuthorizedSigner extends MessageSigner {
  signWithAuthorization(
    transactionBase64: string,
    authorization: GateAuthorization | null,
    decision: SignedDecision | null,
    mandate: AgentMandate | null,
  ): Promise<{ signedBase64: string; signature: string }>;
}

/** `<domain>\n<64 lowercase hex>`: 93 or fewer ASCII bytes starting with "a", which no Solana message can be. */
const AGENT_DOMAIN_MESSAGE = new RegExp(
  `^(${[SIGNATURE_DOMAIN.agentRequest, SIGNATURE_DOMAIN.mandateLink].map((d) => d.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})\\n[0-9a-f]{64}$`,
);

/** Anchor discriminator of `create_mandate`: sha256("global:create_mandate")[0..8]. */
const CREATE_MANDATE_DISCRIMINATOR = createHash('sha256').update('global:create_mandate').digest().subarray(0, 8);
/** `CreateMandate` accounts: mandate, owner, approver, agent, system program. */
const CREATE_MANDATE_AGENT_ACCOUNT = 3;

export function isAgentDomainMessage(message: Uint8Array): boolean {
  if (message.length > 128) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(message);
  } catch {
    return false;
  }
  return AGENT_DOMAIN_MESSAGE.test(text);
}

export interface GatedSignerOptions {
  /** The wallet that actually holds the agent key (mock keyring, or a custody vendor adapter). */
  inner: SignerAdapter & MessageSigner;
  /** Atlas Rail instance keys whose gate authorisations this wallet honours. */
  trustedInstanceKeys: readonly string[];
  /** Epoch seconds. */
  clock?: () => number;
  /** Atlas Mandate program whose `create_mandate` this key may co-sign. Defaults to the Devnet program. */
  mandateProgramId?: string;
}

/**
 * The enforcement point. Wraps any {@link SignerAdapter} so it will only sign a transaction when
 * handed a gate authorisation that (a) was issued by a trusted Atlas Rail instance, (b) covers the
 * SHA-256 of *this transaction's message bytes*, (c) was issued to *this* key, (d) is unexpired, and
 * (e) references a signed ALLOW decision that re-evaluates against the mandate chain.
 *
 * An agent that skips the client library, or is talked into paying somewhere else by a prompt
 * injection, cannot get a signature: the plain `signTransaction` always refuses, and
 * `signWithAuthorization` refuses anything the gate did not evaluate and ALLOW.
 *
 * Custody vendors (Turnkey, Privy, Crossmint, Coinbase) implement the same check inside their own
 * signing-policy hook; this class is the reference for that contract.
 */
export class GatedSignerAdapter implements SignerAdapter, AuthorizedSigner {
  readonly name: string;
  private readonly clock: () => number;

  constructor(private readonly options: GatedSignerOptions) {
    this.name = `GatedSigner(${options.inner.name})`;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  get publicKey(): string {
    return this.options.inner.publicKey;
  }

  /**
   * Signs only Atlas Rail messages the agent key legitimately signs: its gate requests and its own
   * mandate acceptance, in their exact domain-separated form. Anything else is refused: a Solana
   * transaction signature is an Ed25519 signature over the message bytes, so a "sign this message"
   * that accepted arbitrary bytes would sign any payment without the gate.
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!isAgentDomainMessage(message)) {
      throw new GateAuthorizationRequiredError('This signer only signs Atlas Rail agent requests and mandate acceptances, never arbitrary bytes');
    }
    return this.options.inner.signMessage(message);
  }

  /** Always refuses: every payment signature must carry a gate authorisation. */
  async signTransaction(_transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    void _transactionBase64;
    throw new GateAuthorizationRequiredError();
  }

  async signWithAuthorization(
    transactionBase64: string,
    authorization: GateAuthorization | null,
    decision: SignedDecision | null,
    mandate: AgentMandate | null,
  ): Promise<{ signedBase64: string; signature: string }> {
    if (!authorization) throw new GateAuthorizationRequiredError('No gate authorisation was provided for this transaction');
    if (!decision || !mandate) {
      throw new GateAuthorizationRequiredError('No signed ALLOW decision and mandate were provided for this transaction');
    }
    let messageHash: string;
    try {
      messageHash = transactionMessageHash(decodeTransaction(transactionBase64));
    } catch {
      throw new GateAuthorizationRequiredError('Transaction could not be decoded');
    }
    const check = verifyGateAuthorization(authorization, {
      trustedInstanceKeys: this.options.trustedInstanceKeys,
      now: this.clock(),
      txMessageHash: messageHash,
      agentPublicKey: this.publicKey,
      decision,
      mandate,
    });
    if (!check.ok) throw new GateAuthorizationRequiredError(check.error ?? 'Gate authorisation is not valid');
    return this.options.inner.signTransaction(transactionBase64);
  }

  /**
   * Co-signs one `create_mandate` that names this key as the agent. The program requires the agent's
   * signature as proof of possession, and the key never leaves this process. Anything else is
   * refused: another instruction, another program, this key as fee payer or as a writable account.
   * So the signature can name this key in a mandate and cannot move funds.
   */
  async signMandateCreation(transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    let tx: ReturnType<typeof decodeTransaction>;
    try {
      tx = decodeTransaction(transactionBase64);
    } catch {
      throw new GateAuthorizationRequiredError('Transaction could not be decoded');
    }
    const { message } = tx;
    const keys = message.staticAccountKeys.map((key) => key.toBase58());
    const ix = message.compiledInstructions;
    if (message.addressTableLookups.length > 0 || ix.length !== 1) {
      throw new GateAuthorizationRequiredError('Only a transaction with exactly one create_mandate can be co-signed');
    }
    const [create] = ix;
    if (keys[create.programIdIndex] !== (this.options.mandateProgramId ?? DEFAULT_MANDATE_PROGRAM_ID)) {
      throw new GateAuthorizationRequiredError('Instruction is not for the Atlas Mandate program');
    }
    if (!Buffer.from(create.data).subarray(0, 8).equals(CREATE_MANDATE_DISCRIMINATOR)) {
      throw new GateAuthorizationRequiredError('Instruction is not create_mandate');
    }
    if (keys[create.accountKeyIndexes[CREATE_MANDATE_AGENT_ACCOUNT]] !== this.publicKey) {
      throw new GateAuthorizationRequiredError('create_mandate does not name this key as the agent');
    }
    const index = keys.indexOf(this.publicKey);
    if (index === 0 || message.isAccountWritable(index)) {
      throw new GateAuthorizationRequiredError('The agent key may not pay fees or be a writable account');
    }
    return this.options.inner.signTransaction(transactionBase64);
  }

  /**
   * Signs the payment-channels voucher payload (exactly 50 bytes, magic `V\\x01`) only when a fresh
   * gate authorisation covers SHA-256 of those bytes. Raw `signMessage` still refuses them.
   */
  async signVoucherWithAuthorization(
    message: Uint8Array,
    authorization: GateAuthorization | null,
    decision: SignedDecision | null,
    mandate: AgentMandate | null,
  ): Promise<{ signature: Uint8Array }> {
    if (message.length !== 50 || message[0] !== 0x56 || message[1] !== 0x01) {
      throw new GateAuthorizationRequiredError('Voucher message must be the 50-byte payment-channels payload');
    }
    if (!authorization) throw new GateAuthorizationRequiredError('No gate authorisation was provided for this voucher');
    if (!decision || !mandate) {
      throw new GateAuthorizationRequiredError('No signed ALLOW decision and mandate were provided for this voucher');
    }
    const check = verifyGateAuthorization(authorization, {
      trustedInstanceKeys: this.options.trustedInstanceKeys,
      now: this.clock(),
      txMessageHash: sha256Hex(message),
      agentPublicKey: this.publicKey,
      decision,
      mandate,
    });
    if (!check.ok) throw new GateAuthorizationRequiredError(check.error ?? 'Gate authorisation is not valid');
    return { signature: await this.options.inner.signMessage(message) };
  }
}
