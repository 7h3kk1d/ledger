import type { DocHandle } from "@automerge/automerge-repo";
import { useEffect, useState } from "preact/hooks";

/** Re-render on every change to the handle's document. */
export function useDoc<T>(handle: DocHandle<T>): T {
  const [doc, setDoc] = useState<T>(() => handle.doc() as T);
  useEffect(() => {
    const onChange = () => setDoc(handle.doc() as T);
    handle.on("change", onChange);
    onChange();
    return () => void handle.off("change", onChange);
  }, [handle]);
  return doc;
}
