import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import { IsEmail, IsString, IsEnum, IsOptional, MinLength, IsBoolean, IsDateString } from 'class-validator';
import { Role, UserStatus } from '@prisma/client';
import { isUserAccountExpired } from './user-expiration.util';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() numberId?: string;
  @IsOptional() @IsBoolean() campaignsEnabled?: boolean;
  @IsOptional() @IsDateString() accountExpiresAt?: string | null;
}

export class UpdateUserDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() numberId?: string;
  @IsOptional() @IsBoolean() campaignsEnabled?: boolean;
  @IsOptional() @IsDateString() accountExpiresAt?: string | null;
}

interface RequestUser {
  id: string;
  role: Role | string;
  tenantId: string;
}

const userResponseSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  tenantId: true,
  numberId: true,
  campaignsEnabled: true,
  accountExpiresAt: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private parseAccountExpiresAt(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const rawValue = String(value).trim();
    if (!rawValue) {
      return null;
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('accountExpiresAt debe ser una fecha valida');
    }

    return parsed;
  }

  private async deactivateExpiredUsers(where: Record<string, any> = {}) {
    await this.prisma.user.updateMany({
      where: {
        ...where,
        status: 'ACTIVE',
        accountExpiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'INACTIVE',
      },
    });
  }

  private async assertTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Organizacion no encontrada');
  }

  private async validateNumberBelongsToTenant(numberId: string, tenantId: string): Promise<string> {
    const number = await this.prisma.whatsAppNumber.findFirst({
      where: { id: numberId, tenantId },
      select: { id: true },
    });
    if (!number) throw new NotFoundException('No se encontro el numero para la organizacion');
    return number.id;
  }

  private ensureCanAccessUser(requester: RequestUser, targetTenantId: string) {
    if (requester.role === 'SUPER_ADMIN') return;
    if (requester.role === 'TENANT_ADMIN' && requester.tenantId === targetTenantId) return;
    throw new ForbiddenException('No puedes administrar este usuario');
  }

  async create(dto: CreateUserDto, requester: RequestUser) {
    if (dto.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo SUPER_ADMIN puede crear usuarios SUPER_ADMIN');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('El correo ya existe');

    const tenantId =
      requester.role === 'SUPER_ADMIN'
        ? dto.tenantId
        : requester.role === 'TENANT_ADMIN'
          ? requester.tenantId
          : undefined;

    if (!tenantId) {
      throw new BadRequestException('tenantId es obligatorio');
    }

    if (requester.role === 'TENANT_ADMIN' && dto.tenantId && dto.tenantId !== requester.tenantId) {
      throw new ForbiddenException('No puedes crear usuarios para otra organizacion');
    }

    await this.assertTenantExists(tenantId);

    const numberId =
      dto.role === 'CLIENT' && dto.numberId
        ? await this.validateNumberBelongsToTenant(dto.numberId, tenantId)
        : null;
    const accountExpiresAt = this.parseAccountExpiresAt(dto.accountExpiresAt);

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        role: dto.role,
        status: isUserAccountExpired(accountExpiresAt) ? UserStatus.INACTIVE : UserStatus.ACTIVE,
        tenantId,
        numberId,
        campaignsEnabled: Boolean(dto.campaignsEnabled),
        accountExpiresAt,
      },
      select: userResponseSelect,
    });

    return user;
  }

  async findAll(tenantId: string | undefined, requester: RequestUser) {
    const where =
      requester.role === 'SUPER_ADMIN'
        ? (tenantId ? { tenantId } : {})
        : { tenantId: requester.tenantId };

    await this.deactivateExpiredUsers(where);

    const users = await this.prisma.user.findMany({
      where,
      select: userResponseSelect,
    });
    return users;
  }

  async findOne(id: string, requester: RequestUser) {
    await this.deactivateExpiredUsers({ id });

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userResponseSelect,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    this.ensureCanAccessUser(requester, user.tenantId);
    return user;
  }

  async update(id: string, dto: UpdateUserDto, requester: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    this.ensureCanAccessUser(requester, user.tenantId);
    if (user.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo SUPER_ADMIN puede modificar usuarios SUPER_ADMIN');
    }

    if (dto.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo SUPER_ADMIN puede asignar el rol SUPER_ADMIN');
    }

    if (requester.role === 'TENANT_ADMIN' && dto.tenantId && dto.tenantId !== requester.tenantId) {
      throw new ForbiddenException('No puedes mover usuarios a otra organizacion');
    }

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('El correo ya existe');
    }

    if (id === requester.id && dto.status === 'INACTIVE') {
      throw new BadRequestException('No puedes inactivar tu propia cuenta');
    }

    let resolvedTenantId = user.tenantId;
    if (dto.tenantId && dto.tenantId !== user.tenantId) {
      if (requester.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException('Solo SUPER_ADMIN puede mover usuarios entre organizaciones');
      }
      await this.assertTenantExists(dto.tenantId);
      resolvedTenantId = dto.tenantId;
    }

    let resolvedNumberId = user.numberId;
    if ((dto.role && dto.role !== 'CLIENT') || (dto.numberId !== undefined && dto.numberId.trim() === '')) {
      resolvedNumberId = null;
    }

    if (dto.numberId !== undefined && dto.numberId.trim() !== '') {
      resolvedNumberId = await this.validateNumberBelongsToTenant(dto.numberId, resolvedTenantId);
    }

    const accountExpiresAt = this.parseAccountExpiresAt(dto.accountExpiresAt);
    const nextAccountExpiresAt = accountExpiresAt !== undefined ? accountExpiresAt : user.accountExpiresAt;

    const data: any = {
      ...(dto.email ? { email: dto.email } : {}),
      ...(dto.role ? { role: dto.role } : {}),
      ...(resolvedTenantId !== user.tenantId ? { tenantId: resolvedTenantId } : {}),
      ...(dto.campaignsEnabled !== undefined ? { campaignsEnabled: dto.campaignsEnabled } : {}),
      numberId: resolvedNumberId,
    };

    if (dto.status) {
      data.status = dto.status;
    }
    if (accountExpiresAt !== undefined) {
      data.accountExpiresAt = accountExpiresAt;
    }
    if (isUserAccountExpired(nextAccountExpiresAt)) {
      data.status = UserStatus.INACTIVE;
    }

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: userResponseSelect,
    });
  }

  async deactivate(id: string, requester: RequestUser) {
    if (id === requester.id) {
      throw new BadRequestException('No puedes inactivar tu propia cuenta');
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, tenantId: true, role: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');

    this.ensureCanAccessUser(requester, target.tenantId);

    if (target.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo SUPER_ADMIN puede inactivar usuarios SUPER_ADMIN');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: userResponseSelect,
    });
    return user;
  }
}
