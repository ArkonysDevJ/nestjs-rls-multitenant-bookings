import { getSupabaseAdminClient } from '../supabase/supabase.client';

/**
 * Test helper for the service specs. It stands in for the Supabase admin
 * client and records every call the service makes on it, in order, so a spec
 * can assert on what was asked of the database (which filters, which
 * payload) instead of on the order of a method chain.
 *
 * The specs that use it must call `jest.mock('.../supabase.client')`.
 *
 * What this certifies is the intent of the code, not its execution: that the
 * tenant filter is present and where its value comes from. That the database
 * really rejects a violation is certified by the pgTAP and Bruno suites.
 */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface QueryResult {
  data: unknown;
  error: unknown;
}

export interface SupabaseRecorder {
  calls: RecordedCall[];
  /** [column, value] of every .eq() call, in order. */
  eqFilters(): Array<[string, unknown]>;
  /** The payload of the single .insert() call. */
  insertedPayload(): Record<string, unknown>;
}

export function recordSupabase(
  result: QueryResult = { data: [], error: null },
  rpcResult: QueryResult = { data: null, error: null },
): SupabaseRecorder {
  const calls: RecordedCall[] = [];

  const chain: Record<string, unknown> = {};
  for (const method of [
    'from',
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'order',
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    chain[terminal] = (...args: unknown[]) => {
      calls.push({ method: terminal, args });
      return Promise.resolve(result);
    };
  }
  // A query awaited without a terminal call (a list) resolves to the result.
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  chain.rpc = (...args: unknown[]) => {
    calls.push({ method: 'rpc', args });
    return Promise.resolve(rpcResult);
  };

  (getSupabaseAdminClient as jest.Mock).mockReturnValue(chain);

  return {
    calls,
    eqFilters: () =>
      calls
        .filter((c) => c.method === 'eq')
        .map((c) => [c.args[0] as string, c.args[1]]),
    insertedPayload: () => {
      const inserts = calls.filter((c) => c.method === 'insert');
      expect(inserts).toHaveLength(1);
      return inserts[0].args[0] as Record<string, unknown>;
    },
  };
}
