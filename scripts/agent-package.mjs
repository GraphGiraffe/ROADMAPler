// Reproducible ZIP with stored entries, built using Node only (no runtime/npm/zip dependency).
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const chunks = [], directory = []; let offset = 0, size = 0;
  for (const [path, data] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const name = Buffer.from(path), crc = crc32(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0x81a40000, 38); central.writeUInt32LE(offset, 42);
    chunks.push(local, name, data); directory.push(central, name); offset += local.length + name.length + data.length; size += central.length + name.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}
export async function buildAgentPackage(output) {
  const files = new Map();
  // Explicit publish allowlist: never package files merely because they exist locally.
  const sourceFiles = ['plugin.json', 'mcp.json', 'README.md', 'server/mcp.mjs', 'server/tools.mjs',
    'skills/roadmap-connect/SKILL.md', 'skills/roadmap-plan/SKILL.md', 'skills/roadmap-maintain/SKILL.md'];
  for (const path of sourceFiles) {
    const url = new URL('agent-plugin/' + path, root);
    if (!(await lstat(url)).isFile()) throw Error('Invalid agent package source: ' + path);
    files.set(path, await readFile(url));
  }
  const manifest = JSON.parse(files.get('plugin.json')), mcp = JSON.parse(files.get('mcp.json'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.name !== 'roadmapler') throw Error('Invalid agent package identity');
  files.set('server/integration-client.mjs', await readFile(new URL('scripts/integration-client.mjs', root)));
  files.set('.codex-plugin/plugin.json', json({ name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, interface: manifest.extensions['com.openai'].interface, skills: './skills', mcpServers: './.mcp.json' }));
  files.set('.mcp.json', json({ mcpServers: mcp.mcpServers }));
  for (const name of ['LICENSE', 'NOTICE', 'LICENSES/PolyForm-Noncommercial-1.0.0.md', 'LICENSES/CC-BY-NC-SA-4.0.txt', 'LICENSES/MIT-legacy.txt']) {
    if (!(await lstat(new URL(name, root))).isFile()) throw Error('Invalid license file');
    files.set(name, await readFile(new URL(name, root)));
  }
  const archive = zip(files), digest = createHash('sha256').update(archive).digest('hex'), archiveName = 'roadmapler-agent-' + manifest.version + '-' + digest.slice(0,12) + '.zip';
  const descriptor = { schemaVersion: 1, name: manifest.name, version: manifest.version, compatibility: { node: '>=22', plugin: 'Agent Plugins 1.0; Codex compatibility manifest', transport: 'MCP stdio', protocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] }, archive: { url: archiveName, bytes: archive.length, sha256: digest }, skills: 3, tools: 18, credentialsIncluded: false };
  await mkdir(output, { recursive: true });
  await writeFile(new URL(archiveName, output), archive);
  await writeFile(new URL('manifest.json', output), json(descriptor));
  await writeFile(new URL('README.txt', output), files.get('README.md'));
  return { descriptor, files };
}
