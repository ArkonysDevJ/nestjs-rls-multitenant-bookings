import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as net from 'net';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { getSupabaseAdminClient } from './supabase/supabase.client';

jest.mock('./supabase/supabase.client');

/** Sends one HTTP/1.1 request with the given request-target; returns status and body. */
function rawRequest(port: number, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer a-token-that-would-be-accepted\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => {
      const [head, ...rest] = data.split('\r\n\r\n');
      resolve({ status: Number(head.split(' ')[1]), body: rest.join('\r\n\r\n') });
    });
    socket.on('error', reject);
  });
}

// The application has no Fastify plugin prefixes and no not-found handler of its
// own that returns data: Nest registers a single global not-found handler that
// answers 404, and authentication is done by guards. A malformed request target
// must therefore never reach a protected route or return protected data.
describe('malformed request targets', () => {
  let app: NestFastifyApplication;
  let port: number;
  const getUser = jest.fn();

  beforeAll(async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    (getSupabaseAdminClient as jest.Mock).mockReturnValue({
      auth: { getUser },
      from: () => {
        throw new Error('the database must not be reached by a malformed request');
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  const targets = [
    '/v1/tenants/me%',
    '/v1/%zz',
    '/v1/tenants/%c0%af/me',
    '/v1/members/%',
    '/%',
    '//v1/tenants/me',
    '/v1/tenants/me/%2e%2e/%2e%2e/health',
  ];

  it.each(targets)('%s does not return a success response from a protected route', async (target) => {
    const { status, body } = await rawRequest(port, target);
    expect([400, 401, 404]).toContain(status);
    expect(body).not.toContain('"role"');
    expect(body).not.toContain('"tenantId"');
  });

  it('does not touch Supabase Auth or the database for any of them', () => {
    expect(getUser).not.toHaveBeenCalled();
  });
});
