import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  private onlyPersonConversations(where: any) {
    return {
      ...where,
      NOT: [
        { waId: { contains: '@broadcast' } },
        { waId: { contains: '-' } },
      ],
    };
  }

  async findAll(
    user: { role: string; tenantId: string; numberId?: string | null },
    numberId?: string,
    query?: string,
  ) {
    let where: any = {};

    if (user.role === 'SUPER_ADMIN') {
      where = numberId ? { numberId } : {};
    } else if (user.role === 'TENANT_ADMIN') {
      where = { tenantId: user.tenantId, ...(numberId ? { numberId } : {}) };
    } else {
      if (!user.numberId) return [];
      if (numberId && numberId !== user.numberId) return [];
      where = { tenantId: user.tenantId, numberId: user.numberId };
    }

    const search = String(query || '').trim();
    if (search) {
      where = {
        ...where,
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { waId: { contains: search, mode: 'insensitive' } },
          {
            messages: {
              some: {
                text: { contains: search, mode: 'insensitive' },
              },
            },
          },
        ],
      };
    }

    return this.prisma.conversation.findMany({
      where: this.onlyPersonConversations(where),
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findOne(id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id },
      include: { number: true },
    });
    if (!conversation) throw new NotFoundException('Conversacion no encontrada');
    return conversation;
  }

  async findOneAccessible(
    id: string,
    user: { role: string; tenantId: string; numberId?: string | null },
  ) {
    const where: any = this.onlyPersonConversations({ id });
    if (user.role === 'TENANT_ADMIN') {
      where.tenantId = user.tenantId;
    } else if (user.role === 'CLIENT') {
      where.tenantId = user.tenantId;
      where.numberId = user.numberId || '__no_number__';
    }

    const conversation = await this.prisma.conversation.findFirst({
      where,
      include: { number: true },
    });
    if (!conversation) throw new NotFoundException('Conversacion no encontrada');
    return conversation;
  }

  async clearConversation(
    id: string,
    user: { role: string; tenantId: string; numberId?: string | null },
  ) {
    const conversation = await this.findOneAccessible(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({
        where: { conversationId: conversation.id },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: conversation.createdAt,
        },
      });
    });

    return { id: conversation.id, status: 'cleared' };
  }

  async deleteConversation(
    id: string,
    user: { role: string; tenantId: string; numberId?: string | null },
  ) {
    const conversation = await this.findOneAccessible(id, user);

    await this.prisma.conversation.delete({
      where: { id: conversation.id },
    });

    return { id: conversation.id, status: 'deleted' };
  }
}
