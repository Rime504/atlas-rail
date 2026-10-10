import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFinal } from './verify-cache';

describe('isFinal: which /verify answers may be cached', () => {
  it('caches answers that can never change', () => {
    expect(isFinal('PROVEN', false)).toBe(true);
    expect(isFinal('INVALID', false)).toBe(true);
    expect(isFinal('NO_PROOF', false)).toBe(true); // no memo, failed transaction, or a receipt for another tx
  });

  it('never caches a receipt that may just not be readable yet, or a transaction an RPC node has not seen', () => {
    expect(isFinal('NO_PROOF', true)).toBe(false);
    expect(isFinal('NOT_FOUND', false)).toBe(false);
  });
});

describe('vercelBlob.read: existence from the store API, not a cacheable URL', () => {
  afterEach(() => {
    vi.doUnmock('@vercel/blob');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function storeWith(head: (pathname: string) => Promise<unknown>) {
    vi.resetModules();
    vi.doMock('@vercel/blob', async () => {
      const actual = await vi.importActual<typeof import('@vercel/blob')>('@vercel/blob');
      return { ...actual, head: vi.fn(head) };
    });
    return (await import('./receipt-store')).vercelBlob;
  }

  it('a missing record is null, decided by head()', async () => {
    const { BlobNotFoundError } = await vi.importActual<typeof import('@vercel/blob')>('@vercel/blob');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const store = await storeWith(async () => {
      throw new BlobNotFoundError();
    });
    expect(await store.read('receipts/rcp_x.json')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an existing record is fetched at a URL tagged with its upload time, bypassing cached misses', async () => {
    const uploadedAt = new Date('2026-10-10T13:00:00Z');
    const fetchSpy = vi.fn(async () => new Response('{"id":"rcp_x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const store = await storeWith(async () => ({ url: 'https://store.example/receipts/rcp_x.json', uploadedAt }));
    expect(await store.read('receipts/rcp_x.json')).toBe('{"id":"rcp_x"}');
    expect(fetchSpy).toHaveBeenCalledWith(`https://store.example/receipts/rcp_x.json?v=${uploadedAt.getTime()}`, { cache: 'no-store' });
  });

  it('a store error is an error, never a silent "not published"', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const store = await storeWith(async () => {
      throw new Error('store unavailable');
    });
    await expect(store.read('receipts/rcp_x.json')).rejects.toThrow('store unavailable');
  });
});
