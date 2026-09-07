import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationController],
})
export class OrganizationModule {}
