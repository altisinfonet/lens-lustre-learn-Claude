/**
 * Hook to manage confirm dialog state for destructive actions.
 * Usage:
 *   const { confirm, dialogProps } = useConfirmAction();
 *   <ConfirmDialog {...dialogProps} />
 *   onClick={() => confirm({ title: "Delete?", onConfirm: () => deleteItem(id) })}
 */
import { useState, useCallback } from "react";

interface ConfirmConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void | Promise<void>;
}

export function useConfirmAction() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ConfirmConfig>({
    title: "",
    onConfirm: () => {},
  });

  const confirm = useCallback((cfg: ConfirmConfig) => {
    setConfig(cfg);
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      await config.onConfirm();
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }, [config]);

  return {
    confirm,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      title: config.title,
      description: config.description,
      confirmLabel: config.confirmLabel || "Confirm",
      variant: config.variant || ("destructive" as const),
      onConfirm: handleConfirm,
      loading,
    },
  };
}
