import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import { isUserAccountExpired } from '../users/user-expiration.util';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Credenciales invalidas');
    if (isUserAccountExpired(user.accountExpiresAt)) {
      if (user.status !== 'INACTIVE') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { status: 'INACTIVE' },
        });
      }
      throw new UnauthorizedException('La cuenta de usuario vencio');
    }
    if (user.status === 'INACTIVE') throw new UnauthorizedException('Usuario inactivo');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Credenciales invalidas');
    return user;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      numberId: user.numberId,
      campaignsEnabled: user.campaignsEnabled,
      accountExpiresAt: user.accountExpiresAt,
    };
    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        numberId: user.numberId,
        campaignsEnabled: user.campaignsEnabled,
        accountExpiresAt: user.accountExpiresAt,
      },
    };
  }

  async changePassword(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const hashed = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { success: true };
  }
}
