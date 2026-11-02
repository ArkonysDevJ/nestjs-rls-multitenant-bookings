import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as net from 'net';
import { AuthGuard } from '../guards/auth.guard';
import { getSupabaseAdminClient } from '../supabase/supabase.client';
import { RateLimitGuard } from './rate-limit.guard';

jest.mock('../supabase/supabase.client');

@Controller()
class ProbeController {
  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('private')
  @UseGuards(AuthGuard)
  priv() {
    return { ok: true };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
class ProbeModule {}

const LIMITER_ENV: Record<string, string> = {
  RATE_LIMIT_WINDOW_SECONDS: '60',
  RATE_LIMIT_MAX: '3',
  RATE_LIMIT_HEALTH_MAX: '6',
  RATE_LIMIT_TRUSTED_PROXY_HOPS: '1',
};

/** Sends one HTTP/1.1 request with the given request-target and returns the status code. */
function rawRequest(port: number, target: string, forwardedFor: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: ${forwardedFor}\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => resolve(Number(data.split(' ')[1])));
    socket.on('error', reject);
  });
}

describe('RateLimitGuard with an absolute-form request target', () => {
  let app: NestFastifyApplication;
  let port: number;

  beforeAll(async () => {
    Object.assign(process.env, LIMITER_ENV);
    (getSupabaseAdminClient as jest.Mock).mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: new Error('bad') }) },
    });
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    for (const key of Object.keys(LIMITER_ENV)) delete process.env[key];
    await app.close();
  });

  it('counts an origin-form GET /v1/health against the health counter (6 per window here)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push(await rawRequest(port, '/v1/health', '203.0.113.8'));
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });

  // Known behaviour, pinned here: the guard compares the request target with
  // /v1/health, and an absolute-form target (http://host/v1/health) does not match.
  // The route still answers, but the request is counted against the general
  // counter (3 per window here) and not against the health one.
  it('counts GET http://host/v1/health against the general counter', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push(await rawRequest(port, 'http://example.test/v1/health', '203.0.113.7'));
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});
