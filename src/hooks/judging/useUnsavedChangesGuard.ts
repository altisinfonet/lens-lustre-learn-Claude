import { useState, useCallback } from "react";

/**
 * Tracks dirty state for judging UI and provides a confirmation gate
 * before navigating away or changing photo.
 */
export function useUnsavedChangesGuard() {
  const [isDirty, setIsDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);
  const markClean = useCallback(() => setIsDirty(false), []);

  /**
   * Wraps an action with a dirty check.
   * If dirty → shows confirmation dialog. If clean → executes immediately.
   */
  const guardAction = useCallback(
    (action: () => void) => {
      if (isDirty) {
        setPendingAction(() => action);
        setShowConfirm(true);
      } else {
        action();
      }
    },
    [isDirty]
  );

  const confirmDiscard = useCallback(() => {
    setShowConfirm(false);
    setIsDirty(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  const cancelDiscard = useCallback(() => {
    setShowConfirm(false);
    setPendingAction(null);
  }, []);

  return {
    isDirty,
    markDirty,
    markClean,
    guardAction,
    showConfirm,
    confirmDiscard,
    cancelDiscard,
  };
}
