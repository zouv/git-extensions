import type { ExplorerAction, LaunchRequest, WorkspaceLaunchAction, WorkspaceLaunchRequest } from "./types";

export function workspaceAction(action: ExplorerAction): WorkspaceLaunchAction | null {
  return action === "clone" || action === "create-repository" || action === "open-repository" || action === "settings" ? null : action;
}

export function workspaceLaunch(request: LaunchRequest, repoPath: string, id: number): (WorkspaceLaunchRequest & { path: string }) | null {
  if (!request.path) return null;
  const action = workspaceAction(request.action);
  return action ? { id, path: repoPath, action } : null;
}
