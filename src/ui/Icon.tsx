import type { ReactNode } from "react";

export type IconName =
  | "branch" | "changes" | "check" | "chevron-down" | "close" | "compare"
  | "conflict" | "copy" | "external" | "fetch" | "file" | "folder"
  | "history" | "menu" | "more" | "panel" | "plus" | "pull" | "push"
  | "refresh" | "search" | "settings" | "stash" | "tag" | "warning";

const paths: Record<IconName, ReactNode> = {
  branch: <><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 6v12M8 16c6 0 2-7 8-7h0M18 9v2"/></>,
  changes: <><path d="M4 5h16M4 12h16M4 19h16"/><path d="m8 3-2 2 2 2m8 3-2 2 2 2m-8 3-2 2 2 2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  "chevron-down": <path d="m7 9 5 5 5-5"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  compare: <><path d="M7 4v16M17 4v16M3 8l4-4 4 4m2 8 4 4 4-4"/></>,
  conflict: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.01"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  external: <><path d="M14 4h6v6m0-6-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
  fetch: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 17v3h14v-3M5 3h14"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></>,
  folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
  history: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 5v4h4"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  pull: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14M7 3H5a2 2 0 0 0-2 2v3m14-5h2a2 2 0 0 1 2 2v3"/></>,
  push: <><path d="M12 15V3m-4 4 4-4 4 4"/><path d="M5 20h14M7 15H5a2 2 0 0 1-2-2v-3m14 5h2a2 2 0 0 0 2-2v-3"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .8-7L20 12"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6-.7-2h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z"/></>,
  stash: <><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
  tag: <><path d="M20 13 13 20 3 10V3h7z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  warning: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.01"/></>,
};

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
