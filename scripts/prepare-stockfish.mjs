/**
 * Download official, pinned Stockfish 19 Windows x86-64 universal zip.
 * No non-official mirrors and no redistributable binaries stored in git.
 */
import {
  createWriteStream, existsSync, mkdirSync, mkdtempSync,
  readdirSync, copyFileSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const target = resolve('src-tauri/resources');
const exe = join(target, 'stockfish.exe');
const licensePath = join(target, 'LICENSE.Stockfish.txt');
const sf19 = 'https://api.github.com/repos/official-stockfish/Stockfish/releases/tags/sf_19';
const expected = 'stockfish-windows-x86-64-universal.zip';

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Chess-XRay-build/0.1.0' } });
  if (!response.ok) throw new Error('Download failed: HTTP ' + response.status + ' ' + url);
  return response;
}
function locateExe(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = locateExe(full);
      if (found) return found;
    } else if (entry.isFile() && /^stockfish.*\.exe$/i.test(entry.name)) {
      return full;
    }
  }
  return null;
}
if (process.platform !== 'win32') {
  console.log('Bundled Stockfish targets Windows; resource download skipped.');
  process.exit(0);
}
mkdirSync(target, { recursive: true });
if (existsSync(exe) && existsSync(licensePath)) {
  console.log('Official Stockfish 19 universal binary is cached.');
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), 'chess-xray-stockfish-'));
try {
  const json = await (await get(sf19)).json();
  const asset = json.assets.find(x => x.name === expected);
  if (!asset) throw new Error('Official universal x86-64 binary missing from sf_19 release.');
  const archive = join(temp, 'stockfish.zip');
  const response = await get(asset.browser_download_url);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const unpack = join(temp, 'unpack');
  mkdirSync(unpack);
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const cmd = 'Expand-Archive -LiteralPath ' + quote(archive) +
    ' -DestinationPath ' + quote(unpack) + ' -Force';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('PowerShell Expand-Archive failed.');
  const source = locateExe(unpack);
  if (!source) throw new Error('No Stockfish executable in official sf_19 archive.');
  copyFileSync(source, exe);
  const license = await (await get('https://raw.githubusercontent.com/official-stockfish/Stockfish/sf_19/Copying.txt')).text();
  writeFileSync(licensePath, license);
  console.log('Stockfish 19 universal executable & GPL-3.0 copying notice bundled.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
