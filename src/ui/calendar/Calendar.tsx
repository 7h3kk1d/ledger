import { useMemo, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { LedgerDoc } from "../../model/types";
import {
  activeHabits,
  doneIndex,
  habitHue,
  isDone,
  localDate,
  monthGrid,
} from "../../model/reduce";
import { bestStreak, expectationOf, habitStreak, isScheduled, streakUnit } from "../../model/schedule";
import { toggleHabit } from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { useToday } from "../hooks";
import { Modal } from "../Modal";
import { Check } from "../habits/Habits";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return localDate(new Date(y, m - 1 + by, 1)).slice(0, 7);
};
const monthTitle = (ym: string) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function Calendar({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const today = useToday();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [habitId, setHabitId] = useState(""); // "" = all habits
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const idx = useMemo(() => doneIndex(doc), [doc]);
  const habits = activeHabits(doc);
  const habit = habitId ? doc.habits[habitId] : undefined;
  const days = monthGrid(month);
  const doneCount = (date: string) => habits.filter((h) => isDone(idx, h, date)).length;

  // days of this month that have happened so far
  const elapsed = days.filter((d) => d.startsWith(month) && d <= today);
  const monthDone = habit ? elapsed.filter((d) => isDone(idx, habit, d)).length : 0;
  // a share of the days it was expected on, for habits tied to days
  const kind = habit && expectationOf(habit).kind;
  const dayBased = kind === "daily" || kind === "weekdays";
  const expected = habit ? elapsed.filter((d) => isScheduled(habit, d)) : [];
  const expectedDone = habit ? expected.filter((d) => isDone(idx, habit, d)).length : 0;
  const unit = habit ? streakUnit(expectationOf(habit)) : "";

  const onDay = (date: string) => {
    if (date > today) return;
    if (habit) toggleHabit(handle, habit, date);
    else if (habits.length) setPickedDay(date);
  };

  return (
    <section>
      <div class="toolbar">
        <button class="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong>{monthTitle(month)}</strong>
        <button class="ghost" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        {month !== thisMonth && <button onClick={() => setMonth(thisMonth)}>Today</button>}
        <span class="grow" />
        <select value={habitId} onChange={(e) => setHabitId(e.currentTarget.value)}>
          <option value="">All habits</option>
          {habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {habit && (
        <div class="stats" style={{ "--h": habitHue(habit) }}>
          {dayBased ? (
            <div><strong>{expected.length ? Math.round((100 * expectedDone) / expected.length) : 0}%</strong><small>this month ({expectedDone}/{expected.length})</small></div>
          ) : (
            <div><strong>{monthDone}</strong><small>done this month</small></div>
          )}
          <div><strong>{habitStreak(idx, habit, today)}{unit}</strong><small>current streak</small></div>
          <div><strong>{bestStreak(idx, habit)}{unit}</strong><small>best streak</small></div>
        </div>
      )}

      {habits.length === 0 ? (
        <p class="empty">No habits yet. Add one on the Habits tab.</p>
      ) : (
        <div class="calendar" style={habit ? { "--h": habitHue(habit) } : undefined}>
          {WEEKDAYS.map((w, i) => <span class="weekday" key={i}>{w}</span>)}
          {days.map((d) => {
            const inMonth = d.startsWith(month);
            const done = habit ? isDone(idx, habit, d) : false;
            const n = habit ? 0 : doneCount(d);
            const ratio = habit ? (done ? 1 : 0) : n / habits.length;
            return (
              <button
                key={d}
                class={`day-cell${habit ? " single" : ""}${inMonth ? "" : " outside"}${d === today ? " today" : ""}${ratio === 1 ? " done" : ""}`}
                style={{ "--ratio": ratio }}
                disabled={d > today}
                aria-label={d}
                aria-pressed={habit ? done : undefined}
                onClick={() => onDay(d)}
              >
                <span class="num">{Number(d.slice(8))}</span>
                {habit ? done && <span class="mark"><Check /></span> : n > 0 && <span class="frac">{n}/{habits.length}</span>}
              </button>
            );
          })}
        </div>
      )}

      {pickedDay && (
        <Modal
          title={new Date(`${pickedDay}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          onClose={() => setPickedDay(null)}
        >
          <ul class="checklist">
            {habits.map((h) => (
              <li key={h.id} style={{ "--h": habitHue(h) }}>
                <label class="check">
                  <input type="checkbox" checked={isDone(idx, h, pickedDay)} onChange={() => toggleHabit(handle, h, pickedDay)} />
                  {h.name}
                </label>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}
