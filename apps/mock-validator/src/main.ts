import { createMockValidator } from './server';

const port = Number(process.env.MOCK_VALIDATOR_PORT ?? 8899);
const { app } = createMockValidator(undefined, { log: process.env.LOG_LEVEL === 'debug' });

app
  .listen({ port, host: '127.0.0.1' })
  .then(() => {
    console.info(`Atlas Rail mock Solana validator (in-memory, DEVNET stand-in) on http://127.0.0.1:${port}`);
    console.info('This is a test double for offline demos. It is not a validator and holds no real state.');
  })
  .catch((error) => {
    console.error('mock validator failed to start:', error);
    process.exit(1);
  });
