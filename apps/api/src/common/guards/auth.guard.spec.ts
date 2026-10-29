import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { getSupabaseAdminClient } from '../supabase/supabase.client';

jest.mock('../supabase/supabase.client');

const getUser = jest.fn();

function makeContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; userId?: string } = {
    headers,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AuthGuard', () => {
  beforeEach(() => {
    getUser.mockReset();
    (getSupabaseAdminClient as jest.Mock).mockReturnValue({
      auth: { getUser },
    });
  });

  it('rejects a request without a bearer token', async () => {
    const { context } = makeContext({});

    await expect(new AuthGuard().canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('bad'),
    });
    const { context } = makeContext({ authorization: 'Bearer nope' });

    await expect(new AuthGuard().canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(getUser).toHaveBeenCalledWith('nope');
  });

  it('attaches the user id for a valid token', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const { context, request } = makeContext({ authorization: 'Bearer good' });

    await expect(new AuthGuard().canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('user-1');
  });
});
