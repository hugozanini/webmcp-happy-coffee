import { useCallback, useRef, useState } from 'react';

type Updater<T> = T | ((current: T) => T);

/**
 * useState paired with a ref that is updated synchronously when state is set.
 *
 * A callback reads React state as it was for the render that created the
 * callback. That is correct for UI event handlers, which fire at most once per
 * render, but the WebMCP bridge chains several actions inside a single tool
 * call — `run_duckdb_sql` creates a cell and immediately runs it. Those actions
 * are separated by a microtask, while React re-renders and re-runs effects on a
 * later macrotask, so the second action would otherwise still observe the state
 * from before the first one.
 *
 * The returned ref always holds the newest value; the state value keeps driving
 * rendering. Read the ref from long-lived callbacks, and the state everywhere
 * else.
 */
export function useLiveState<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);

  const set = useCallback((next: Updater<T>) => {
    ref.current = typeof next === 'function' ? (next as (current: T) => T)(ref.current) : next;
    setValue(ref.current);
  }, []);

  return [value, set, ref] as const;
}
