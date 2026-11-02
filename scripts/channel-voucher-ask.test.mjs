/**
 * The script's voucher client. It must call the API and must not invent a signature when the API refuses.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

const hits = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    hits.push(body.recipient);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (body.recipient === 'deny') {
      res.end(JSON.stringify({ signed: false, message: 'MandateDeniedError' }));
      return;
    }
    res.end(
      JSON.stringify({
        signed: true,
        signatureBase64: Buffer.alloc(64, 7).toString('base64'),
        messageBase64: Buffer.alloc(50, 1).toString('base64'),
        messageHash: 'abc',
        decision: { record: { offer: { network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' } } },
      }),
    );
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
process.env.ATLAS_API_URL = `http://127.0.0.1:${server.address().port}`;
const { askAtlasRail } = await import('./channel-voucher-devnet.mjs');

test('askAtlasRail posts the voucher and returns a signature only when the API signed', async () => {
  const denied = await askAtlasRail({ recipient: 'deny' });
  assert.equal(denied.signed, false);
  assert.equal(denied.signatureBase64, undefined);
  const allowed = await askAtlasRail({ recipient: 'allow' });
  assert.equal(allowed.signed, true);
  assert.equal(Buffer.from(allowed.signatureBase64, 'base64').length, 64);
  assert.deepEqual(hits, ['deny', 'allow']);

  process.env.ATLAS_API_URL = 'http://127.0.0.1:9';
  await assert.rejects(askAtlasRail({ recipient: 'allow' }), /Atlas Rail API is down/);
  assert.deepEqual(hits, ['deny', 'allow']);
});

test.after(async () => {
  server.close();
  await once(server, 'close');
});
