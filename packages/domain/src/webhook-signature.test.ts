import { describe, it, expect } from 'vitest';
import { generateWebhookSignature, isValidWebhookUrl } from './webhook-signature';
import { createHmac } from 'crypto';

describe('generateWebhookSignature', () => {
  it('produces a header in the documented Atlas-Signature format', () => {
    const result = generateWebhookSignature('{"hello":"world"}', 'whsec_test', 1700000000);
    expect(result.headerName).toBe('Atlas-Signature');
    expect(result.headerValue).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('produces a signature verifiable by recomputing the HMAC', () => {
    const payload = '{"eventType":"payout.confirmed"}';
    const secret = 'whsec_shared';
    const result = generateWebhookSignature(payload, secret, 1700000000);

    const expectedHmac = createHmac('sha256', secret).update(`1700000000.${payload}`).digest('hex');
    expect(result.headerValue).toBe(`t=1700000000,v1=${expectedHmac}`);
  });

  it('changes signature when the payload changes', () => {
    const a = generateWebhookSignature('payload-a', 'secret', 1700000000);
    const b = generateWebhookSignature('payload-b', 'secret', 1700000000);
    expect(a.headerValue).not.toBe(b.headerValue);
  });
});

describe('isValidWebhookUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidWebhookUrl('https://example.com/webhook')).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isValidWebhookUrl('ftp://example.com/webhook')).toBe(false);
    expect(isValidWebhookUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidWebhookUrl('not a url')).toBe(false);
  });

  it('rejects private/loopback hosts when allowPrivateNetworks is false', () => {
    expect(isValidWebhookUrl('http://localhost:3000/hook', false)).toBe(false);
    expect(isValidWebhookUrl('http://127.0.0.1/hook', false)).toBe(false);
    expect(isValidWebhookUrl('http://10.0.0.5/hook', false)).toBe(false);
    expect(isValidWebhookUrl('http://192.168.1.5/hook', false)).toBe(false);
  });

  it('allows private hosts when allowPrivateNetworks is true (devnet default)', () => {
    expect(isValidWebhookUrl('http://localhost:3000/hook', true)).toBe(true);
  });
});
