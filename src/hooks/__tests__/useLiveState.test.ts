import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveState } from '../useLiveState';

describe('useLiveState', () => {
  // Two of these tests set state outside act() on purpose, to prove the ref is
  // current before React re-renders. React logs an act warning for that.
  let actWarning: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    actWarning = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).includes('not wrapped in act')) console.info(...args);
    });
  });

  afterEach(() => actWarning.mockRestore());

  it('exposes the initial value as both state and ref', () => {
    const { result } = renderHook(() => useLiveState('initial'));
    const [value, , ref] = result.current;

    expect(value).toBe('initial');
    expect(ref.current).toBe('initial');
  });

  it('supports a lazy initializer', () => {
    const { result } = renderHook(() => useLiveState(() => ({ count: 7 })));

    expect(result.current[0]).toEqual({ count: 7 });
    expect(result.current[2].current).toEqual({ count: 7 });
  });

  it('updates the ref synchronously, before React re-renders', async () => {
    const { result } = renderHook(() => useLiveState('before'));
    const [, set, ref] = result.current;

    // Deliberately outside act(): the ref must be current the instant it is set,
    // which is what lets chained WebMCP actions observe each other.
    set('after');

    expect(ref.current).toBe('after');
    expect(result.current[0]).toBe('before');

    await act(async () => undefined);
    expect(result.current[0]).toBe('after');
  });

  it('applies the updater form against the newest value, not the rendered one', async () => {
    const { result } = renderHook(() => useLiveState(0));
    const [, set, ref] = result.current;

    set((current) => current + 1);
    set((current) => current + 1);
    set((current) => current + 1);

    expect(ref.current).toBe(3);

    await act(async () => undefined);
    expect(result.current[0]).toBe(3);
  });

  it('keeps a stable setter identity across renders', () => {
    const { result, rerender } = renderHook(() => useLiveState('value'));
    const firstSetter = result.current[1];
    const firstRef = result.current[2];

    rerender();

    expect(result.current[1]).toBe(firstSetter);
    expect(result.current[2]).toBe(firstRef);
  });
});
