import { cp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Resolve against this script so the output never depends on the working directory.
const source = new URL('../public/', import.meta.url);
const output = new URL('../site/', import.meta.url);

// Reject accidentally pasted privileged credentials before publishing the public config.
const configSource = await readFile(new URL('cloud/config.js', source), 'utf8');
const config = JSON.parse(configSource.match(/window\.ROADMAP_CLOUD\s*=\s*(\{[^;]*\})\s*;/)?.[1] || '{}');
if (!!config.supabaseUrl !== !!config.supabaseKey) throw Error('Set both public Supabase URL and key.');
if (config.supabaseUrl && new URL(config.supabaseUrl).protocol !== 'https:') throw Error('Supabase URL must use HTTPS.');
if (config.supabaseKey) {
  let anon = false;
  try { anon = JSON.parse(Buffer.from(config.supabaseKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
  if (!config.supabaseKey.startsWith('sb_publishable_') && !anon) throw Error('Use a public Supabase publishable/anon key, never a secret/service_role key.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
async function hashDirectory(directory, hash) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    hash.update(entry.name);
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await hashDirectory(file, hash);
    else hash.update(await readFile(file));
  }
}
const hash = createHash('sha256');
await hashDirectory(source, hash);
const revision = hash.digest('hex').slice(0, 16);
const worker = new URL('sw.js', output);
await writeFile(worker, (await readFile(worker, 'utf8')).replace('__BUILD_REVISION__', revision));
await writeFile(new URL('.nojekyll', output), '');
console.log(`ROADMAPler built: public/ → site/, revision ${revision}`);
