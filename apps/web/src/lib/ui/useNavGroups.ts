"use client";

/**
 * useNavGroups — the persisted open/closed state of the collapsible nav groups (the "Information"
 * disclosure in the rail + the mobile More sheet). Built on useLocalState, so it is SSR-safe and
 * the server snapshot is "nothing stored" ⇒ groups render COLLAPSED on a first load.
 *
 * The stored blob is untrusted (hand-editable localStorage): `coerceNavGroupState` drops anything
 * that isn't a boolean, so a corrupt value degrades to the default rather than throwing.
 */

import { useCallback } from "react";
import { coerceNavGroupState, NAV_GROUPS_STORAGE_KEY } from "@/lib/nav";
import { useLocalState } from "@/lib/ui/useLocalState";

export interface NavGroupsApi {
  /** `{ [groupKey]: open }` — a key being absent means "never toggled by this user". */
  state: Record<string, boolean>;
  setGroupOpen: (key: string, open: boolean) => void;
}

export function useNavGroups(): NavGroupsApi {
  const [raw, setRaw] = useLocalState<Record<string, boolean>>(NAV_GROUPS_STORAGE_KEY, {});
  const state = coerceNavGroupState(raw);
  const setGroupOpen = useCallback(
    (key: string, open: boolean) => setRaw({ ...coerceNavGroupState(raw), [key]: open }),
    [raw, setRaw],
  );
  return { state, setGroupOpen };
}
