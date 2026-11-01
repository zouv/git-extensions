// 所有写 API 共享一个同步发布的仓库状态；不依赖组件是否挂载。
const active = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

export function getRepoOperation(path: string): string | null {
  return active.get(path) ?? null;
}

export function subscribeRepoOperation(path: string, listener: () => void): () => void {
  let entries = listeners.get(path);
  if (!entries) { entries = new Set(); listeners.set(path, entries); }
  entries.add(listener);
  return () => {
    entries.delete(listener);
    if (entries.size === 0 && listeners.get(path) === entries) listeners.delete(path);
  };
}

function publish(path: string) {
  for (const listener of listeners.get(path) ?? []) listener();
}

/** 不排队旧意图；即使 React 尚未重渲染，第二次写操作也会被拒绝。 */
export async function runRepoWrite<T>(path: string, operation: string, action: () => Promise<T>): Promise<T> {
  if (active.has(path)) throw new Error("该仓库正在执行写操作，请等待完成后重试");
  active.set(path, operation);
  try {
    publish(path);
    return await action();
  } finally {
    active.delete(path);
    publish(path);
  }
}
