// apps/api/src/common/filters/all-exceptions.filter.ts
// [F-ID: SRC-COMMON-FILTER-EXCEPTIONS-01]
// @version 1.0.0
// @changelog 1.0.0 — Maps Postgres error codes (unique/FK/exclusion violations) to HTTP responses.

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
}

// A booking whose resource belongs to another tenant (or does not exist) is
// rejected by this composite foreign key. It is answered with a 404 that is
// the same for both cases, so the response never tells whether a resource of
// another tenant exists. Matched by constraint name because 23503 is also
// raised by unrelated inserts, whose 409 must not change.
const RESOURCE_TENANT_FK = 'bookings_resource_same_tenant_fk';

// A booking whose end is not after its start is refused by this check
// constraint. The caller sent a bad range, so it is a 400. Matched by
// constraint name because 23514 is raised by every check constraint, and
// only this one is the caller's mistake.
const TIME_RANGE_CHECK = 'valid_range';

const POSTGRES_CONFLICT_CODES = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23P01', // exclusion_violation (used by the no-overlap booking constraint)
]);

/**
 * Translates raw Postgres/PostgREST error codes into proper HTTP
 * responses instead of leaking database internals to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      reply.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const pgError = exception as PostgrestLikeError;
    if (
      pgError?.code === '23503' &&
      pgError.message?.includes(`"${RESOURCE_TENANT_FK}"`)
    ) {
      reply.status(HttpStatus.NOT_FOUND).send({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'The requested resource was not found.',
        code: 'RESOURCE_NOT_FOUND',
      });
      return;
    }

    if (
      pgError?.code === '23514' &&
      pgError.message?.includes(`"${TIME_RANGE_CHECK}"`)
    ) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'The end of a booking must be after its start.',
        code: 'INVALID_TIME_RANGE',
      });
      return;
    }

    if (pgError?.code && POSTGRES_CONFLICT_CODES.has(pgError.code)) {
      reply.status(HttpStatus.CONFLICT).send({
        statusCode: HttpStatus.CONFLICT,
        message:
          pgError.code === '23P01'
            ? 'The requested time range overlaps an existing confirmed booking for this resource.'
            : 'The request conflicts with existing data.',
        code: pgError.code,
      });
      return;
    }

    this.logger.error(exception);
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error.',
    });
  }
}
