import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma.service';
import { isUserAccountExpired } from '../users/user-expiration.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'supersecret',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        numberId: true,
        campaignsEnabled: true,
        status: true,
        accountExpiresAt: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('Usuario del token invalido');
    }
    if (isUserAccountExpired(user.accountExpiresAt)) {
      if (user.status !== 'INACTIVE') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { status: 'INACTIVE' },
        });
      }
      throw new UnauthorizedException('La cuenta de usuario vencio');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuario del token invalido');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      numberId: user.numberId || null,
      campaignsEnabled: user.campaignsEnabled,
      accountExpiresAt: user.accountExpiresAt,
    };
  }
}
