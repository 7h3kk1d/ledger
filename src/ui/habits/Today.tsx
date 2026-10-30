import { useLinger, usePress } from "../hooks";
import type { Habit } from "../../model/types";
import { displayOf, habitHue, isDone, manualDone, signalsOf, type DoneIndex } from "../../model/reduce";
import { countsOn, dayState, expectationOf, habitStreak, progress, streakUnit } from "../../model/schedule";
import type { Signals } from "../../signals/useSignals";
import { currentValue, dayProgress, excuseLabel } from "./SignalsUI";
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
 * ("299 of 680 Cal"), else the values picked to show with the name ("44 to
 * approve"), else how a period or interval habit stands ("2/3 this week",
 * "due"), else the streak.
 */
export function tileSub(signals: Signals, idx: DoneIndex, h: Habit, today: string): string | undefined {
  const prog = signalsOf(h).length ? dayProgress(signals, h, today) : undefined;
  if (prog) return prog.text;
  const shown = (displayOf(h).metrics ?? []).flatMap((r) => currentValue(signals, r) ?? []);
  if (shown.length) return shown.map((m) => (m.unit ? m.text : `${m.label} ${m.text}`)).join(" · ");
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

export const LINGER_MS = 900;

/** Today's habits as big tiles: tap to tick off, hold (or right-click) for the day's detail. */
export function TodayTiles(props: {
  habits: readonly Habit[];
  idx: DoneIndex;
  signals: Signals;
  noted: ReadonlySet<string>;
  today: string;
  hideDone: boolean;
  onToggle: (h: Habit) => void;
  onDetail: (h: Habit) => void;
}) {
  const { idx, today } = props;
  const [keep, linger] = useLinger(LINGER_MS);
  const press = usePress();
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
      press={press(
        () => {
          const was = isDone(idx, h, today);
          props.onToggle(h);
          if (!was && props.hideDone) linger(h.id);
        },
        () => props.onDetail(h),
      )}
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
  press: ReturnType<ReturnType<typeof usePress>>;
}) {
  const { habit: h, idx, signals, today } = props;
  const state = dayState(idx, h, today);
  const done = state === "done";
  const linked = signalsOf(h).length > 0;
  const prog = linked && state !== "unknown" ? dayProgress(signals, h, today) : undefined;
  const partial = !done && prog?.fraction !== undefined && prog.fraction > 0 && state !== "excused";
  const sub = tileSub(signals, idx, h, today);
  const status =
    state === "excused" ? excuseLabel(signals, idx, h, today)
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
      {...props.press}
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
