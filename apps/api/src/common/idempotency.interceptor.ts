import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { prisma, generateUlid } from '@atlas-rail/database';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'] || request.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      if (request.method === 'POST' && request.url.includes('/v1/payouts')) {
        throw new BadRequestException('Idempotency-Key header is required for payout creation.');
      }
      return next.handle();
    }

    const orgId = request.user?.organizationId || 'default-org';
    const requestBodyStr = JSON.stringify(request.body || {});
    const requestHash = createHash('sha256').update(requestBodyStr).digest('hex');

    const existing = await prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_key: {
          organizationId: orgId,
          key: String(idempotencyKey),
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key reused with different request body payload.',
        );
      }
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap(async (responseBody) => {
        try {
          await prisma.idempotencyRecord.create({
            data: {
              id: generateUlid('idm'),
              organizationId: orgId,
              key: String(idempotencyKey),
              requestHash,
              responseStatus: 201,
              responseBody,
              expiresAt: new Date(Date.now() + 86400000 * 7), // 7 days TTL
            },
          });
        } catch {
          // Ignore unique constraint error if concurrently saved
        }
      }),
    );
  }
}
