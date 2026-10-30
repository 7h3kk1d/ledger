import { useState } from "preact/hooks";
import type { Habit, LedgerDoc, Tag } from "../../model/types";
import { displayOf, doneDates, habitHue, habitLog, isDone, localDate, manualDone, monthGrid, shiftDate, signalsOf, type DoneIndex } from "../../model/reduce";
import { bestStreak, dayState, expectationOf, habitStreak, isScheduled, scheduleLabel, streakUnit } from "../../model/schedule";
import type { Signals } from "../../signals/useSignals";
import { usePress } from "../hooks";
import { Modal } from "../Modal";
import { currentValue, dayProgress } from "./SignalsUI";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return localDate(new Date(y, m - 1 + by, 1)).slice(0, 7);
};
const monthTitle = (ym: string) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const shortDate = (d: string, today: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", ...(d.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
  });

/**
 * One habit's history: its streaks, a month of days (tap to tick, hold for
 * the day's detail, as in the week grid), and every note and excuse.
 */
export function HabitPage(props: {
  habit: Habit;
  doc: LedgerDoc;
  idx: DoneIndex;
  signals: Signals;
  noted: ReadonlySet<string>;
  tags: Tag[];
  today: string;
  onToggle: (date: string) => void;
  onDetail: (date: string) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { habit: h, idx, signals, today } = props;
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const press = usePress();
  const exp = expectationOf(h);
  const unit = streakUnit(exp);
  const reported = displayOf(h).streak ? currentValue(signals, displayOf(h).streak!) : undefined;
  const linked = signalsOf(h).length > 0;

  // the last 30 days: a share of the days it was expected on for day-by-day
  // habits, else how many times it was done. Days before the habit was made
  // (or first done, if ticked off further back) don't count.
  const made = h.createdAt ? localDate(new Date(h.createdAt)) : today;
  const firstDone = doneDates(idx, h)[0] ?? today;
  const first = firstDone < made ? firstDone : made;
  const last30 = Array.from({ length: 30 }, (_, i) => shiftDate(today, -i)).filter((d) => d >= first);
  const since = first > shiftDate(today, -29) ? `since ${shortDate(first, today).replace(/^\w+, /, "")}` : "last 30 days";
  const dayBased = exp.kind === "daily" || exp.kind === "weekdays";
  const expected = last30.filter((d) => {
    if (!isScheduled(h, d)) return false;
    const s = dayState(idx, h, d);
    // today counts once done; excused days and days without data aren't held against it
    return s !== "excused" && s !== "unknown" && (d !== today || s === "done");
  });
  const expectedDone = expected.filter((d) => isDone(idx, h, d)).length;
  const timesDone = last30.filter((d) => isDone(idx, h, d)).length;
  const log = habitLog(props.doc, h.id);

  return (
    <Modal title={h.name} onClose={props.onClose}>
      <div class="habit-page" style={{ "--h": habitHue(h) }}>
        <div class="habit-page-head">
          <span>
            {scheduleLabel(exp)}
            {props.tags.map((t) => <span key={t.id} class="chip">{t.name}</span>)}
          </span>
          <button onClick={props.onEdit}>Edit</button>
        </div>

        <div class="stats">
          <div>
            <strong>{reported ? reported.value.toLocaleString() : `${habitStreak(idx, h, today)}${unit}`}</strong>
            <small>{reported ? `streak, from ${reported.source}` : "current streak"}</small>
          </div>
          <div><strong>{bestStreak(idx, h)}{unit}</strong><small>best streak</small></div>
          {dayBased ? (
            <div>
              <strong>{expected.length ? `${Math.round((100 * expectedDone) / expected.length)}%` : "–"}</strong>
              <small>{since}</small>
            </div>
          ) : (
            <div><strong>{timesDone}×</strong><small>{since}</small></div>
          )}
        </div>

        <div class="month-nav">
          <button class="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <strong>{monthTitle(month)}</strong>
          <button class="ghost" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
          {month !== thisMonth && <button class="ghost back" onClick={() => setMonth(thisMonth)}>Today</button>}
        </div>
        <div class="habit-cal">
          {WEEKDAYS.map((w, i) => <span class="weekday" key={i}>{w}</span>)}
          {monthGrid(month).map((d) => {
            if (!d.startsWith(month)) return <span key={d} />;
            const future = d > today;
            const state = future ? "future" : dayState(idx, h, d);
            const done = state === "done";
            const prog = linked && !future && !done && state !== "unknown" ? dayProgress(signals, h, d) : undefined;
            const partial = prog?.fraction !== undefined && prog.fraction > 0 && state !== "excused";
            const cls = [
              "cell",
              state,
              d === today && "today",
              done && !manualDone(idx, h, d) && "linked",
              props.noted.has(`${h.id} ${d}`) && "noted",
              partial && "partial",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={d}
                class={cls}
                style={partial ? { "--p": Math.min(prog!.fraction!, 1) } : undefined}
                disabled={future}
                aria-pressed={done}
                aria-label={`${new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${future ? "" : `: ${state}`}`}
                {...(future ? {} : press(() => props.onToggle(d), () => props.onDetail(d)))}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>

        <section class="detail-section">
          <h3>Notes and excuses</h3>
          {log.length === 0 ? (
            <small class="muted">None yet. Hold a day to add a note or excuse it.</small>
          ) : (
            <ul class="habit-log">
              {log.map((e) => (
                <li key={e.event.id}>
                  <button class="ghost" onClick={() => props.onDetail(e.date)}>
                    <time>{shortDate(e.date, today)}</time>
                    <span>
                      {e.kind === "excuse" ? (
                        <><strong>Excused</strong>{e.text && ` · ${e.text}`}</>
                      ) : (
                        <>{e.reason && <strong>{e.reason}: </strong>}{e.text}</>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
