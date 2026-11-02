/**
 * Wires one atlasrails user key into the existing channel pipeline.
 * Creates the key, connects that wallet, tops it up from the fee payer, then
 * channel-voucher-devnet.mjs creates the mandate, mints the voucher key, deposits, and settles.
 * Run: node scripts/atlasrails-pipeline.mjs <key-path>
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFeePayer, main } from './channel-voucher-devnet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireRails = createRequire(join(root, 'packages/atlasrails/package.json'));
const { init, connect } = requireRails(join(root, 'packages/atlasrails/dist/index.js'));
const { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = createRequire(join(root, 'packages/solana/package.json'))('@solana/web3.js');


export function createUserKey(path) {
  return init({ path });
}

export function connectWallet(path, rpcUrl) {
  return connect({ path, rpcUrl });
}

export async function fundWallet(connection, publicKey) {
  if (!process.env.ATLAS_FEE_RESERVE) throw new Error('ATLAS_FEE_RESERVE is required');
  const reserve = BigInt(process.env.ATLAS_FEE_RESERVE);
  const have = BigInt(await connection.getBalance(new PublicKey(publicKey), 'confirmed'));
  if (have >= reserve) return { lamports: 0n };
  const funder = loadFeePayer();
  if (funder.publicKey.toBase58() === publicKey) return { lamports: 0n };
  const lamports = reserve - have;
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: new PublicKey(publicKey),
      lamports: Number(lamports),
    })),
    [funder],
  );
  return { lamports, signature };
}

export async function run(path) {
  if (!path) throw new Error('Pass the atlasrails key path');
  const user = createUserKey(path);
  const wallet = connectWallet(path, process.env.SOLANA_RPC_URL);
  if (wallet.publicKey !== user.publicKey) throw new Error('Connected account is not the stored key');
  const funded = await fundWallet(wallet.connection, user.publicKey);
  process.env.ATLAS_RAILS_KEY_PATH = path;
  process.env.ATLAS_FEE_PAYER = user.publicKey;
  console.log(`atlasrails ${user.publicKey} created=${user.created} fundedLamports=${funded.lamports}`);
  await main();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
