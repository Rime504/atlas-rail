import { Module } from '@nestjs/common';
import { RecipientController } from './recipient.controller';
import { RecipientService } from './recipient.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RecipientController],
  providers: [RecipientService],
  exports: [RecipientService],
})
export class RecipientModule {}
