import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const payer = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before imports
  const { Keypair } = require('@solana/web3.js') as typeof import('@solana/web3.js');
  return Keypair.generate();
});
const spawn = vi.hoisted(() => vi.fn());
const denialSigned = vi.hoisted(() => ({ value: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (String(args[0]).includes('solana-home')) return JSON.stringify(Array.from(payer.secretKey));
      return actual.readFileSync(...args);
    },
  };
});

vi.mock('node:child_process', () => ({
  spawn,
}));

function scriptChild(stdout: string) {
  return {
    stdout: {
      on(event: string, cb: (chunk: Buffer) => void) {
        if (event === 'data') cb(Buffer.from(stdout));
      },
    },
    stderr: { on() {} },
    on(event: string, cb: (code?: number) => void) {
      if (event === 'close') cb(0);
    },
  };
}

function reportFor(script: string): string {
  if (script.endsWith('channel-voucher-anchor.mjs')) {
    return JSON.stringify({
      anchorSignature: 'a'.repeat(88),
      rootPda: 'Fu9zto1sWKMTRdsVrn5nHtcJFb9rbMLw5QjJoBZmGsz5',
      channel: '7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM',
      merkleRoot: 'ab',
      receiptId: 'rcp_demo',
      deposit: '20000',
      settled: '10000',
    });
  }
  return JSON.stringify({
    settleSignature: 'b'.repeat(88),
    channel: '7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM',
    denial: { signed: denialSigned.value, message: 'MandateDeniedError' },
    receiptId: 'rcp_demo',
  });
}

const { GET, POST } = await import('./route');
const { LOCAL_ONLY } = await import('../../../lib/voucher-demo');

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/voucher-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

describe('POST /api/voucher-demo', () => {
  beforeEach(() => {
    process.env.ATLAS_FUNDER_KEY_PATH = 'keys/solana-home/id.json';
    denialSigned.value = false;
    spawn.mockReset();
    spawn.mockImplementation((_exe: string, args: string[]) => scriptChild(reportFor(args[0] ?? '')));
  });

  it('the demo will not pay until the mandate is accepted, and it does not call /api/step', () => {
    const source = readFileSync(join(__dirname, '../../demo/page.tsx'), 'utf8');
    expect(source).toContain('if (!address || !mandateReady) return');
    expect(source).toContain("fetch('/api/voucher-demo'");
    expect(source).not.toMatch(/fetch\(\s*['"]\/api\/step['"]/);
  });

  it('checks the connected payer before it runs the channel scripts', async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post('not-json', true))).status).toBe(400);
    const wrong = await POST(post({ payer: '1'.repeat(32) }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: expect.stringMatching(/fee payer/i) });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('on Vercel says the demo runs locally, and never reads the fee payer key', async () => {
    process.env.VERCEL = '1';
    try {
      const get = await GET();
      expect(get.status).toBe(501);
      expect(await get.json()).toEqual({ error: LOCAL_ONLY, localOnly: true });
      const res = await POST(post({ payer: payer.publicKey.toBase58() }));
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({ error: 'This demo runs locally. See the video.' });
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERCEL;
    }
    expect(await (await GET()).json()).toEqual({ localOnly: false });
  });

  it('runs the voucher scripts for the fee payer and leaves the denied recipient unsigned', async () => {
    const res = await POST(post({ payer: payer.publicKey.toBase58() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { denial: { signed: boolean; message: string }; payer: string };
    expect(body.payer).toBe(payer.publicKey.toBase58());
    expect(body.denial).toEqual({ signed: false, message: 'MandateDeniedError' });
    const scripts = spawn.mock.calls.map((call) => String((call[1] as string[] | undefined)?.[0] ?? ''));
    expect(scripts.some((script) => script.endsWith('channel-voucher-devnet.mjs'))).toBe(true);
    expect(scripts.some((script) => script.endsWith('channel-voucher-anchor.mjs'))).toBe(true);
    const env = (spawn.mock.calls[0]?.[2] as { env?: { ATLAS_FEE_PAYER?: string } } | undefined)?.env;
    expect(env?.ATLAS_FEE_PAYER).toBe(payer.publicKey.toBase58());
  });
});
