import { Controller, Get, Post, Param, UseGuards, Request } from '@nestjs/common';
import { WhatsAppManagerService } from '../whatsapp/whatsapp-manager.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NumbersService } from './numbers.service';

@Controller('numbers')
@UseGuards(JwtAuthGuard)
export class NumbersConnectController {
  constructor(
    private manager: WhatsAppManagerService,
    private numbersService: NumbersService,
  ) {}

  @Post(':id/connect')
  async connect(@Param('id') id: string, @Request() req) {
    const number = await this.numbersService.findAccessible(id, req.user);
    await this.manager.startClient(number.id);
    return { status: 'connecting', numberId: number.id };
  }

  @Post(':id/disconnect')
  async disconnect(@Param('id') id: string, @Request() req) {
    const number = await this.numbersService.findAccessible(id, req.user);
    await this.manager.stopClient(number.id);
    return { status: 'disconnected', numberId: number.id };
  }

  @Post(':id/reconnect')
  async reconnect(@Param('id') id: string, @Request() req) {
    const number = await this.numbersService.findAccessible(id, req.user);
    await this.manager.stopClient(number.id);
    await new Promise(r => setTimeout(r, 2000));
    await this.manager.startClient(number.id);
    return { status: 'reconnecting', numberId: number.id };
  }

  @Get(':id/qr')
  async latestQr(@Param('id') id: string, @Request() req) {
    const number = await this.numbersService.findAccessible(id, req.user);
    return { numberId: number.id, qr: this.manager.getLatestQr(number.id) };
  }

  @Post('link-session')
  async linkSession(@Request() req) {
    const user = req.user;
    let number = null as any;

    if (user.role === 'CLIENT') {
      if (user.numberId) {
        number = await this.numbersService.findAccessible(user.numberId, user);
      } else {
        number = await this.numbersService.createForClientSession(
          user.tenantId,
          `WhatsApp ${user.email || 'Client'}`,
        );
        await this.numbersService.assignNumberToUser(user.id, number.id);
      }
    } else {
      const tenantId = user.tenantId;
      number = await this.numbersService.findFirstByTenant(tenantId);

      if (!number) {
        number = await this.numbersService.create(
          {
            tenantId,
            name: 'Main WhatsApp',
          },
          user,
        );
      }
    }

    await this.manager.startClient(number.id);
    return number;
  }

  @Post('bootstrap')
  async bootstrap(@Request() req) {
    const user = req.user;
    let numbers = [] as any[];

    if (user.role === 'SUPER_ADMIN') {
      numbers = await this.numbersService.findAll();
    } else if (user.role === 'TENANT_ADMIN') {
      numbers = await this.numbersService.findAll(user.tenantId);
    } else if (user.numberId) {
      const number = await this.numbersService.findAccessible(user.numberId, user);
      numbers = [number];
    }

    for (const number of numbers) {
      const hasActiveClient = Boolean(this.manager.getClient(number.id));
      if (number.status !== 'CONNECTED' || !hasActiveClient) {
        try {
          await this.manager.startClient(number.id);
        } catch {
          // best-effort bootstrapping; failures are reported by websocket status events
        }
      }
    }

    return { tenantId: user.tenantId, total: numbers.length };
  }
}
