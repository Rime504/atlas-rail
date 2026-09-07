import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { prisma } from '@atlas-rail/database';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async login(email: string, pass: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials or account disabled.');
    }

    const isValid = await argon2.verify(user.passwordHash, pass);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const membership = user.memberships[0];
    const organizationId = membership ? membership.organizationId : '';
    const role = membership ? membership.role : 'OPERATOR';

    const payload = {
      sub: user.id,
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId,
      role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'atlas_rail_dev_access_secret_do_not_use_in_production_32bytes',
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'atlas_rail_dev_refresh_secret_do_not_use_in_production_32bytes',
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        organizationId,
        role,
      },
    };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { organization: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const membership = user.memberships[0];

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      organization: membership?.organization,
      role: membership?.role || 'OPERATOR',
    };
  }
}
