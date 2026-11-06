import { useCallback, useEffect, useRef } from "react";
import { useConfirm } from "./confirmContext";
import { addDirtyDialog, removeDirtyDialog } from "../dialogState";

/**
 * 弹窗关闭守卫：有未保存输入时先确认。
 * 统一供 Dialog 的 onClose 与底部“取消 / 关闭”按钮使用，避免只拦截 Esc 而漏掉按钮。
 */
export function useDirtyClose(dirty: boolean, busy: boolean, onClose: () => void): () => void {
  const confirm = useConfirm();
  const token = useRef(Symbol("dirty-dialog"));
  const closing = useRef(false);
  const state = useRef({ dirty, busy, onClose });
  state.current = { dirty, busy, onClose };
  useEffect(() => {
    if (dirty) addDirtyDialog(token.current); else removeDirtyDialog(token.current);
    return () => removeDirtyDialog(token.current);
  }, [dirty]);
  return useCallback(() => {
    const current = state.current;
    if (current.busy || closing.current) return;
    if (!current.dirty) { current.onClose(); return; }
    closing.current = true;
    void confirm({
      title: "放弃未保存的修改？",
      body: "当前弹窗里有尚未保存的输入，关闭后会丢失。",
      confirmLabel: "放弃并关闭",
      danger: true,
    }).then((ok) => {
      closing.current = false;
      if (ok) current.onClose();
    }, () => { closing.current = false; });
  }, [confirm]);
}
