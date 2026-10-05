import { createHmac } from 'crypto';

export interface SignedWebhookHeader {
  headerName: string;
  headerValue: string;
  timestamp: number;
}

export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): SignedWebhookHeader {
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(signaturePayload).digest('hex');

  return {
    headerName: 'Atlas-Signature',
    headerValue: `t=${timestamp},v1=${hmac}`,
    timestamp,
  };
}

/** Loopback, RFC1918, link-local (incl. cloud metadata 169.254.169.254), and common IPv6 locals. */
function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (host.includes(':')) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    // Node's URL parser may keep dotted form (::ffff:127.0.0.1) or rewrite to hex (::ffff:7f00:1).
    const mappedDotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mappedDotted) return isPrivateOrLocalHostname(mappedDotted[1]);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo) && hi <= 0xffff && lo <= 0xffff) {
        const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrLocalHostname(dotted);
      }
    }
  }

  return false;
}

export function isValidWebhookUrl(urlStr: string, allowPrivateNetworks = false): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (!allowPrivateNetworks && isPrivateOrLocalHostname(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
