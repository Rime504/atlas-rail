import { createServer } from 'http';
import { AddressInfo } from 'net';

export * from './local-gate';
export * from './fake-seller';

/** Finds a free local port so tests can build a mandate scoped to an origin before a server starts. */
export async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
