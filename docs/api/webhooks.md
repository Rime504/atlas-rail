# Signed Webhook Guide

Atlas Rail delivers HMAC-SHA256 signed event notifications to registered webhook endpoints.

## Event Types

- `payout.created`
- `payout.pending_approval`
- `payout.approved`
- `payout.rejected`
- `payout.blocked`
- `payout.submitted`
- `payout.confirmed`
- `payout.failed`
- `recipient.verified`
- `treasury.frozen`
- `treasury.unfrozen`

## Verification in Node.js

```typescript
import { createHmac } from 'crypto';

function verifyAtlasWebhook(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = Object.fromEntries(signatureHeader.split(',').map((item) => item.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;

  const expectedHmac = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return signature === expectedHmac;
}
```
