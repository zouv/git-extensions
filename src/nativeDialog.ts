import { open } from "@tauri-apps/plugin-dialog";

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
