import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Native <dialog> modal; closes on Esc or backdrop click. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <header>
        <h2>{props.title}</h2>
        <button class="ghost" aria-label="Close" onClick={props.onClose}>✕</button>
      </header>
      {props.children}
    </dialog>
  );
}
