import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDevelopmentActionHandler, requestDevelopmentAction } from '../development-bridge';

describe('development bridge', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    unregister?.();
    unregister = null;
  });

  it('queues requests made before the workspace mounts and drains them on registration', async () => {
    const pending = requestDevelopmentAction({ type: 'inspect' });
    const settled = vi.fn();
    void pending.then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    unregister = registerDevelopmentActionHandler(() => ({ ok: true, message: 'handled' }));

    await expect(pending).resolves.toEqual({ ok: true, message: 'handled' });
  });

  it('passes the action through to the handler and returns its result', async () => {
    const handler = vi.fn(() => ({ ok: true, message: 'done', data: { cellId: 'c-1' } }));
    unregister = registerDevelopmentActionHandler(handler);

    const result = await requestDevelopmentAction({ type: 'create-cell', sql: 'SELECT 1', kind: 'query' });

    expect(handler).toHaveBeenCalledWith({ type: 'create-cell', sql: 'SELECT 1', kind: 'query' });
    expect(result).toEqual({ ok: true, message: 'done', data: { cellId: 'c-1' } });
  });

  it('awaits asynchronous handlers', async () => {
    unregister = registerDevelopmentActionHandler(async () => {
      await Promise.resolve();
      return { ok: true, message: 'async done' };
    });

    await expect(requestDevelopmentAction({ type: 'inspect' })).resolves.toEqual({ ok: true, message: 'async done' });
  });

  it('turns a thrown handler error into a failed result rather than rejecting', async () => {
    unregister = registerDevelopmentActionHandler(() => {
      throw new Error('DuckDB is not ready');
    });

    await expect(requestDevelopmentAction({ type: 'inspect' })).resolves.toEqual({
      ok: false,
      message: 'DuckDB is not ready',
    });
  });

  it('falls back to a generic message when a handler throws a non-error', async () => {
    unregister = registerDevelopmentActionHandler(() => {
      throw 'nope';
    });

    const result = await requestDevelopmentAction({ type: 'inspect' });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('The development workspace could not complete the request.');
  });

  it('processes queued requests in order', async () => {
    const seen: string[] = [];
    unregister = registerDevelopmentActionHandler(async (action) => {
      seen.push(action.type === 'create-cell' ? action.sql : action.type);
      return { ok: true, message: 'ok' };
    });

    await Promise.all([
      requestDevelopmentAction({ type: 'create-cell', sql: 'first' }),
      requestDevelopmentAction({ type: 'create-cell', sql: 'second' }),
      requestDevelopmentAction({ type: 'inspect' }),
    ]);

    expect(seen).toEqual(['first', 'second', 'inspect']);
  });

  it('stops handling once the workspace unmounts, and resumes when it mounts again', async () => {
    const first = vi.fn(() => ({ ok: true, message: 'first handler' }));
    const stop = registerDevelopmentActionHandler(first);
    stop();

    const pending = requestDevelopmentAction({ type: 'inspect' });
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();

    unregister = registerDevelopmentActionHandler(() => ({ ok: true, message: 'second handler' }));

    await expect(pending).resolves.toEqual({ ok: true, message: 'second handler' });
    expect(first).not.toHaveBeenCalled();
  });

  it('ignores a stale unregister so a remount keeps the newest handler', async () => {
    const stopFirst = registerDevelopmentActionHandler(() => ({ ok: true, message: 'first handler' }));
    unregister = registerDevelopmentActionHandler(() => ({ ok: true, message: 'second handler' }));

    stopFirst();

    await expect(requestDevelopmentAction({ type: 'inspect' })).resolves.toEqual({
      ok: true,
      message: 'second handler',
    });
  });
});
