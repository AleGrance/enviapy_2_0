import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserAccountStatusService } from './user-account-status.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserAccountStatusService],
  exports: [UsersService],
})
export class UsersModule {}
