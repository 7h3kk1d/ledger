import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { LedgerDoc } from "../../model/types";
import { habitEventsOn, localDate, monthGrid } from "../../model/reduce";
import { toggleHabit } from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { Modal } from "../Modal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return localDate(new Date(y, m - 1 + by, 1)).slice(0, 7);
};
const monthTitle = (ym: string) =>
  new Date(`${ym}-01T00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function Calendar({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const today = localDate(new Date());
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [habitId, setHabitId] = useState(""); // "" = all habits
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const habits = Object.values(doc.habits);
  const habit = habitId ? doc.habits[habitId] : undefined;
  const days = monthGrid(month);

  const doneCount = (date: string) =>
    habits.filter((h) => habitEventsOn(doc, h, date).length > 0).length;

  const onDay = (date: string) => {
    if (date > today) return;
    if (habit) toggleHabit(handle, doc, habit, date);
    else if (habits.length) setPickedDay(date);
  };

  return (
    <section>
      <div class="toolbar">
        <button class="ghost" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong class="grow">{monthTitle(month)}</strong>
        <select value={habitId} onChange={(e) => setHabitId(e.currentTarget.value)}>
          <option value="">All habits</option>
          {habits.map((h) => <option value={h.id}>{h.name}</option>)}
        </select>
        <button class="ghost" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <button disabled={month === thisMonth} onClick={() => setMonth(thisMonth)}>Today</button>
      </div>

      {habits.length === 0 ? (
        <p class="empty">No habits yet. Add one on the Habits tab.</p>
      ) : (
        <div class="calendar">
          {WEEKDAYS.map((w) => <span class="weekday" key={w}>{w}</span>)}
          {days.map((d) => {
            const inMonth = d.startsWith(month);
            const done = habit ? habitEventsOn(doc, habit, d).length > 0 : false;
            const n = habit ? 0 : doneCount(d);
            const ratio = habit ? (done ? 1 : 0) : n / habits.length;
            return (
              <button
                key={d}
                class={`day-cell${inMonth ? "" : " outside"}${d === today ? " today" : ""}${done ? " done" : ""}`}
                style={{ "--ratio": ratio }}
                disabled={d > today}
                aria-label={d}
                onClick={() => onDay(d)}
              >
                <span class="num">{Number(d.slice(8))}</span>
                {habit ? (done && <span class="mark">✓</span>) : n > 0 && <span class="frac">{n}/{habits.length}</span>}
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
            {habits.map((h) => {
              const done = habitEventsOn(doc, h, pickedDay).length > 0;
              return (
                <li key={h.id}>
                  <label class="check">
                    <input type="checkbox" checked={done} onChange={() => toggleHabit(handle, doc, h, pickedDay)} />
                    {h.name}
                  </label>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </section>
  );
}
