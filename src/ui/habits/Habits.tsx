import { useMemo, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Habit, LedgerDoc } from "../../model/types";
import {
  activeHabits,
  archivedHabits,
  dayRange,
  doneIndex,
  habitHue,
  habitStreak,
  HUES,
  isDone,
  shiftDate,
} from "../../model/reduce";
import {
  createDailyHabit,
  moveHabit,
  renameHabit,
  setHabitArchived,
  setHabitHue,
  toggleHabit,
} from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { useMedia, useToday } from "../hooks";
import { Modal } from "../Modal";

const weekday = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "short" });
const dayNum = (d: string) => Number(d.slice(8));
const monthLabel = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const longDate = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export function Habits({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const today = useToday();
  const narrow = useMedia("(max-width: 520px)");
  const DAYS = narrow ? 5 : 7;
  // pages back from today, so the view follows the date across midnight
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const idx = useMemo(() => doneIndex(doc), [doc]);
  const end = shiftDate(today, -DAYS * page);
  const days = dayRange(end, DAYS);
  const habits = activeHabits(doc);
  const archived = archivedHabits(doc);
  const editing = editingId ? doc.habits[editingId] : undefined;
  const doneToday = habits.filter((h) => isDone(idx, h, today)).length;
  const first = monthLabel(days[0]!);

  return (
    <section>
      {habits.length > 0 && <TodaySummary done={doneToday} total={habits.length} />}

      <div class="toolbar">
        <button class="ghost" aria-label="Earlier" onClick={() => setPage(page + 1)}>‹</button>
        <strong>{first}{first !== monthLabel(end) && ` – ${monthLabel(end)}`}</strong>
        <button class="ghost" aria-label="Later" disabled={page === 0} onClick={() => setPage(page - 1)}>›</button>
        {page > 0 && <button onClick={() => setPage(0)}>Today</button>}
        <span class="grow" />
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
            const streak = habitStreak(idx, h, today);
            return (
              <div class="grid-row" key={h.id} style={{ "--h": habitHue(h) }}>
                <button class="habit-name" onClick={() => setEditingId(h.id)}>
                  <span class="dot" />
                  <span>{h.name}</span>
                </button>
                {days.map((d) => {
                  const done = isDone(idx, h, d);
                  const isToday = d === today;
                  return (
                    <span key={d} class={isToday ? "cell-wrap today" : "cell-wrap"}>
                      <button
                        class={`cell${done ? " done" : ""}${isToday ? " today" : ""}`}
                        aria-pressed={done}
                        aria-label={`${h.name}, ${longDate(d)}`}
                        onClick={() => toggleHabit(handle, h, d)}
                      >
                        {done && <Check />}
                      </button>
                    </span>
                  );
                })}
                <span class={streak > 0 ? "streak on" : "streak"}>
                  {streak > 0 ? <>🔥 {streak}</> : "–"}
                </span>
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
          isFirst={habits[0]?.id === editing.id}
          isLast={habits[habits.length - 1]?.id === editing.id}
          onClose={() => setEditingId(null)}
          onMove={(dir) => moveHabit(handle, editing.id, dir)}
          onSave={(name, hue) => {
            if (name !== editing.name) renameHabit(handle, editing.id, name);
            if (hue !== habitHue(editing)) setHabitHue(handle, editing.id, hue);
            setEditingId(null);
          }}
          onArchive={() => {
            setHabitArchived(handle, editing.id, true);
            setEditingId(null);
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

export const Check = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

function TodaySummary({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const all = done === total;
  return (
    <div class={all ? "summary all" : "summary"}>
      <svg class="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} class="ring-bg" />
        <circle
          cx="32" cy="32" r={r} class="ring-fg"
          stroke-dasharray={c}
          stroke-dashoffset={c * (1 - done / total)}
        />
      </svg>
      <div>
        <div class="summary-count">{done} <small>/ {total}</small></div>
        <div class="summary-label">{all ? "All done today 🎉" : "done today"}</div>
      </div>
    </div>
  );
}

function EditHabit(props: {
  habit: Habit;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onMove: (dir: -1 | 1) => void;
  onSave: (name: string, hue: number) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(props.habit.name);
  const [hue, setHue] = useState(habitHue(props.habit));
  return (
    <Modal title="Edit habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim(), hue);
        }}
      >
        <label>Name
          <input autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <fieldset class="swatches">
          <legend>Colour</legend>
          {HUES.map((h) => (
            <button
              type="button"
              key={h}
              class="swatch"
              style={{ "--h": h }}
              aria-label={`Hue ${h}`}
              aria-pressed={h === hue}
              onClick={() => setHue(h)}
            />
          ))}
        </fieldset>
        <div class="row">
          <button type="button" disabled={props.isFirst} onClick={() => props.onMove(-1)}>↑ Move up</button>
          <button type="button" disabled={props.isLast} onClick={() => props.onMove(1)}>↓ Move down</button>
        </div>
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
