import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChainClient, DevnetKeyring, Web3ChainClient } from '@atlas-rail/solana';
import { AgentController } from './agent.controller';
import { AgentFacade } from './agent.facade';
import { AgentGateController } from './agent-gate.controller';
import { AgentDemoController } from './agent-demo.controller';
import { AgentDemoService } from './agent-demo.service';
import { PublicReceiptsController } from './public-receipts.controller';
import { AGENT_CHAIN, AGENT_KEYRING } from './agent.tokens';

@Module({
  imports: [AuthModule],
  controllers: [AgentController, AgentGateController, AgentDemoController, PublicReceiptsController],
  providers: [
    // Devnet only: Web3ChainClient refuses mainnet endpoints at construction (ADR 0004).
    { provide: AGENT_CHAIN, useFactory: (): ChainClient => Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL) },
    // Devnet key file; refuses to load in production or without ATLAS_ALLOW_MOCK_SIGNER=true.
    { provide: AGENT_KEYRING, useFactory: () => DevnetKeyring.load() },
    AgentFacade,
    AgentDemoService,
  ],
  exports: [AgentFacade],
})
export class AgentModule {}
