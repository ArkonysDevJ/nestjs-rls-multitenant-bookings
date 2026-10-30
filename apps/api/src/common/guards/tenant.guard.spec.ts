import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { MembersService } from '../../members/members.service';
import { getSupabaseAdminClient } from '../supabase/supabase.client';

jest.mock('../supabase/supabase.client');

const getUser = jest.fn();
const findMembership = jest.fn();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeContext(headers: Record<string, string | string[]>) {
  const request: {
    headers: Record<string, string | string[]>;
    tenantContext?: unknown;
  } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function signedInAs(userId: string) {
  getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
}

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    getUser.mockReset();
    findMembership.mockReset();
    (getSupabaseAdminClient as jest.Mock).mockReturnValue({
      auth: { getUser },
    });
    guard = new TenantGuard({ findMembership } as unknown as MembersService);
  });

  it('rejects a request without a bearer token', async () => {
    const { context } = makeContext({ 'x-tenant-id': TENANT_A });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid token before looking at memberships', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('bad'),
    });
    const { context } = makeContext({
      authorization: 'Bearer nope',
      'x-tenant-id': TENANT_A,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('rejects a request without the x-tenant-id header', async () => {
    signedInAs('user-1');
    const { context } = makeContext({ authorization: 'Bearer good' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findMembership).not.toHaveBeenCalled();
  });

  // A value that is not a UUID would make the membership query fail inside
  // Postgres (invalid input syntax) and surface as a 500. It is the caller's
  // mistake, so it is refused here with the same 401 as any other bad header.
  it.each(['not-a-uuid', '123', "' or 1=1 --", 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaX'])(
    'rejects a malformed x-tenant-id (%s) without querying memberships',
    async (value) => {
      signedInAs('user-1');
      const { context } = makeContext({
        authorization: 'Bearer good',
        'x-tenant-id': value,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(findMembership).not.toHaveBeenCalled();
    },
  );

  it('accepts a UUID of any version, such as the seeded tenant ids', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue({ role: 'viewer' });
    const seeded = '00000000-0000-0000-0000-000000000001';
    const { context } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': seeded,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findMembership).toHaveBeenCalledWith(seeded, 'user-1');
  });

  it('rejects a caller who is not a member of the requested tenant', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue(null);
    const { context, request } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': TENANT_B,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findMembership).toHaveBeenCalledWith(TENANT_B, 'user-1');
    expect(request.tenantContext).toBeUndefined();
  });

  it('builds the tenant context from the verified user and the membership role', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue({ role: 'staff' });
    const { context, request } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': TENANT_A,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.tenantContext).toEqual({
      userId: 'user-1',
      tenantId: TENANT_A,
      role: 'staff',
    });
  });

  it('uses the first value when x-tenant-id is sent more than once', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue({ role: 'owner' });
    const { context } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': [TENANT_A, TENANT_B],
    });

    await guard.canActivate(context);
    expect(findMembership).toHaveBeenCalledWith(TENANT_A, 'user-1');
  });
});
