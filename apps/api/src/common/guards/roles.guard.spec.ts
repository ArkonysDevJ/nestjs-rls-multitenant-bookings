import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { MemberRole } from '../decorators/roles.decorator';

function makeContext(role?: MemberRole): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ tenantContext: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: MemberRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any caller when the route declares no roles', () => {
    expect(makeGuard(undefined).canActivate(makeContext('viewer'))).toBe(true);
    expect(makeGuard([]).canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows a caller whose role is listed', () => {
    expect(
      makeGuard(['owner', 'staff']).canActivate(makeContext('staff')),
    ).toBe(true);
  });

  it('rejects a caller whose role is not listed', () => {
    expect(() =>
      makeGuard(['owner']).canActivate(makeContext('staff')),
    ).toThrow(ForbiddenException);
  });

  it('rejects when no tenant context was resolved', () => {
    expect(() =>
      makeGuard(['owner']).canActivate(makeContext(undefined)),
    ).toThrow(ForbiddenException);
  });
});
