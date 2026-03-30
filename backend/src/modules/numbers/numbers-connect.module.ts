import { Module } from '@nestjs/common';
import { NumbersConnectController } from './numbers-connect.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NumbersModule } from './numbers.module';

@Module({
  imports: [WhatsAppModule, NumbersModule],
  controllers: [NumbersConnectController],
})
export class NumbersConnectModule {}
