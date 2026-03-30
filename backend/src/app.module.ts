import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { NumbersModule } from './modules/numbers/numbers.module';
import { NumbersConnectModule } from './modules/numbers/numbers-connect.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { QueuesModule } from './modules/queues/queues.module';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    NumbersModule,
    NumbersConnectModule,
    MessagesModule,
    ConversationsModule,
    CampaignsModule,
    WhatsAppModule,
    QueuesModule,
  ],
})
export class AppModule {}
