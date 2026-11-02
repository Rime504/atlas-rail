/**
 * A tiny x402 v2 "exact" seller on Solana Devnet, for testing Atlas Rail as a pay.sh spending
 * authority. GET /data?price=<base units>&to=<recipient> answers 402 with one exact offer. A request
 * with a Payment-Signature header gets the buyer-signed transaction checked (one transfer of the
 * price of the mint to the recipient), co-signed as fee payer, sent to Devnet, and confirmed.
 * Counts how many payments really landed, so a test can prove "pay did not pay".
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const { Connection, PublicKey, VersionedTransaction } = requireAtlas('@solana/web3.js');
const { getAssociatedTokenAddressSync } = requireAtlas('@solana/spl-token');

export const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** TransferChecked (12) of exactly `amount` of `mint` into the recipient's token account. */
function paysExactly(tx, { mint, recipient, amount }) {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const destination = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(recipient), true).toBase58();
  const transfers = tx.message.compiledInstructions.filter((ix) => keys[ix.programIdIndex] === TOKEN_PROGRAM && ix.data[0] === 12);
  if (transfers.length !== 1) return false;
  const [ix] = transfers;
  const data = Buffer.from(ix.data);
  return keys[ix.accountKeyIndexes[1]] === mint && keys[ix.accountKeyIndexes[2]] === destination && data.readBigUInt64LE(1) === BigInt(amount);
}

export async function startMerchant({ rpcUrl, mint, feePayer, defaultRecipient, port = 0 }) {
  const connection = new Connection(rpcUrl, 'confirmed');
  const state = { probes: 0, paid: 0, signatures: [], rejected: [] };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const url = new URL(req.url ?? '/', 'http://merchant');
      const price = url.searchParams.get('price') ?? '10000';
      const recipient = url.searchParams.get('to') ?? defaultRecipient;
      const resource = `http://${req.headers.host}${url.pathname}${url.search}`;
      const offer = {
        scheme: 'exact', network: DEVNET_CAIP2, asset: mint, amount: price, payTo: recipient,
        maxTimeoutSeconds: 60, extra: { feePayer: feePayer.publicKey.toBase58(), decimals: 6 },
      };
      const header = req.headers['payment-signature'];
      if (!header) {
        state.probes += 1;
        const challenge = { x402Version: 2, resource: { url: resource, mimeType: 'application/json' }, accepts: [offer] };
        res.writeHead(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64') });
        res.end(JSON.stringify(challenge));
        return;
      }
      try {
        const envelope = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
        const tx = VersionedTransaction.deserialize(Buffer.from(envelope.payload.transaction, 'base64'));
        if (!paysExactly(tx, { mint, recipient, amount: price })) throw new Error('transaction does not pay exactly the offer');
        tx.sign([feePayer]);
        const signature = await connection.sendRawTransaction(tx.serialize());
        const confirmed = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmed.value.err) throw new Error(`payment failed on-chain: ${JSON.stringify(confirmed.value.err)}`);
        state.paid += 1;
        state.signatures.push(signature);
        res.writeHead(200, { 'content-type': 'application/json', 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: signature, network: DEVNET_CAIP2 })).toString('base64') });
        res.end(JSON.stringify({ delivered: true, signature }));
      } catch (error) {
        state.rejected.push(error instanceof Error ? error.message : String(error));
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'payment rejected' }));
      }
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((resolve) => server.close(resolve)) };
}
