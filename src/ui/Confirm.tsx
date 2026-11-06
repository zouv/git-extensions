import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import Dialog from "./Dialog";
import { ConfirmContext } from "./confirmContext";
import type { ConfirmOptions } from "./confirmContext";

export type { ConfirmOptions } from "./confirmContext";
export { useConfirm } from "./confirmContext";

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

  // 危险操作默认聚焦“取消”；需要勾选确认时聚焦勾选框，避免误按回车执行。
  const autofocus = options?.requireAck ? "ack" : options?.danger ? "cancel" : "confirm";
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Dialog title={options.title} onClose={() => close(false)} footer={<>
          <button data-autofocus={autofocus === "cancel" ? "" : undefined} onClick={() => close(false)}>取消</button>
          <button data-autofocus={autofocus === "confirm" ? "" : undefined} className={options.danger ? "danger-button" : "primary"} disabled={options.requireAck && !ack} onClick={() => close(true)}>{options.confirmLabel ?? "确定"}</button>
        </>}>
          <div className="confirm-body">{options.body}</div>
          {options.requireAck && <label className="ack-row"><input data-autofocus={autofocus === "ack" ? "" : undefined} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{options.ackLabel ?? "我理解此操作的影响"}</label>}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}
