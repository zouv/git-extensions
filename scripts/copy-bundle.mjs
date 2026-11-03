// 打包产物收集（对齐 sc-code 的 dist/release 布局）：
//   snapshot  构建前记录 bundle 内已有安装包，用于 collect 时识别本次新产物
//   collect   把本次新生成的 NSIS / MSI 安装包、unpack/ 便携目录与 unpack zip 发布到 dist/release/
// 只导出本次构建产生的安装包，避免把历史版本或缓存文件带出去。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = join(root, "src-tauri", "target", "release", "bundle");
const buildRoot = join(root, "src-tauri", "target", "release");
const outDir = join(root, "dist", "release");
const snapshotFile = join(root, ".runtime", "package-snapshot.json");
const bundledFormats = ["nsis", "msi"];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function readVersion() {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error(`Invalid product version: ${pkg.version}`);
  }
  return pkg.version;
}

async function readExeName() {
  const cargo = await readFile(join(root, "src-tauri", "Cargo.toml"), "utf8");
  const packageSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? "";
  const match = /^\s*name\s*=\s*"([^"]+)"/m.exec(packageSection);
  if (!match) throw new Error("Cannot read package name from src-tauri/Cargo.toml");
  const exe = join(buildRoot, `${match[1]}.exe`);
  try {
    await stat(exe);
  } catch {
    throw new Error(`Built executable not found: ${exe}`);
  }
  return exe;
}

// 安装包指纹：大小 + 修改时间 + 创建时间，用于判断是否本次新生成。
async function installerSnapshot() {
  const snapshot = {};
  for (const format of bundledFormats) {
    const dir = join(bundleRoot, format);
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/\.(exe|msi)$/i.test(name)) continue;
      const info = await stat(join(dir, name));
      snapshot[`${format}/${name}`] = `${info.size}:${info.mtimeMs}:${info.birthtimeMs}`;
    }
  }
  return snapshot;
}

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(snapshotFile, "utf8"));
  } catch {
    return undefined;
  }
}

const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * 列出可执行文件位于指定目录下的运行中进程（Windows）。
 * 最常见的情况是从 dist/release/unpack 启动的便携版锁住了发布目录。
 * 无法查询时返回空数组，后续重命名仍会给出明确的失败信息。
 */
function findProcessesUnder(roots) {
  if (process.platform !== "win32" || roots.length === 0) return [];
  const script = [
    `$roots = @(${roots.map(psQuote).join(",")})`,
    "$result = Get-CimInstance Win32_Process | ForEach-Object {",
    "  $path = $_.ExecutablePath",
    "  if (-not $path) { return }",
    "  foreach ($root in $roots) {",
    "    if ($path -ieq $root -or $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {",
    "      [pscustomobject]@{ ProcessId = $_.ProcessId; Name = $_.Name; ExecutablePath = $path }",
    "      break",
    "    }",
    "  }",
    "}",
    "if ($result) { $result | ConvertTo-Json -Compress }",
  ].join("\n");
  try {
    const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** 打包 / 发布前检查目标目录是否被运行中的进程占用；交互确认后强制关闭。 */
async function ensurePathsUnlocked(roots, purpose) {
  const processes = findProcessesUnder(roots);
  if (processes.length === 0) return;

  console.warn("[WARN] 以下运行中的进程占用了打包目标目录：");
  for (const item of processes) {
    console.warn(`  PID ${String(item.ProcessId).padEnd(6)} ${item.Name}  ${item.ExecutablePath}`);
  }
  console.warn("强制关闭会丢失这些实例中未保存的界面草稿。");

  if (process.env.GIT_EXTENSIONS_FORCE_CLOSE !== "1") {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      throw new Error(
        "无法交互确认是否强制关闭。请先关闭上述进程后重试；" +
          "或在确认可强制关闭时设置 GIT_EXTENSIONS_FORCE_CLOSE=1。",
      );
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer = "";
    try {
      answer = await rl.question(`是否强制关闭这些进程并继续${purpose}？[y/N] `);
    } finally {
      rl.close();
    }
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error("已取消：请先关闭占用打包目标的进程后重试。");
    }
  }

  let closed = 0;
  for (const item of processes) {
    try {
      execFileSync("taskkill", ["/PID", String(item.ProcessId), "/T", "/F"], { stdio: "ignore" });
      closed += 1;
    } catch {
      // 进程可能已退出或需要更高权限；下方复查会给出结果。
    }
  }
  await sleep(800);
  const remaining = findProcessesUnder(roots);
  if (remaining.length > 0) {
    throw new Error(
      `仍有 ${remaining.length} 个进程未能关闭（可能需要管理员权限）：` +
        remaining.map((item) => `${item.Name}(${item.ProcessId})`).join("、"),
    );
  }
  console.log(`[OK] 已关闭 ${closed} 个占用进程，继续${purpose}`);
}

async function createSnapshot() {
  await ensurePathsUnlocked([outDir, buildRoot], "打包");
  await mkdir(dirname(snapshotFile), { recursive: true });
  const snapshot = await installerSnapshot();
  await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[OK] Recorded ${Object.keys(snapshot).length} existing installer(s) before build`);
}

async function selectFreshInstallers(version) {
  const before = await readSnapshot();
  const current = await installerSnapshot();
  const candidates = Object.keys(current).filter(
    (key) => key.includes(`_${version}_`) && (!before || before[key] !== current[key]),
  );
  if (candidates.length === 0) {
    throw new Error(
      `No new ${version} installer found under ${bundleRoot}. ` +
        "Run package.bat (snapshot -> tauri build -> collect); stale packages are not exported.",
    );
  }
  return candidates.map((key) => {
    const [format, name] = key.split("/");
    return { source: join(bundleRoot, format, name), name };
  });
}

async function copyAtomic(source, destination) {
  const partial = `${destination}.partial-${process.pid}`;
  await copyFile(source, partial);
  await rename(partial, destination);
}

async function writeUnpack(version, exeName) {
  const unpackDir = join(outDir, "unpack");
  await mkdir(unpackDir, { recursive: true });

  const exeOutput = join(unpackDir, basename(exeName));
  await copyAtomic(exeName, exeOutput);

  const readme = [
    "Git Extensions (Windows x64) - unpacked distribution",
    "",
    "Double-click the exe to run. No installation is required.",
    "Microsoft Edge WebView2 Runtime must already be installed on this computer.",
    "Move or copy the WHOLE folder; do not move the exe by itself.",
    "",
    "This is an unsigned local build. It installs nothing and contacts no external service.",
  ].join("\r\n");
  await writeFile(join(unpackDir, "README.txt"), `${readme}\r\n`);

  const files = [];
  for (const name of (await readdir(unpackDir)).sort()) {
    const file = join(unpackDir, name);
    const info = await stat(file);
    if (!info.isFile()) continue;
    files.push({
      path: name.replaceAll("\\", "/"),
      size: info.size,
      sha256: sha256(await readFile(file)),
    });
  }
  await writeFile(
    join(unpackDir, "unpack-manifest.json"),
    `${JSON.stringify({
      format: 1,
      product: "Git Extensions",
      version,
      mode: "Release",
      platform: "win32-x64",
      createdAt: new Date().toISOString(),
      files,
    }, null, 2)}\n`,
  );

  const zipName = `Git.Extensions_${version}_x64-unpack.zip`;
  const zipPath = join(outDir, zipName);
  const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
      `Compress-Archive -Path (Join-Path ${psQuote(unpackDir)} '*') -DestinationPath ${psQuote(zipPath)} -Force`,
  ]);
  return { unpackDir, zipPath, zipName };
}

async function verifyZip(zipPath, expectedFiles) {
  const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
  const output = execFileSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[IO.Compression.ZipFile]::OpenRead(${psQuote(zipPath)}).Entries | ForEach-Object { $_.FullName } | Sort-Object`,
  ], { encoding: "utf8" });
  const archived = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();
  const expected = [...expectedFiles].sort();
  if (JSON.stringify(archived) !== JSON.stringify(expected)) {
    throw new Error(`Unpack archive entry mismatch: ${zipPath}`);
  }
}

async function listUnpackFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const name of entries) {
    const info = await stat(join(dir, name));
    if (info.isFile()) files.push(name);
  }
  return files.sort();
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collect() {
  await ensurePathsUnlocked([outDir], "发布打包产物");
  const version = await readVersion();
  const exeName = await readExeName();
  const installers = await selectFreshInstallers(version);

  // 不直接删除 dist/release：先整体重命名隔离，避免正在运行的 unpack\exe 锁住删除，
  // 也避免删除一半后失败导致发布目录残缺。发布成功后旧目录尽力删除，仍被占用则保留并警告。
  const quarantine = `${outDir}.old-${process.pid}`;
  try {
    for (const name of await readdir(dirname(outDir))) {
      if (!name.startsWith("release.old-")) continue;
      try { await rm(join(dirname(outDir), name), { recursive: true, force: true }); } catch { /* 仍在运行，下次再清 */ }
    }
    if (await pathExists(quarantine)) await rm(quarantine, { recursive: true, force: true });
    if (await pathExists(outDir)) await rename(outDir, quarantine);
  } catch (error) {
    throw new Error(
      `无法替换 ${outDir}：请先关闭从该目录运行的 Git Extensions 实例；` +
        `若已关闭，请检查是否有终端 / 资源管理器停留在该目录，或稍后重试（杀毒软件可能短暂占用文件和目录）。` +
        `(${error.code || error.message})`,
    );
  }

  try {
    await mkdir(outDir, { recursive: true });

    for (const { source, name } of installers) {
      await copyAtomic(source, join(outDir, name));
      console.log(`[PACKAGE] ${name}`);
    }

    const { unpackDir, zipPath, zipName } = await writeUnpack(version, exeName);
    const unpackFiles = await listUnpackFiles(unpackDir);
    await verifyZip(zipPath, unpackFiles);
    console.log(`[UNPACK] ${relative(root, unpackDir)}`);
    console.log(`[ARCHIVE] ${zipName}`);

    const checksumLines = [];
    for (const name of [...installers.map((item) => item.name), zipName].sort()) {
      const file = join(outDir, name);
      const info = await stat(file);
      if (!info.isFile() || info.size === 0) throw new Error(`Missing finished package: ${name}`);
      checksumLines.push(`${sha256(await readFile(file))} *${name}`);
    }
    await writeFile(join(outDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`);
  } catch (error) {
    // 发布失败：丢弃半成品并恢复上一版发布目录。
    try { await rm(outDir, { recursive: true, force: true }); } catch { /* 半成品可能被占用，保留隔离目录 */ }
    if (await pathExists(quarantine)) {
      try { await rename(quarantine, outDir); } catch { /* 旧目录仍被占用，保留原样 */ }
    }
    throw error;
  }

  // 发布成功后刷新快照：同一批产物不会被重复 collect 当作「新包」再次发布。
  await writeFile(snapshotFile, `${JSON.stringify(await installerSnapshot(), null, 2)}\n`);
  if (await pathExists(quarantine)) {
    try {
      await rm(quarantine, { recursive: true, force: true });
    } catch {
      console.warn(`[WARN] Previous dist/release is still in use; left at ${basename(quarantine)}`);
    }
  }
  console.log(`[OK] ${installers.length} installer(s) + unpack + zip published to dist/release/`);
}

async function main() {
  const action = process.argv[2];
  if (action === "snapshot") return createSnapshot();
  if (action === "collect") return collect();
  throw new Error("Usage: node scripts/copy-bundle.mjs <snapshot|collect>");
}

await main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});
