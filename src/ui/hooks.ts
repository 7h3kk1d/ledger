import { useEffect, useRef, useState } from "preact/hooks";
import { localDate } from "../model/reduce";

/**
 * Today's local date, kept current: re-checked when the app regains focus
 * (phones resume backgrounded tabs) and at the next local midnight.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate(new Date()));
  useEffect(() => {
    const check = () => setToday(localDate(new Date()));
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(check, midnight.getTime() - now.getTime() + 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [today]);
  return today;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/**
 * A per-device view preference in localStorage (a remembered tab, a filter):
 * undefined until set, or when storage is unavailable or holds something
 * `valid` rejects. Never for data that must persist or sync.
 */
export function usePref<T>(key: string, valid: (v: unknown) => v is T): [T | undefined, (v: T) => void] {
  const [value, setValue] = useState<T | undefined>(() => {
    try {
      const raw = localStorage.getItem(key);
      const v: unknown = raw === null ? undefined : JSON.parse(raw);
      return valid(v) ? v : undefined;
    } catch {
      return undefined;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // private mode or blocked storage: the choice lasts until reload
    }
  };
  return [value, set];
}

/**
 * Ids held for `ms` after `hold(id)`: something just ticked off stays where it
 * was for a moment, so the tap is seen before it moves out of view.
 */
export function useLinger(ms: number): [ReadonlySet<string>, (id: string) => void] {
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const hold = (id: string) => {
    clearTimeout(timers.current.get(id));
    setHeld((k) => new Set(k).add(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setHeld((k) => {
          const n = new Set(k);
          n.delete(id);
          return n;
        });
      }, ms),
    );
  };
  return [held, hold];
}

const HOLD_MS = 450;

/**
 * Tap or hold, for any number of elements (one press at a time):
 * `press(onTap, onHold)` gives an element its handlers. Holding, or a
 * right-click, calls onHold, and the click that ends a hold is swallowed.
 * Moving the finger (a scroll) cancels a hold.
 */
export function usePress() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancel, []);
  return (onTap: () => void, onHold: () => void) => ({
    onClick: () => {
      if (held.current) held.current = false;
      else onTap();
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      onHold();
    },
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        held.current = true;
        timer.current = undefined;
        onHold();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const p = start.current;
      if (p && timer.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  });
}
