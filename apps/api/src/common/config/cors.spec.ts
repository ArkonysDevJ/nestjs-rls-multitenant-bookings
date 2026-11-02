import { Controller, Get, Module } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { corsOptions, parseAllowedOrigins } from './cors';

@Controller()
class ProbeController {
  @Get('probe')
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function appWith(env: NodeJS.ProcessEnv): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.enableCors(corsOptions(env));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('parseAllowedOrigins', () => {
  it('splits a list, trims it and drops empty entries and wildcards', () => {
    expect(parseAllowedOrigins(' https://a.example , ,https://b.example,*')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });
});

describe('CORS', () => {
  it('sends CORS headers to an allowed origin', async () => {
    const app = await appWith({ CORS_ORIGINS: 'https://web.example' });
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { origin: 'https://web.example' } });
    expect(res.headers['access-control-allow-origin']).toBe('https://web.example');
    await app.close();
  });

  it('sends no CORS headers to an origin that is not allowed', async () => {
    const app = await appWith({ CORS_ORIGINS: 'https://web.example' });
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { origin: 'https://evil.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('allows no cross-origin request when the variable is missing, and never a wildcard', async () => {
    for (const env of [{}, { CORS_ORIGINS: '' }, { CORS_ORIGINS: '*' }]) {
      const app = await appWith(env);
      const res = await app.inject({ method: 'GET', url: '/probe', headers: { origin: 'https://web.example' } });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    }
  });
});
