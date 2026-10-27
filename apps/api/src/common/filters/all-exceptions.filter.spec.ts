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
