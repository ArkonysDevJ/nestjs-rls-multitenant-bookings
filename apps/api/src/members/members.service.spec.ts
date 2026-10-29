import { NotFoundException } from '@nestjs/common';
import { MembersService } from './members.service';
import { recordSupabase } from '../common/testing/supabase-recorder';

jest.mock('../common/supabase/supabase.client');

// Intent of the service (tenant filter present, tenant value of a write taken
// from the context). The database rejecting violations is certified by pgTAP
// and Bruno.

const TENANT = 'tenant-from-context';
const USER = 'user-from-context';

describe('MembersService.findMembership', () => {
  it('filters by the tenant and the user it was given', async () => {
    const recorder = recordSupabase({
      data: { tenant_id: TENANT, role: 'staff' },
      error: null,
    });

    const membership = await new MembersService().findMembership(TENANT, USER);

    expect(recorder.eqFilters()).toEqual(
      expect.arrayContaining([
        ['tenant_id', TENANT],
        ['user_id', USER],
      ]),
    );
    expect(membership).toEqual({ tenantId: TENANT, role: 'staff' });
  });

  it('answers null when the user is not a member of that tenant', async () => {
    recordSupabase({ data: null, error: null });

    await expect(
      new MembersService().findMembership(TENANT, USER),
    ).resolves.toBeNull();
  });
});

describe('MembersService.findMembershipsForUser', () => {
  it('filters by the user it was given', async () => {
    const recorder = recordSupabase({ data: [], error: null });

    await new MembersService().findMembershipsForUser(USER);

    expect(recorder.eqFilters()).toEqual([['user_id', USER]]);
  });
});

describe('MembersService.addMember', () => {
  it('inserts into the tenant it was given, with the user found by email', async () => {
    const recorder = recordSupabase(
      { data: { tenant_id: TENANT, role: 'viewer' }, error: null },
      { data: 'user-found-by-email', error: null },
    );

    const membership = await new MembersService().addMember(
      TENANT,
      'someone@example.com',
      'viewer',
    );

    expect(recorder.calls).toContainEqual({
      method: 'rpc',
      args: ['find_user_id_by_email', { lookup_email: 'someone@example.com' }],
    });
    expect(recorder.insertedPayload()).toEqual({
      tenant_id: TENANT,
      user_id: 'user-found-by-email',
      role: 'viewer',
    });
    expect(membership).toEqual({ tenantId: TENANT, role: 'viewer' });
  });

  it('inserts nothing when no account has that email', async () => {
    const recorder = recordSupabase(
      { data: null, error: null },
      { data: null, error: null },
    );

    await expect(
      new MembersService().addMember(TENANT, 'nobody@example.com', 'staff'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recorder.calls.some((c) => c.method === 'insert')).toBe(false);
  });
});
