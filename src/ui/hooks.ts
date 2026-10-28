import { useEffect, useState } from "preact/hooks";
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
