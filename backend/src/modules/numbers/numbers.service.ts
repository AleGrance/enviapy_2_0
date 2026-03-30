import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { IsString } from 'class-validator';

export class CreateNumberDto {
  @IsString() tenantId: string;
  @IsString() name: string;
}

@Injectable()
export class NumbersService {
  constructor(private prisma: PrismaService) {}

  private async createByTenant(tenantId: string, name: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Organizacion no encontrada');

    const number = await this.prisma.whatsAppNumber.create({
      data: {
        tenantId,
        name,
        sessionName: `session-temp`,
        status: 'DISCONNECTED',
      },
    });
    // Update sessionName with the real ID
    return this.prisma.whatsAppNumber.update({
      where: { id: number.id },
      data: { sessionName: `session-${number.id}` },
    });
  }

  async create(dto: CreateNumberDto, requester: { role: string; tenantId: string }) {
    if (requester.role !== 'SUPER_ADMIN' && requester.role !== 'TENANT_ADMIN') {
      throw new ForbiddenException('No puedes crear numeros');
    }

    const tenantId = requester.role === 'SUPER_ADMIN' ? dto.tenantId : requester.tenantId;
    if (requester.role === 'TENANT_ADMIN' && dto.tenantId && dto.tenantId !== requester.tenantId) {
      throw new ForbiddenException('No puedes crear numeros para otra organizacion');
    }
    if (!tenantId) {
      throw new BadRequestException('tenantId es obligatorio');
    }

    return this.createByTenant(tenantId, dto.name);
  }

  async createForClientSession(tenantId: string, name: string) {
    return this.createByTenant(tenantId, name);
  }

  async findAll(tenantId?: string) {
    return this.prisma.whatsAppNumber.findMany({
      where: tenantId ? { tenantId } : {},
    });
  }

  async findAllAccessible(user: { role: string; tenantId: string; numberId?: string | null }) {
    if (user.role === 'SUPER_ADMIN') {
      return this.findAll();
    }
    if (user.role === 'TENANT_ADMIN') {
      return this.findAll(user.tenantId);
    }
    if (!user.numberId) return [];
    return this.prisma.whatsAppNumber.findMany({
      where: { id: user.numberId, tenantId: user.tenantId },
    });
  }

  async findOne(id: string) {
    const number = await this.prisma.whatsAppNumber.findUnique({ where: { id } });
    if (!number) throw new NotFoundException('Numero no encontrado');
    return number;
  }

  async findFirstByTenant(tenantId: string) {
    return this.prisma.whatsAppNumber.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAccessible(id: string, user: { role: string; tenantId: string; numberId?: string | null }) {
    const number = await this.findOne(id);
    if (user.role === 'SUPER_ADMIN') {
      return number;
    }
    if (number.tenantId !== user.tenantId) {
      throw new ForbiddenException('No puedes acceder a este numero');
    }
    if (user.role === 'CLIENT' && user.numberId !== number.id) {
      throw new ForbiddenException('No puedes acceder a este numero');
    }
    return number;
  }

  async updateStatus(id: string, status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING') {
    return this.prisma.whatsAppNumber.update({ where: { id }, data: { status } });
  }

  async assignNumberToUser(userId: string, numberId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { numberId },
    });
  }

  async remove(id: string, requester: { role: string; tenantId: string; numberId?: string | null }) {
    await this.findAccessible(id, requester);
    return this.prisma.whatsAppNumber.delete({ where: { id } });
  }
}
