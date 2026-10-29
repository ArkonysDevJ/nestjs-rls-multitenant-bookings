import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { MembersService } from '../../members/members.service';
import { getSupabaseAdminClient } from '../supabase/supabase.client';

jest.mock('../supabase/supabase.client');

const getUser = jest.fn();
const findMembership = jest.fn();

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
    const { context } = makeContext({ 'x-tenant-id': 'tenant-1' });

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
      'x-tenant-id': 'tenant-1',
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

  it('rejects a caller who is not a member of the requested tenant', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue(null);
    const { context, request } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': 'tenant-b',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findMembership).toHaveBeenCalledWith('tenant-b', 'user-1');
    expect(request.tenantContext).toBeUndefined();
  });

  it('builds the tenant context from the verified user and the membership role', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue({ role: 'staff' });
    const { context, request } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': 'tenant-a',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.tenantContext).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-a',
      role: 'staff',
    });
  });

  it('uses the first value when x-tenant-id is sent more than once', async () => {
    signedInAs('user-1');
    findMembership.mockResolvedValue({ role: 'owner' });
    const { context } = makeContext({
      authorization: 'Bearer good',
      'x-tenant-id': ['tenant-a', 'tenant-b'],
    });

    await guard.canActivate(context);
    expect(findMembership).toHaveBeenCalledWith('tenant-a', 'user-1');
  });
});
