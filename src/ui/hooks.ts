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
