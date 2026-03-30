import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class SendMessageDto {
  @IsUUID() numberId: string;
  @IsString() to: string;
  @IsString() type: string;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() mediaPath?: string;
}

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('messages') private messageQueue: Queue,
  ) {}

  async send(dto: SendMessageDto, user: { role: string; tenantId: string; numberId?: string | null }) {
    if (user.role === 'CLIENT' && user.numberId !== dto.numberId) {
      throw new NotFoundException('Numero no encontrado');
    }

    const where: any = { id: dto.numberId };
    if (user.role === 'TENANT_ADMIN' || user.role === 'CLIENT') {
      where.tenantId = user.tenantId;
    }

    const number = await this.prisma.whatsAppNumber.findFirst({
      where,
      select: { id: true, tenantId: true },
    });
    if (!number) throw new NotFoundException('Numero no encontrado');

    await this.messageQueue.add('send-outbound', { ...dto, tenantId: number.tenantId });
    return { status: 'queued' };
  }

  async findByConversation(
    conversationId: string,
    user: { role: string; tenantId: string; numberId?: string | null },
    page = 1,
    limit = 50,
  ) {
    const conversationWhere: any = { id: conversationId };
    if (user.role === 'TENANT_ADMIN') {
      conversationWhere.tenantId = user.tenantId;
    } else if (user.role === 'CLIENT') {
      conversationWhere.tenantId = user.tenantId;
      conversationWhere.numberId = user.numberId || '__no_number__';
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: conversationWhere,
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('Conversacion no encontrada');

    const skip = (page - 1) * limit;
    const messagesWhere: any = { conversationId };
    if (user.role === 'TENANT_ADMIN' || user.role === 'CLIENT') {
      messagesWhere.tenantId = user.tenantId;
    }

    const messages = await this.prisma.message.findMany({
      where: messagesWhere,
      orderBy: { timestamp: 'asc' },
      skip,
      take: limit,
    });
    const total = await this.prisma.message.count({ where: messagesWhere });
    return { messages, total, page, limit };
  }
}
