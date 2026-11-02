import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createUserKey, connectWallet } from './atlasrails-pipeline.mjs';
import { payerKeypair } from './channel-voucher-devnet.mjs';

test('atlasrails key is the wallet the channel pipeline pays with', () => {
  const root = tmpdir();
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'atlasrails-pipeline-'));
  const path = join(dir, 'user.json');
  const previous = process.env.ATLAS_RAILS_KEY_PATH;
  try {
    const user = createUserKey(path);
    const again = createUserKey(path);
    const wallet = connectWallet(path, 'https://api.devnet.solana.com');
    assert.equal(user.created, true);
    assert.equal(again.created, false);
    assert.equal(again.publicKey, user.publicKey);
    assert.equal(wallet.publicKey, user.publicKey);
    process.env.ATLAS_RAILS_KEY_PATH = path;
    assert.equal(payerKeypair().publicKey.toBase58(), user.publicKey);
  } finally {
    if (previous === undefined) delete process.env.ATLAS_RAILS_KEY_PATH;
    else process.env.ATLAS_RAILS_KEY_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
