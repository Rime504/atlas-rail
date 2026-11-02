import { connect, createAtlasRail, keypairWallet, type AtlasRailClient } from 'atlasrails';

export interface TopUpCliOptions {
  channel: string;
  /** Base units to add. */
  amount: string;
  /** The owner's key file: the channel payer. */
  keypair: string;
  rpc: string | null;
  /** Genesis hash the RPC must have. Defaults to Devnet; pass the local validator's for local runs. */
  genesis: string | null;
  /** Without it the command only shows what it would do. */
  yes: boolean;
}

/**
 * Owner-only top-up of a channel escrow. The agent never runs this: when a channel runs low its
 * payments stop with `needs_top_up` and the owner decides. Exit codes: 0 done or planned, 1 refused, 2 usage.
 */
export async function runTopUp(options: TopUpCliOptions, out: (line: string) => void = console.log): Promise<number> {
  if (!/^[1-9][0-9]*$/.test(options.amount)) {
    out('--amount must be a whole number of base units above zero');
    return 2;
  }
  const rpcUrl = options.rpc ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  let atlas: AtlasRailClient;
  let owner: string;
  try {
    const { connection, publicKey } = connect({ path: options.keypair, rpcUrl });
    owner = publicKey;
    atlas = createAtlasRail({
      apiUrl: 'http://127.0.0.1:9', // not used: top-up talks to Solana only
      connection,
      wallet: keypairWallet({ path: options.keypair }),
      execution: 'prepareOnly',
      ...(options.genesis ? { expectedGenesis: options.genesis } : {}),
    });
  } catch (error) {
    out(`Cannot load the owner key file: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  out(`Top up channel ${options.channel} with ${options.amount} base units, signed by the owner ${owner}.`);
  const result = await atlas.topUp({ channel: options.channel, amount: BigInt(options.amount), submit: options.yes });
  if (result.status === 'prepared') {
    out('Nothing was sent. Run again with --yes to sign and send this top-up.');
    return 0;
  }
  if (result.status !== 'confirmed') {
    out(`Refused: ${result.error.message}`);
    return 1;
  }
  out(`Done. Deposit ${result.depositBefore} → ${result.depositAfter}.`);
  out(`Transaction: https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);
  return 0;
}
