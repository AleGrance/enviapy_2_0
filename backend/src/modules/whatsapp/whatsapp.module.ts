import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { WhatsAppManagerService } from './whatsapp-manager.service';
import { WhatsAppGateway } from './whatsapp.gateway';
import { NumbersModule } from '../numbers/numbers.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'messages' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'supersecret',
    }),
  ],
  providers: [WhatsAppManagerService, WhatsAppGateway],
  exports: [WhatsAppManagerService, WhatsAppGateway],
})
export class WhatsAppModule implements OnModuleInit {
  constructor(
    private manager: WhatsAppManagerService,
    private gateway: WhatsAppGateway,
  ) {}

  onModuleInit() {
    this.manager.injectGateway(this.gateway);
  }
}
