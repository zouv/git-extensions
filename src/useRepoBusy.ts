import { useCallback, useSyncExternalStore } from "react";
import { getRepoOperation, subscribeRepoOperation } from "./repoOperations";

export function useRepoBusy(path: string): boolean {
  const subscribe = useCallback((listener: () => void) => subscribeRepoOperation(path, listener), [path]);
  const snapshot = useCallback(() => getRepoOperation(path), [path]);
  return useSyncExternalStore(subscribe, snapshot, snapshot) !== null;
}
