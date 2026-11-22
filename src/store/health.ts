// HealthKit, in the iOS app only: the native side (ios/App/Health) reads what's new into batches
// and pushes them to a receiver (spec/healthkit-batch.md). This file asks it to, on launch and when
// the app comes back, and gives the settings their status. Ledger's own data doesn't change:
// health data reaches habits as signals from wherever the batches go (collectors' healthkit).
// A no-op in a browser.

export interface HealthStatus {
  /** HealthKit exists on this device. */
  available: boolean;
  /** The permission sheet has been answered (iOS doesn't say what was allowed). */
  asked: boolean;
  lastRead?: string;
  lastReadCount?: number;
  lastReadError?: string;
  /** Batches not yet taken by the receiver. */
  waiting: number;
  pushUrl?: string;
  hasToken: boolean;
  lastPushAt?: string;
  lastPushCount?: number;
  lastPushError?: string;
  /** Batches the receiver refused for good, set aside on the phone (not sent again). */
  rejected?: number;
}

interface HealthPlugin {
  authorize(): Promise<HealthStatus>;
  sync(): Promise<HealthStatus>;
  status(): Promise<HealthStatus>;
  /** url "" stops pushing; token omitted keeps the stored one (it never comes back to JS). */
  setPush(o: { url: string; token?: string }): Promise<HealthStatus>;
}

export function nativeHealth(): HealthPlugin | undefined {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.isNativePlatform?.() ? (cap.Plugins?.LedgerHealth as HealthPlugin | undefined) : undefined;
}

/** Not more often than this when the app keeps coming back. */
const MIN_GAP_MS = 60_000;
let last = 0;

/** Read and push now, if HealthKit was connected and a read isn't too recent. */
export async function syncHealth(force = false, now = Date.now()): Promise<HealthStatus | undefined> {
  const h = nativeHealth();
  if (!h) return undefined;
  if (!force && now - last < MIN_GAP_MS) return undefined;
  const s = await h.status();
  if (!s.available || !s.asked) return s;
  last = now;
  return h.sync();
}

/** On launch and each time the app comes back to the foreground. */
export function startHealth(): () => void {
  if (!nativeHealth()) return () => {};
  void syncHealth().catch(() => {});
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncHealth().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}

/** Why `url` can't be a receiver, or undefined if it can ("" turns pushing off). */
export function checkPushUrl(url: string): string | undefined {
  const u = url.trim();
  if (!u) return undefined;
  return /^https:\/\/[^\s/]+\/\S*$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*$/.test(u)
    ? undefined
    : "Use the receiver’s https:// address, e.g. https://healthkit.example/ingest.";
}
