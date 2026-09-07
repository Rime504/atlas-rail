import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, generateUlid } from '@atlas-rail/database';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class ApiKeyService {
  async findAll(orgId: string) {
    return prisma.apiKey.findMany({
      where: { organizationId: orgId, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async create(orgId: string, userId: string, name: string, scopes: string[] = ['*']) {
    const rawKey = `atk_${randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.create({
      data: {
        id: generateUlid('key'),
        organizationId: orgId,
        name,
        keyPrefix,
        keyHash,
        scopes,
        createdByUserId: userId,
      },
    });

    return {
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        createdAt: apiKey.createdAt,
      },
      secretKey: rawKey, // Only returned once at creation!
    };
  }

  async revoke(orgId: string, id: string) {
    const key = await prisma.apiKey.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!key) throw new NotFoundException('API key not found.');

    return prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
  }
}
