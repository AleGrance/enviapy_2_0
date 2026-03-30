import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagesProcessor } from './messages.processor';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'messages' }),
    WhatsAppModule,
  ],
  providers: [MessagesProcessor],
})
export class QueuesModule {}
