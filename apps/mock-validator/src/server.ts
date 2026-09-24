import Fastify, { FastifyInstance } from 'fastify';
import { base58, base64 } from '@scure/base';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { FakeChain } from '@atlas-rail/solana/testing';

/**
 * A Solana JSON-RPC server over the in-memory {@link FakeChain}. It speaks just enough of the
 * protocol for `@solana/web3.js`, `@solana/spl-token` and the Atlas Rail services to run against it
 * exactly as they run against devnet, which makes `pnpm demo:offline` possible on machines without
 * devnet access or `solana-test-validator` (notably Windows). It is a test double, not a validator.
 */

type Params = unknown[];

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface MockValidator {
  app: FastifyInstance;
  chain: FakeChain;
}

export function createMockValidator(chain = new FakeChain(), options: { log?: boolean } = {}): MockValidator {
  const app = Fastify({ logger: options.log ?? false });
  const context = () => ({ slot: chain.slot });

  const decodeTx = (encoded: string, encoding: unknown): VersionedTransaction => {
    const bytes = encoding === 'base58' ? base58.decode(encoded) : base64.decode(encoded);
    return VersionedTransaction.deserialize(bytes);
  };

  const accountValue = (address: string) => {
    const account = chain.getAccount(address);
    if (!account) return null;
    return {
      data: [base64.encode(account.data), 'base64'],
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.owner,
      rentEpoch: 0,
      space: account.data.length,
    };
  };

  const handlers: Record<string, (params: Params) => unknown | Promise<unknown>> = {
    getVersion: () => ({ 'solana-core': '2.0.0-atlasrail-mock', 'feature-set': 0 }),
    getHealth: () => 'ok',
    getSlot: () => chain.slot,
    getBlockHeight: () => chain.slot,
    getMinimumBalanceForRentExemption: (params) => Number(params[0]) * 6960 + 890880,
    getLatestBlockhash: async () => {
      const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
      return { context: context(), value: { blockhash, lastValidBlockHeight } };
    },
    getBalance: (params) => ({ context: context(), value: Number(chain.lamportBalance(String(params[0]))) }),
    requestAirdrop: (params) => {
      chain.airdrop(String(params[0]), BigInt(Number(params[1])));
      return base58.encode(new Uint8Array(64).fill(7));
    },
    getAccountInfo: (params) => ({ context: context(), value: accountValue(String(params[0])) }),
    getMultipleAccounts: (params) => ({
      context: context(),
      value: (params[0] as string[]).map((address) => accountValue(address)),
    }),
    getTokenAccountBalance: (params) => {
      const account = chain.getAccount(String(params[0]));
      if (!account || account.owner !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        throw new RpcError(-32602, 'Invalid param: could not find account');
      }
      const amount = new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(64, true);
      return { context: context(), value: { amount: amount.toString(), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: (Number(amount) / 1e6).toString() } };
    },
    simulateTransaction: async (params) => {
      const encoded = String(params[0]);
      const config = (params[1] ?? {}) as { encoding?: string };
      const result = await chain.simulate(base64.encode(decodeTx(encoded, config.encoding).serialize()));
      return {
        context: context(),
        value: {
          err: result.success ? null : { InstructionError: [0, { Custom: result.error ?? 'failed' }] },
          logs: result.logs,
          unitsConsumed: result.unitsConsumed ?? 0,
          accounts: null,
          returnData: null,
        },
      };
    },
    sendTransaction: (params) => {
      const config = (params[1] ?? {}) as { encoding?: string };
      const tx = decodeTx(String(params[0]), config.encoding);
      try {
        return chain.submit(tx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RpcError(-32002, `Transaction simulation failed: ${message}`, { err: message, logs: [] });
      }
    },
    getSignatureStatuses: (params) => ({
      context: context(),
      value: (params[0] as string[]).map((signature) => {
        const found = chain.getProcessed(signature);
        return found
          ? { slot: found.summary.slot, confirmations: null, err: null, status: { Ok: null }, confirmationStatus: 'finalized' }
          : null;
      }),
    }),
    getTransaction: (params) => {
      const found = chain.getProcessed(String(params[0]));
      if (!found) return null;
      const { tx, summary } = found;
      const message = tx.message;
      return {
        slot: summary.slot,
        blockTime: summary.blockTime,
        version: 0,
        meta: { err: null, fee: 5000 * message.header.numRequiredSignatures, preBalances: [], postBalances: [], innerInstructions: [], logMessages: [], preTokenBalances: [], postTokenBalances: [], rewards: [], status: { Ok: null } },
        transaction: {
          signatures: tx.signatures.map((s) => base58.encode(s)),
          message: {
            header: message.header,
            accountKeys: message.staticAccountKeys.map((k: PublicKey) => k.toBase58()),
            recentBlockhash: message.recentBlockhash,
            instructions: message.compiledInstructions.map((ix) => ({
              programIdIndex: ix.programIdIndex,
              accounts: ix.accountKeyIndexes,
              data: base58.encode(ix.data),
            })),
            addressTableLookups: [],
          },
        },
      };
    },
  };

  app.post('/', async (request, reply) => {
    const body = request.body as { id?: number | string; method?: string; params?: Params } | Array<{ id?: number | string; method?: string; params?: Params }>;
    const run = async (call: { id?: number | string; method?: string; params?: Params }) => {
      const id = call.id ?? null;
      try {
        const handler = call.method ? handlers[call.method] : undefined;
        if (!handler) throw new RpcError(-32601, `Method not found: ${call.method}`);
        return { jsonrpc: '2.0', id, result: await handler(call.params ?? []) };
      } catch (error) {
        if (error instanceof RpcError) return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message, data: error.data } };
        return { jsonrpc: '2.0', id, error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' } };
      }
    };
    void reply.header('content-type', 'application/json');
    return Array.isArray(body) ? Promise.all(body.map(run)) : run(body);
  });

  app.get('/health', async () => ({ status: 'ok', slot: chain.slot, mode: 'mock' }));
  return { app, chain };
}
