import { open, save } from "@tauri-apps/plugin-dialog";

/** 原生目录选择；用户取消时返回 null。 */
export async function pickDirectory(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

/** 原生文件选择，用于补丁等单文件输入。 */
export async function pickFile(title: string): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: "Patch", extensions: ["patch", "diff"] }, { name: "All files", extensions: ["*"] }],
  });
  return typeof result === "string" ? result : null;
}

/** 原生文件保存对话框，用于导出补丁或归档。 */
export async function pickSaveFile(
  title: string,
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const result = await save({
    title,
    defaultPath,
    filters: filters ?? [{ name: "All files", extensions: ["*"] }],
  });
  return typeof result === "string" ? result : null;
}

