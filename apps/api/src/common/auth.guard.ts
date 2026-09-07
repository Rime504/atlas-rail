import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { prisma } from '@atlas-rail/database';
import { hasPermission, PermissionAction, UserRole } from '@atlas-rail/domain';
import { createHash } from 'crypto';

export const PERMISSION_KEY = 'permissions';
export const RequirePermission = (action: PermissionAction) => SetMetadata(PERMISSION_KEY, action);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];

    let userContext: any = null;

    if (apiKeyHeader) {
      const prefix = String(apiKeyHeader).slice(0, 8);
      const keyHash = createHash('sha256').update(String(apiKeyHeader)).digest('hex');

      const apiKey = await prisma.apiKey.findFirst({
        where: { keyPrefix: prefix, keyHash, revokedAt: null },
        include: { organization: true },
      });

      if (!apiKey) {
        throw new UnauthorizedException('Invalid or revoked API key.');
      }

      userContext = {
        userId: apiKey.createdByUserId,
        organizationId: apiKey.organizationId,
        role: 'DEVELOPER' as UserRole,
        isApiKey: true,
      };
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = this.jwtService.verify(token, {
          secret: process.env.JWT_ACCESS_SECRET || 'atlas_rail_dev_access_secret_do_not_use_in_production_32bytes',
        });
        userContext = payload;
      } catch {
        throw new UnauthorizedException('Invalid or expired authentication token.');
      }
    } else {
      throw new UnauthorizedException('Missing authorization token or API key.');
    }

    request.user = userContext;

    // RBAC Permission check
    const requiredPermission = this.reflector.get<PermissionAction>(PERMISSION_KEY, context.getHandler());
    if (requiredPermission && userContext.role) {
      if (!hasPermission(userContext.role as UserRole, requiredPermission)) {
        throw new ForbiddenException(`Role ${userContext.role} lacks required permission: ${requiredPermission}`);
      }
    }

    return true;
  }
}
