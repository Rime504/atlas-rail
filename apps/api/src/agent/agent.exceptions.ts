import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AgentServiceError } from '@atlas-rail/mandate';

const STATUS: Record<AgentServiceError['code'], number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  BAD_SIGNATURE: HttpStatus.UNAUTHORIZED,
  AGENT_MISMATCH: HttpStatus.FORBIDDEN,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  CLOCK_SKEW: HttpStatus.BAD_REQUEST,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  NONCE_REUSED: HttpStatus.CONFLICT,
  NONCE_REPLAY: HttpStatus.CONFLICT,
  INVALID_STATE: HttpStatus.CONFLICT,
};

/** Maps the framework-free service errors and zod validation errors onto clean HTTP responses. */
@Catch(AgentServiceError, ZodError)
export class AgentExceptionFilter implements ExceptionFilter {
  catch(error: AgentServiceError | ZodError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
      void reply.status(HttpStatus.BAD_REQUEST).send({ statusCode: 400, error: 'Bad Request', code: 'INVALID_INPUT', message });
      return;
    }
    const status = STATUS[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    void reply.status(status).send({ statusCode: status, error: error.name, code: error.code, message: error.message });
  }
}
