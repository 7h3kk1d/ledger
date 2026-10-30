import * as A from "@automerge/automerge";

/**
 * How many of this copy's changes the server doesn't have yet, given the heads
 * it last reported. Undefined when the server is ahead in a way this copy
 * hasn't seen (it has changes from another device): then we can't tell.
 */
export function unsynced(doc: A.Doc<unknown>, server: A.Heads): number | undefined {
  if (!A.hasHeads(doc, server)) return undefined;
  return A.getChangesMetaSince(doc, server).length;
}
