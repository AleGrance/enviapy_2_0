import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { IsString, IsOptional } from 'class-validator';

export class CreateTenantDto {
  @IsString() name: string;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() name?: string;
}

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({ data: dto });
  }

  async findAll() {
    return this.prisma.tenant.findMany();
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Organizacion no encontrada');
    return tenant;
  }

  async findOneAccessible(id: string, user: { role: string; tenantId: string }) {
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== id) {
      throw new ForbiddenException('No puedes acceder a esta organizacion');
    }
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Organizacion no encontrada');
    return this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    return this.prisma.tenant.delete({ where: { id } });
  }
}
