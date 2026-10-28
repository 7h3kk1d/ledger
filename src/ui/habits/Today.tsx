import { useEffect, useRef, useState } from "preact/hooks";
import type { Habit } from "../../model/types";
import { displayOf, habitHue, isDone, manualDone, signalsOf, type DoneIndex } from "../../model/reduce";
import { countsOn, dayState, expectationOf, habitStreak, progress, streakUnit } from "../../model/schedule";
import type { Signals } from "../../signals/useSignals";
import { currentValue, dayProgress, excusedLabel } from "./SignalsUI";
import { Check, Excused } from "./icons";

/**
 * Today's habits in sections, each in the user's habit order:
 * - open: what's left to do (with hideDone off, everything due or done today)
 * - done: ticked off today, when hideDone is on
 * - notDue: not expected today (a rest day, an interval still covered, a
 *   weekly target met, an excused day)
 * `keep` holds habits just ticked off, left in `open` for a moment so the tap
 * is seen before they move.
 */
export interface TodaySections {
  open: Habit[];
  done: Habit[];
  notDue: Habit[];
}

export function todaySections(
  habits: readonly Habit[],
  idx: DoneIndex,
  today: string,
  opts: { hideDone: boolean; keep?: ReadonlySet<string> },
): TodaySections {
  const s: TodaySections = { open: [], done: [], notDue: [] };
  for (const h of habits) {
    if (!countsOn(idx, h, today)) s.notDue.push(h);
    else if (opts.hideDone && isDone(idx, h, today) && !opts.keep?.has(h.id)) s.done.push(h);
    else s.open.push(h);
  }
  return s;
}

/**
 * A tile's one line under the name: the day's value from linked data
 * ("299 of 680 Cal"), else how a period or interval habit stands ("2/3 this
 * week", "due"), else the streak.
 */
export function tileSub(signals: Signals, idx: DoneIndex, h: Habit, today: string): string | undefined {
  const prog = signalsOf(h).length ? dayProgress(signals, h, today) : undefined;
  if (prog) return prog.text;
  const exp = expectationOf(h);
  if (exp.kind !== "daily") {
    const p = progress(idx, h, today);
    if (p) return p;
  }
  const r = displayOf(h).streak;
  const reported = r ? currentValue(signals, r) : undefined;
  if (reported) return `🔥 ${reported.value.toLocaleString()}`;
  const n = habitStreak(idx, h, today);
  return n > 0 ? `🔥 ${n}${streakUnit(exp)}` : undefined;
}

/** What a tap did: toggled the check-in, or opened the day's detail. */
export type TapResult = "toggled" | "detail";

const LINGER_MS = 900;

/** Today's habits as big tiles: tap to tick off, long-press for the day's detail. */
export function TodayTiles(props: {
  habits: readonly Habit[];
  idx: DoneIndex;
  signals: Signals;
  noted: ReadonlySet<string>;
  today: string;
  hideDone: boolean;
  onTap: (h: Habit) => TapResult;
  onDetail: (h: Habit) => void;
}) {
  const { idx, today } = props;
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const linger = (id: string) => {
    clearTimeout(timers.current.get(id));
    setKeep((k) => new Set(k).add(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setKeep((k) => {
          const n = new Set(k);
          n.delete(id);
          return n;
        });
      }, LINGER_MS),
    );
  };

  const s = todaySections(props.habits, idx, today, { hideDone: props.hideDone, keep });

  const tile = (h: Habit) => (
    <Tile
      key={h.id}
      habit={h}
      idx={idx}
      signals={props.signals}
      noted={props.noted}
      today={today}
      leaving={props.hideDone && keep.has(h.id) && isDone(idx, h, today)}
      onTap={() => {
        const was = isDone(idx, h, today);
        if (props.onTap(h) === "toggled" && !was && props.hideDone) linger(h.id);
      }}
      onDetail={() => props.onDetail(h)}
    />
  );

  return (
    <div class="today-view">
      {s.open.length > 0 ? (
        <div class="tiles">{s.open.map(tile)}</div>
      ) : (
        <p class="empty">{s.done.length ? "All done today 🎉" : "Nothing due today."}</p>
      )}
      {s.done.length > 0 && (
        <details class="tile-section">
          <summary>Done today ({s.done.length})</summary>
          <div class="tiles">{s.done.map(tile)}</div>
        </details>
      )}
      {s.notDue.length > 0 && (
        <details class="tile-section">
          <summary>Not due today ({s.notDue.length})</summary>
          <div class="tiles">{s.notDue.map(tile)}</div>
        </details>
      )}
    </div>
  );
}

function Tile(props: {
  habit: Habit;
  idx: DoneIndex;
  signals: Signals;
  noted: ReadonlySet<string>;
  today: string;
  leaving: boolean;
  onTap: () => void;
  onDetail: () => void;
}) {
  const { habit: h, idx, signals, today } = props;
  const state = dayState(idx, h, today);
  const done = state === "done";
  const linked = signalsOf(h).length > 0;
  const prog = linked && state !== "unknown" ? dayProgress(signals, h, today) : undefined;
  const partial = !done && prog?.fraction !== undefined && prog.fraction > 0 && state !== "excused";
  const sub = tileSub(signals, idx, h, today);
  const press = useLongPress(props.onDetail);
  const status =
    state === "excused" ? excusedLabel(signals, h)
    : state === "unknown" ? "no data yet"
    : state === "covered" ? "covered"
    : state === "late" ? "late"
    : state === "rest" ? "rest day"
    : undefined;
  return (
    <button
      class={`tile ${state}${props.leaving ? " leaving" : ""}`}
      style={{ "--h": habitHue(h) }}
      aria-pressed={done}
      aria-label={`${h.name}${status ? ` (${status})` : ""}${sub ? `: ${sub}` : ""}`}
      onClick={() => {
        if (!press.consumed()) props.onTap();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        press.cancel();
        props.onDetail();
      }}
      {...press.handlers}
    >
      <span class="tile-text">
        <span class="tile-name">{h.name}</span>
        {(sub || status) && <small class="tile-sub">{sub ?? status}</small>}
      </span>
      <span
        class={`cell ${state} today${done && !manualDone(idx, h, today) ? " linked" : ""}${props.noted.has(`${h.id} ${today}`) ? " noted" : ""}${partial ? " partial" : ""}`}
        style={partial ? { "--p": Math.min(prog!.fraction!, 1) } : undefined}
        aria-hidden="true"
      >
        {done && <Check />}
        {state === "excused" && <Excused />}
      </span>
    </button>
  );
}

const LONG_PRESS_MS = 450;

/**
 * Press and hold for `onLong`. The click that ends a long press is swallowed:
 * check `consumed()` in onClick. Moving the finger (a scroll) cancels it.
 */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancel, []);
  return {
    cancel,
    consumed: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          timer.current = undefined;
          onLong();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: PointerEvent) => {
        const p = start.current;
        if (p && timer.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  };
}
