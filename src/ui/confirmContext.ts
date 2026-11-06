import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireAck?: boolean;
  ackLabel?: string;
}

export const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false),
);

export function useConfirm() {
  return useContext(ConfirmContext);
}
