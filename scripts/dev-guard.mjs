#!/usr/bin/env node
// Close running dev/release app processes that live inside this repository (Windows).
// dev.bat calls this before starting: the rebuild cannot replace a locked exe.
// Installed releases elsewhere are left alone (dev uses a separate identifier).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readAppIdentity() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const product = typeof config.productName === 'string' ? config.productName : '';
  const configured = typeof config.mainBinaryName === 'string' ? config.mainBinaryName : '';
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const packageSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? '';
  const bin = /^\s*name\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1] ?? '';
  const names = [configured, bin, product]
    .filter(Boolean)
    .map((name) => `${name.replace(/\.exe$/i, '')}.exe`.toLowerCase());
  if (names.length === 0) throw new Error('Cannot determine the app executable name');
  return { label: product || bin, names: [...new Set(names)] };
}

const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;

/** Processes whose image matches this app and lives under the repository. */
function findAppProcesses(identity) {
  if (process.platform !== 'win32') return [];
  const script = [
    `$names = @(${identity.names.map(psQuote).join(',')})`,
    `$root = ${psQuote(`${root}${path.sep}`)}`,
    '$result = Get-CimInstance Win32_Process | Where-Object {',
    '  if (-not $_.Name -or -not $_.ExecutablePath) { return $false }',
    '  if (-not ($names -contains $_.Name.ToLowerInvariant())) { return $false }',
    '  $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)',
    '} | ForEach-Object {',
    '  [pscustomobject]@{ ProcessId = $_.ProcessId; Name = $_.Name; ExecutablePath = $_.ExecutablePath }',
    '}',
    'if ($result) { $result | ConvertTo-Json -Compress }',
  ].join('\n');
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function main() {
  const identity = readAppIdentity();
  const processes = findAppProcesses(identity);
  if (processes.length === 0) return;

  console.warn(`[warn] ${identity.label} is running from this repository:`);
  for (const item of processes) {
    console.warn(`       PID ${String(item.ProcessId).padEnd(6)} ${item.Name}  ${item.ExecutablePath}`);
  }
  console.warn('[warn] Force-closing discards any unsaved state in the running app.');
  console.warn('       Only processes whose executable is inside this repository are touched.');

  for (const item of processes) {
    try {
      execFileSync('taskkill', ['/PID', String(item.ProcessId), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The process may have exited already; the re-check below reports the result.
    }
  }
  sleep(800);
  const remaining = findAppProcesses(identity);
  if (remaining.length > 0) {
    const details = remaining.map((item) => `${item.Name}(${item.ProcessId})`).join(', ');
    throw new Error(`Could not close the running app (${details}); close it manually and retry.`);
  }
  console.log('[ ok ] Closed the running app instance(s); continuing.');
}

try {
  main();
} catch (error) {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
}
