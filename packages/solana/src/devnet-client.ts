import { Connection } from '@solana/web3.js';
import { assertNotMainnet } from './guards';

export class DevnetSolanaRpcClient {
  public connection: Connection;

  constructor(rpcUrl: string = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com') {
    assertNotMainnet(rpcUrl);
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  public async getLatestBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    return blockhash;
  }
}
