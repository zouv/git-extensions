import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import Dialog from "./Dialog";

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireAck?: boolean;
  ackLabel?: string;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [ack, setAck] = useState(false);
  const resolver = useRef<(value: boolean) => void>(() => undefined);
  const confirm = useCallback((next: ConfirmOptions) => {
    setAck(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  const close = useCallback((value: boolean) => {
    resolver.current(value);
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Dialog title={options.title} onClose={() => close(false)} footer={<>
          <button onClick={() => close(false)}>取消</button>
          <button data-autofocus className={options.danger ? "danger-button" : "primary"} disabled={options.requireAck && !ack} onClick={() => close(true)}>{options.confirmLabel ?? "确定"}</button>
        </>}>
          <div className="confirm-body">{options.body}</div>
          {options.requireAck && <label className="ack-row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{options.ackLabel ?? "我理解此操作的影响"}</label>}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
