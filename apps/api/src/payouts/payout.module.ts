import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PayoutController],
  providers: [PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
