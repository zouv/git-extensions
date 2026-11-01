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

async function createSnapshot() {
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

async function collect() {
  const version = await readVersion();
  const exeName = await readExeName();
  const installers = await selectFreshInstallers(version);

  // 重建产物目录，保证 dist/release 只包含本次构建结果。
  try {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot replace ${outDir}: close any running Git Extensions instance from dist/release, then retry. (${error.code || error.message})`,
    );
  }

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
  // 发布成功后刷新快照：同一批产物不会被重复 collect 当作「新包」再次发布。
  await writeFile(snapshotFile, `${JSON.stringify(await installerSnapshot(), null, 2)}\n`);
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
