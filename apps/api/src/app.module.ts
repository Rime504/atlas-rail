import { Module } from '@nestjs/common';
import { QueueModule } from './common/queue.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationModule } from './organizations/organization.module';
import { TreasuryModule } from './treasuries/treasury.module';
import { RecipientModule } from './recipients/recipient.module';
import { PolicyModule } from './policies/policy.module';
import { PayoutModule } from './payouts/payout.module';
import { LedgerModule } from './ledger/ledger.module';
import { ApiKeyModule } from './apikeys/apikey.module';
import { WebhookModule } from './webhooks/webhook.module';
import { HealthModule } from './health/health.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    QueueModule,
    AuthModule,
    OrganizationModule,
    TreasuryModule,
    RecipientModule,
    PolicyModule,
    PayoutModule,
    LedgerModule,
    ApiKeyModule,
    WebhookModule,
    HealthModule,
    AgentModule,
  ],
})
export class AppModule {}
