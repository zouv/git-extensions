import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import type { Command } from "../commands";
import { useCommands } from "../commands";

function matches(command: Command, query: string): boolean {
  if (!query) return true;
  const haystack = [command.title, command.group, command.shortcut ?? "", ...(command.keywords ?? [])]
    .join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

const GROUP_ORDER = ["应用", "切换仓库", "当前仓库", "视图", "Git 操作"];

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => commands
    .filter((command) => command.enabled !== false && matches(command, query.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      const left = GROUP_ORDER.indexOf(a.group);
      const right = GROUP_ORDER.indexOf(b.group);
      return (left < 0 ? GROUP_ORDER.length : left) - (right < 0 ? GROUP_ORDER.length : right);
    }), [commands, query]);

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${selected}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (command: Command | undefined) => {
    if (!command || command.enabled === false) return;
    onClose();
    command.run();
  };

  const keydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => filtered.length === 0 ? 0 : (value + 1) % filtered.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => filtered.length === 0 ? 0 : (value - 1 + filtered.length) % filtered.length); }
    else if (event.key === "Home") { event.preventDefault(); setSelected(0); }
    else if (event.key === "End") { event.preventDefault(); setSelected(Math.max(0, filtered.length - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); run(filtered[selected]); }
  };

  let lastGroup = "";
  return (
    <Dialog title="命令面板" onClose={onClose} className="command-palette-dialog" footer={<div className="panel-hint command-palette-hint">↑/↓ 选择 · Enter 执行 · Esc 关闭</div>}>
      <div className="command-palette-search">
        <Icon name="search" />
        <input
          data-autofocus
          aria-label="搜索命令"
          placeholder="输入命令名称，例如：刷新、对比、Stash、设置…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keydown}
        />
      </div>
      <div className="command-palette-list" role="listbox" aria-label="可用命令" ref={listRef}>
        {filtered.map((command, index) => {
          const showGroup = command.group !== lastGroup;
          lastGroup = command.group;
          return (
            <div key={command.id}>
              {showGroup && <div className="command-group-label">{command.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                data-command-index={index}
                className={`command-item${index === selected ? " selected" : ""}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(command)}
              >
                <span className="command-title">{command.title}</span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="panel-hint">没有匹配的命令</div>}
      </div>
    </Dialog>
  );
}
