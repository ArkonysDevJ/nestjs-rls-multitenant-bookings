import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '../guards/auth.guard';
import { getSupabaseAdminClient } from '../supabase/supabase.client';
import { readRateLimitConfig, RateLimitGuard } from './rate-limit.guard';

jest.mock('../supabase/supabase.client');

const getUser = jest.fn();

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
  RATE_LIMIT_HEALTH_MAX: '5',
  RATE_LIMIT_TRUSTED_PROXY_HOPS: '1',
};

async function makeApp(env: Record<string, string>): Promise<NestFastifyApplication> {
  for (const key of Object.keys(LIMITER_ENV)) delete process.env[key];
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function get(app: NestFastifyApplication, url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url, headers });
}

describe('readRateLimitConfig', () => {
  it('is inactive unless every variable is a positive integer', () => {
    expect(readRateLimitConfig({})).toBeNull();
    for (const missing of Object.keys(LIMITER_ENV)) {
      const partial: Record<string, string> = { ...LIMITER_ENV };
      delete partial[missing];
      expect(readRateLimitConfig(partial)).toBeNull();
    }
    expect(readRateLimitConfig({ ...LIMITER_ENV, RATE_LIMIT_MAX: '0' })).toBeNull();
    expect(readRateLimitConfig({ ...LIMITER_ENV, RATE_LIMIT_MAX: 'many' })).toBeNull();
    expect(readRateLimitConfig(LIMITER_ENV)).toEqual({
      windowMs: 60_000,
      max: 3,
      healthMax: 5,
      trustedHops: 1,
    });
  });
});

describe('RateLimitGuard', () => {
  let app: NestFastifyApplication | undefined;

  beforeEach(() => {
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('bad') });
    (getSupabaseAdminClient as jest.Mock).mockReturnValue({ auth: { getUser } });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    app = undefined;
  });

  afterAll(() => {
    for (const key of Object.keys(LIMITER_ENV)) delete process.env[key];
  });

  it('answers 429 once a client passes the limit', async () => {
    app = await makeApp(LIMITER_ENV);
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 3; i += 1) {
      expect((await get(app, '/v1/private', headers)).statusCode).toBe(401);
    }
    const limited = await get(app, '/v1/private', headers);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('keeps a separate counter per client', async () => {
    app = await makeApp(LIMITER_ENV);
    for (let i = 0; i < 4; i += 1) {
      await get(app, '/v1/private', { 'x-forwarded-for': '203.0.113.7' });
    }
    expect((await get(app, '/v1/private', { 'x-forwarded-for': '203.0.113.7' })).statusCode).toBe(429);
    expect((await get(app, '/v1/private', { 'x-forwarded-for': '198.51.100.9' })).statusCode).toBe(401);
  });

  it('does not call Supabase Auth for a request it rejects with 429', async () => {
    app = await makeApp(LIMITER_ENV);
    const headers = { 'x-forwarded-for': '203.0.113.7', authorization: 'Bearer junk' };
    for (let i = 0; i < 3; i += 1) await get(app, '/v1/private', headers);
    expect(getUser).toHaveBeenCalledTimes(3);
    expect((await get(app, '/v1/private', headers)).statusCode).toBe(429);
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it('counts the client from the right, so entries written by the client do not matter', async () => {
    app = await makeApp(LIMITER_ENV);
    for (let i = 0; i < 3; i += 1) {
      await get(app, '/v1/private', { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` });
    }
    const forged = await get(app, '/v1/private', { 'x-forwarded-for': '10.9.9.9, 203.0.113.7' });
    expect(forged.statusCode).toBe(429);
  });

  it('limits /v1/health on its own, with its own threshold', async () => {
    app = await makeApp(LIMITER_ENV);
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 5; i += 1) {
      expect((await get(app, '/v1/health', headers)).statusCode).toBe(200);
    }
    expect((await get(app, '/v1/health', headers)).statusCode).toBe(429);
    // the health counter does not use up the one for the other routes
    expect((await get(app, '/v1/private', headers)).statusCode).toBe(401);
  });

  it('starts a new window after the old one ends', async () => {
    app = await makeApp(LIMITER_ENV);
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    const start = Date.now();
    for (let i = 0; i < 4; i += 1) await get(app, '/v1/private', headers);
    expect((await get(app, '/v1/private', headers)).statusCode).toBe(429);
    jest.spyOn(Date, 'now').mockReturnValue(start + 61_000);
    expect((await get(app, '/v1/private', headers)).statusCode).toBe(401);
  });

  it('never answers 429 without its configuration', async () => {
    app = await makeApp({});
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 20; i += 1) {
      expect((await get(app, '/v1/private', headers)).statusCode).toBe(401);
    }
    expect((await get(app, '/v1/health', headers)).statusCode).toBe(200);
  });
});
