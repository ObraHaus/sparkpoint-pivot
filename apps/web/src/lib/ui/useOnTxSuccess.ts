"use client";

import { useEffect } from "react";

/**
 * Fire `onDone` once per confirmed transaction, then clear the write state so it cannot refire.
 *
 * A module-scope hook rather than an inline effect because both broker write surfaces need exactly
 * this and the rule against setState-in-effect traces through component-scoped callbacks — a second
 * copy is a second place for the "reverted receipt is not a success" handling to drift.
 */
export function useOnTxSuccess(
  tx: { isSuccess: boolean; reset: () => void },
  onDone: () => void,
): void {
  const { isSuccess, reset } = tx;
  useEffect(() => {
    if (!isSuccess) return;
    onDone();
    reset();
  }, [isSuccess, reset, onDone]);
}
