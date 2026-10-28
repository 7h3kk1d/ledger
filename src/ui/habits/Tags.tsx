import { useState } from "preact/hooks";
import type { Tag } from "../../model/types";
import { Modal } from "../Modal";

/** Chips for picking which tag's habits to show; "All" shows every habit. */
export function TagFilter(props: {
  tags: Tag[];
  selected: string | undefined;
  onSelect: (tagId: string | undefined) => void;
  onEdit: () => void;
}) {
  return (
    <div class="tag-filter" role="group" aria-label="Show habits tagged">
      <button class="chip-button" aria-pressed={!props.selected} onClick={() => props.onSelect(undefined)}>All</button>
      {props.tags.map((t) => (
        <button
          key={t.id}
          class="chip-button"
          aria-pressed={props.selected === t.id}
          onClick={() => props.onSelect(props.selected === t.id ? undefined : t.id)}
        >
          {t.name}
        </button>
      ))}
      <button class="ghost edit-tags" aria-label="Rename or delete tags" title="Rename or delete tags" onClick={props.onEdit}>✎</button>
    </div>
  );
}

/**
 * A habit's tags in its editor: every tag as a chip to switch on or off, and
 * a box for a new one. New tags are only names until the habit is saved.
 */
export function TagField(props: {
  tags: Tag[];
  value: { ids: string[]; added: string[] };
  onChange: (v: { ids: string[]; added: string[] }) => void;
}) {
  const [draft, setDraft] = useState("");
  const { ids, added } = props.value;
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
  const add = () => {
    const name = draft.trim();
    setDraft("");
    if (!name) return;
    const existing = props.tags.find((t) => same(t.name, name));
    if (existing) {
      if (!ids.includes(existing.id)) props.onChange({ ids: [...ids, existing.id], added });
    } else if (!added.some((n) => same(n, name))) props.onChange({ ids, added: [...added, name] });
  };
  return (
    <fieldset class="tag-field">
      <legend>Tags</legend>
      <div class="chips">
        {props.tags.map((t) => {
          const on = ids.includes(t.id);
          return (
            <button
              type="button"
              key={t.id}
              class="chip-button"
              aria-pressed={on}
              onClick={() => props.onChange({ ids: on ? ids.filter((x) => x !== t.id) : [...ids, t.id], added })}
            >
              {t.name}
            </button>
          );
        })}
        {added.map((n) => (
          <button
            type="button"
            key={`new:${n}`}
            class="chip-button"
            aria-pressed={true}
            title="New tag; tap to drop it"
            onClick={() => props.onChange({ ids, added: added.filter((x) => x !== n) })}
          >
            {n}
          </button>
        ))}
      </div>
      <div class="tag-new">
        <input
          placeholder="New tag"
          aria-label="New tag"
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // not the form's submit
            add();
          }}
        />
        <button type="button" disabled={!draft.trim()} onClick={add}>Add</button>
      </div>
    </fieldset>
  );
}

/** Rename or delete tags. Each change is saved as it's made. */
export function TagsModal(props: {
  tags: Tag[];
  counts: Map<string, number>;
  onRename: (tagId: string, name: string) => void;
  onDelete: (tagId: string) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Modal title="Tags" onClose={props.onClose}>
      {props.tags.length === 0 ? (
        <p class="muted">No tags. Add them to a habit in its editor.</p>
      ) : (
        <ul class="tag-list">
          {props.tags.map((t) => {
            const n = props.counts.get(t.id) ?? 0;
            return (
              <li key={t.id}>
                <input
                  aria-label={`Rename ${t.name}`}
                  value={t.name}
                  onChange={(e) => {
                    const name = e.currentTarget.value.trim();
                    if (name && name !== t.name) props.onRename(t.id, name);
                    else e.currentTarget.value = t.name;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <small>{n === 1 ? "1 habit" : `${n} habits`}</small>
                {confirming === t.id ? (
                  <button class="primary danger" onClick={() => props.onDelete(t.id)}>Delete</button>
                ) : (
                  <button class="ghost" aria-label={`Delete ${t.name}`} onClick={() => setConfirming(t.id)}>✕</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p class="muted hint">Deleting a tag takes it off its habits; the habits stay.</p>
      <footer>
        <span class="grow" />
        <button class="primary" onClick={props.onClose}>Done</button>
      </footer>
    </Modal>
  );
}
