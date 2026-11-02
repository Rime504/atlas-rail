/**
 * End-to-end agent payment. Import atlasrails, read .env, then
 * store the wallet, connect, create the payee and voucher keys,
 * open the mandate, deposit, sign the voucher, settle, and withdraw.
 *
 * From this directory: node --experimental-strip-types agent-payment.ts
 */
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginPayment,
  buildSignedMandate,
  connect,
  createDemoMint,
  createVoucher,
  createVoucherKey,
  depositUpfront,
  importFunder,
  init,
  loadEnv,
  payPayee,
  settleChannel,
  withdrawRemainder,
  type MandatePayment,
} from 'atlasrails';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
const env = loadEnv({ path: envFile });

function required(name: string): string {
  const value = env[name] ?? process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredPath(name: string): string {
  const value = required(name);
  return isAbsolute(value) ? value : join(root, value);
}

const now = Math.floor(Date.now() / 1000);
const keyPath = requiredPath('ATLAS_FUNDER_KEY_PATH');
const payeePath = requiredPath('ATLAS_PAYEE_KEY_PATH');

const payment = {
  path: keyPath,
  envFile,
  organizationId: required('ATLAS_ORGANIZATION_ID'),
  issuerName: required('ATLAS_ISSUER_NAME'),
  resource: required('ATLAS_RESOURCE'),
  resourceUrl: required('ATLAS_RESOURCE_URL'),
  deposit: required('ATLAS_DEPOSIT'),
  settled: required('ATLAS_SETTLED'),
  maxPerPayment: required('ATLAS_MAX_PER_PAYMENT'),
  maxPerWindow: required('ATLAS_MAX_PER_WINDOW'),
  windowSeconds: Number(required('ATLAS_WINDOW_SECONDS')),
  maxTotal: required('ATLAS_MAX_TOTAL'),
  thresholdBaseUnits: required('ATLAS_THRESHOLD'),
  approvalTtlSeconds: Number(required('ATLAS_APPROVAL_TTL_SECONDS')),
  requiredApprovals: Number(required('ATLAS_REQUIRED_APPROVALS')),
  notBefore: now - Number(required('ATLAS_VALID_AFTER_SECONDS')),
  expiresAt: now + Number(required('ATLAS_VALID_FOR_SECONDS')),
  voucherExpiresAt: now + Number(required('ATLAS_VOUCHER_TTL_SECONDS')),
  graceSeconds: Number(required('ATLAS_GRACE_SECONDS')),
  salt: required('ATLAS_CHANNEL_SALT'),
  network: required('ATLAS_NETWORK'),
  payeePath,
  deniedRecipient: required('ATLAS_DENIED_RECIPIENT'),
  ownerSeed: required('ATLAS_OWNER_SEED'),
  approverSeed: required('ATLAS_APPROVER_SEED'),
  instanceSeed: required('ATLAS_INSTANCE_SEED'),
  apiUrl: required('ATLAS_API_URL'),
  signerUrl: required('ATLAS_SIGNER_URL'),
  rpcUrl: required('SOLANA_RPC_URL'),
} satisfies MandatePayment;

const account = importFunder({ path: keyPath, envFile });
const wallet = connect({ path: keyPath, rpcUrl: payment.rpcUrl });
const payee = init({ path: payeePath });
console.log(`wallet ${account.publicKey}`);
console.log(`connected ${wallet.publicKey}`);
console.log(`payee ${payee.publicKey}`);

const session = await beginPayment(payment);
await createDemoMint(session);
const voucherKey = await createVoucherKey(session);
console.log(`voucher signer ${voucherKey.publicKey}`);

const mandate = await buildSignedMandate(session);
console.log(`mandate ${mandate.mandateId} mint ${mandate.mint}`);

const deposited = await depositUpfront(session);
console.log(`deposited ${deposited.deposit} channel ${deposited.channel}`);

const voucher = await createVoucher(session);
console.log(`voucher ${voucher.messageHash}`);

const settled = await settleChannel(session);
console.log(`settled ${settled.settleSignature}`);

const paid = await payPayee(session);
console.log(`payee received ${paid.payeeReceived}`);

const withdrawn = await withdrawRemainder(session);
console.log(`remainder ${withdrawn.payerRemainder}`);
