import { ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost() {
  const reply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes HttpException status and body through unchanged', () => {
    const { host, reply } = makeHost();
    const exception = new ForbiddenException('nope');

    filter.catch(exception, host);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(exception.getResponse());
  });

  it.each(['23505', '23503'])(
    'maps Postgres %s to a generic 409 conflict',
    (code) => {
      const { host, reply } = makeHost();

      filter.catch({ code, message: 'raw db message' }, host);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 409,
        message: 'The request conflicts with existing data.',
        code,
      });
    },
  );

  describe('booking on a resource of another tenant', () => {
    // PostgREST reports the violated constraint inside `message`.
    const FK_MESSAGE =
      'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"';

    it('maps the composite resource/tenant foreign key to a 404', () => {
      const { host, reply } = makeHost();

      filter.catch(
        {
          code: '23503',
          message: FK_MESSAGE,
          details: 'Key (resource_id, tenant_id)=(r-1, t-1) is not present in table "resources".',
        },
        host,
      );

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 404,
        message: 'The requested resource was not found.',
        code: 'RESOURCE_NOT_FOUND',
      });
    });

    it('answers a foreign resource and a nonexistent one identically', () => {
      const foreign = makeHost();
      filter.catch(
        { code: '23503', message: FK_MESSAGE, details: 'Key (resource_id, tenant_id)=(foreign, t-1)' },
        foreign.host,
      );
      const missing = makeHost();
      filter.catch(
        { code: '23503', message: FK_MESSAGE, details: 'Key (resource_id, tenant_id)=(missing, t-1)' },
        missing.host,
      );

      expect(foreign.reply.status.mock.calls).toEqual(missing.reply.status.mock.calls);
      expect(foreign.reply.send.mock.calls).toEqual(missing.reply.send.mock.calls);
    });

    it('does not echo the constraint name or the key details to the client', () => {
      const { host, reply } = makeHost();

      filter.catch(
        { code: '23503', message: FK_MESSAGE, details: 'Key (resource_id, tenant_id)=(r-1, t-1)' },
        host,
      );

      const body = JSON.stringify(reply.send.mock.calls[0][0]);
      expect(body).not.toContain('bookings_resource_same_tenant_fk');
      expect(body).not.toContain('r-1');
    });

    it('keeps 409 for a foreign key violation on any other constraint', () => {
      const { host, reply } = makeHost();

      filter.catch(
        {
          code: '23503',
          message:
            'insert or update on table "members" violates foreign key constraint "members_user_id_fkey"',
        },
        host,
      );

      expect(reply.status).toHaveBeenCalledWith(409);
    });
  });

  it('maps the exclusion violation 23P01 to a 409 about overlapping bookings', () => {
    const { host, reply } = makeHost();

    filter.catch({ code: '23P01', message: 'raw db message' }, host);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        code: '23P01',
        message: expect.stringContaining(
          'overlaps an existing confirmed booking',
        ),
      }),
    );
  });

  it('answers 500 with a generic body for an unmapped error and does not leak its message', () => {
    const { host, reply } = makeHost();

    filter.catch({ code: 'XX000', message: 'secret internal detail' }, host);

    expect(reply.status).toHaveBeenCalledWith(500);
    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 500,
      message: 'Internal server error.',
    });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('answers 500 for a non-object exception', () => {
    const { host, reply } = makeHost();

    filter.catch('boom', host);

    expect(reply.status).toHaveBeenCalledWith(500);
  });
});
