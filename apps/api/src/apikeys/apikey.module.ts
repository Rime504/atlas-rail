import { Module } from '@nestjs/common';
import { ApiKeyController } from './apikey.controller';
import { ApiKeyService } from './apikey.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
