import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Habit, LedgerDoc } from "../../model/types";
import {
  activeHabits,
  dayRange,
  habitEventsOn,
  habitStreak,
  localDate,
  shiftDate,
} from "../../model/reduce";
import { createDailyHabit, renameHabit, setHabitArchived, toggleHabit } from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { Modal } from "../Modal";

const DAYS = 7;
const weekday = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "short" });
const dayNum = (d: string) => Number(d.slice(8));
const monthLabel = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });

export function Habits({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const today = localDate(new Date());
  const [end, setEnd] = useState(today);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const days = dayRange(end, DAYS);
  const habits = activeHabits(doc);
  const archived = Object.values(doc.habits).filter((h) => h.archived);

  const toggle = (habit: Habit, date: string) => toggleHabit(handle, doc, habit, date);

  return (
    <section>
      <div class="toolbar">
        <button class="ghost" onClick={() => setEnd(shiftDate(end, -DAYS))}>‹</button>
        <strong class="grow">{monthLabel(days[0]!)}{monthLabel(days[0]!) !== monthLabel(end) && ` – ${monthLabel(end)}`}</strong>
        <button class="ghost" disabled={end >= today} onClick={() => setEnd(shiftDate(end, DAYS) > today ? today : shiftDate(end, DAYS))}>›</button>
        <button disabled={end === today} onClick={() => setEnd(today)}>Today</button>
        <button class="primary" onClick={() => setAdding(true)}>+ Habit</button>
      </div>

      {habits.length === 0 ? (
        <p class="empty">No habits yet. Add one to start tracking.</p>
      ) : (
        <div class="grid" style={{ "--cols": DAYS }}>
          <div class="grid-head">
            <span />
            {days.map((d) => (
              <span key={d} class={d === today ? "day today" : "day"}>
                <small>{weekday(d)}</small>
                {dayNum(d)}
              </span>
            ))}
            <span class="streak-h">Streak</span>
          </div>
          {habits.map((h) => {
            const streak = habitStreak(doc, h, today);
            return (
              <div class="grid-row" key={h.id}>
                <button class="ghost habit-name" onClick={() => setEditing(h)}>{h.name}</button>
                {days.map((d) => {
                  const done = habitEventsOn(doc, h, d).length > 0;
                  return (
                    <button
                      key={d}
                      class={`cell${done ? " done" : ""}${d === today ? " today" : ""}`}
                      aria-pressed={done}
                      aria-label={`${h.name} ${d}`}
                      onClick={() => toggle(h, d)}
                    >
                      {done ? "✓" : ""}
                    </button>
                  );
                })}
                <span class="streak">{streak > 0 ? `🔥 ${streak}` : "–"}</span>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details class="archived">
          <summary>Archived ({archived.length})</summary>
          <ul>
            {archived.map((h) => (
              <li key={h.id}>
                <span>{h.name}</span>
                <button class="ghost" onClick={() => setHabitArchived(handle, h.id, false)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <EditHabit
          habit={editing}
          onClose={() => setEditing(null)}
          onSave={(name) => {
            renameHabit(handle, editing.id, name);
            setEditing(null);
          }}
          onArchive={() => {
            setHabitArchived(handle, editing.id, true);
            setEditing(null);
          }}
        />
      )}

      {adding && (
        <AddHabit
          onClose={() => setAdding(false)}
          onAdd={(name) => {
            createDailyHabit(handle, name);
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

function AddHabit(props: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal title="New daily habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onAdd(name.trim());
        }}
      >
        <input autofocus placeholder="e.g. Stretch" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <footer>
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!name.trim()}>Add habit</button>
        </footer>
      </form>
    </Modal>
  );
}

function EditHabit(props: {
  habit: Habit;
  onClose: () => void;
  onSave: (name: string) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(props.habit.name);
  return (
    <Modal title="Edit habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim());
        }}
      >
        <input autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <footer>
          <button type="button" class="danger" onClick={props.onArchive}>Archive</button>
          <span class="grow" />
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!name.trim()}>Save</button>
        </footer>
      </form>
    </Modal>
  );
}
