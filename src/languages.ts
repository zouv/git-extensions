/** 按文件扩展名映射 highlight.js 语言（worker 里已注册的语言）。 */
const EXT_MAP: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  json: "json", jsonc: "json",
  html: "xml", htm: "xml", xml: "xml", xaml: "xml", svg: "xml", csproj: "xml", sln: "ini",
  css: "css", scss: "css", less: "css",
  cs: "csharp",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", h: "c", c: "c",
  py: "python", pyw: "python",
  rs: "rust",
  java: "java",
  go: "go",
  yml: "yaml", yaml: "yaml",
  md: "markdown", markdown: "markdown",
  sql: "sql",
  sh: "shell", bash: "shell",
  ps1: "powershell", psm1: "powershell",
  ini: "ini", toml: "ini", cfg: "ini", editorconfig: "ini", gitignore: "ini",
};

export function languageForPath(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : name.toLowerCase();
  return EXT_MAP[ext] ?? null;
}
