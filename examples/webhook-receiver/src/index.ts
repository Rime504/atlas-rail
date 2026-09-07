import express from 'express';
import { createHmac } from 'crypto';

const app = express();
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_demo_secret';

app.post('/webhooks/atlas', (req: any, res) => {
  const signatureHeader = req.headers['atlas-signature'] as string;
  if (!signatureHeader) {
    return res.status(401).json({ error: 'Missing Atlas-Signature header' });
  }

  // Header format: t=<timestamp>,v1=<hmac>
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((item) => item.split('='))
  );

  const timestamp = parts.t;
  const signature = parts.v1;

  const expectedHmac = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${req.rawBody}`)
    .digest('hex');

  if (signature !== expectedHmac) {
    console.error('❌ Webhook HMAC signature verification failed!');
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  console.info('✅ Verified Webhook Received:', req.body.eventType, req.body.data);
  return res.status(200).json({ received: true });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.info(`📡 Example Webhook Receiver listening on http://localhost:${PORT}/webhooks/atlas`);
});
