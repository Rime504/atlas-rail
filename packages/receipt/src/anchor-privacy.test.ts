import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import { encodeBatchFile } from './batch-file';

const PRIVATE = {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  phone: '+15551212',
  resource: 'https://merchant.example/orders/4821',
  purpose: 'March freight invoice',
  voucher: '{"type":"atlasrail.voucher","signature":"secret"}',
  amount: '1000000',
  payTo: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  denial: 'recipient not on the allow list',
};

describe('anchor batch privacy', () => {
  it('the batch file stores salts and receipt hashes, not the private fields', () => {
    const receiptHash = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(PRIVATE))));
    const file = encodeBatchFile({
      mandate: new Uint8Array(32),
      seq: 0n,
      leaves: [{ receiptHash, salt: '11'.repeat(32) }],
    });
    const text = Buffer.from(file).toString('latin1');
    for (const value of Object.values(PRIVATE)) expect(text).not.toContain(value);
    expect(text).not.toContain('atlasrail:anchor:v1:');
    expect(text).not.toContain('atlasrail:receipt:');
  });
});
