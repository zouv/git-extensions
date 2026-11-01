// 收集 tauri build 产出的安装包到 dist/release/，并生成 SHA256SUMS.txt。
// 只收集当前 package.json 版本对应的产物，避免把历史版本一起带出去。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const bundleRoot = join(root, "src-tauri", "target", "release", "bundle");
const outDir = join(root, "dist", "release");
const versionToken = `_${version}_`;

const artifacts = [];
for (const sub of ["nsis", "msi"]) {
  const dir = join(bundleRoot, sub);
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    continue; // 该 bundle 类型未产出，跳过
  }
  for (const name of entries) {
    if (name.includes(versionToken) && /\.(exe|msi)$/i.test(name)) {
      artifacts.push(join(dir, name));
    }
  }
}

if (artifacts.length === 0) {
  console.error(`[ERROR] No ${version} installers found under ${bundleRoot}`);
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const sums = [];
for (const src of artifacts) {
  const name = basename(src);
  await copyFile(src, join(outDir, name));
  const hash = createHash("sha256").update(await readFile(src)).digest("hex");
  sums.push(`${hash} *${name}`);
  console.log(`[OK] ${name}`);
}

await writeFile(join(outDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(`[OK] ${sums.length} installer(s) copied to dist/release/`);
