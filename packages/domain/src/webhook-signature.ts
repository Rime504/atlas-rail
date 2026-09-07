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

export function isValidWebhookUrl(urlStr: string, allowPrivateNetworks = true): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (!allowPrivateNetworks) {
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
