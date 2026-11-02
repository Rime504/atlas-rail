import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChainClient, DevnetKeyring, PaymentHistory, Web3ChainClient } from '@atlas-rail/solana';
import { AgentController } from './agent.controller';
import { AgentFacade } from './agent.facade';
import { AgentGateController } from './agent-gate.controller';
import { ChannelVoucherController } from './channel-voucher.controller';
import { PublicReceiptsController } from './public-receipts.controller';
import { AGENT_CHAIN, AGENT_KEYRING } from './agent.tokens';
import { OwnerApprovalsController } from './owner-approvals.controller';
import { PayAuthorityController } from './pay-authority.controller';

@Module({
  imports: [AuthModule],
  controllers: [AgentController, AgentGateController, PublicReceiptsController, ChannelVoucherController, OwnerApprovalsController, PayAuthorityController],
  providers: [
    // Devnet only: Web3ChainClient refuses mainnet endpoints at construction (ADR 0004).
    { provide: AGENT_CHAIN, useFactory: (): ChainClient & PaymentHistory => Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL) },
    // Devnet key file; refuses to load in production or without ATLAS_ALLOW_MOCK_SIGNER=true.
    { provide: AGENT_KEYRING, useFactory: () => DevnetKeyring.load() },
    AgentFacade,
  ],
  exports: [AgentFacade],
})
export class AgentModule {}
