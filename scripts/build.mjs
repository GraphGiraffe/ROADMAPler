import { cp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentPackage } from './agent-package.mjs';

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
await cp(source, output, { recursive: true, filter: path => !['source','styles'].includes(relative(fileURLToPath(source),path).split(sep)[0]) });
// Both theme variants share the same installation identity and relative URLs.
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', source), 'utf8'));
await writeFile(new URL('manifest-dark.webmanifest', output), JSON.stringify({...manifest, background_color:'#1c2922', theme_color:'#1c2922'}, null, 2)+'\n');
// Compose one classic script to preserve existing command/history semantics and portable HTML.
const composition = JSON.parse(await readFile(new URL('source/manifest.json', source), 'utf8'));
const loadParts = async (names, directory) => {
  if (!Array.isArray(names) || !names.length || names.some(name => !/^[a-z-]+\.(js|css)$/.test(name))) throw Error('Invalid application composition');
  return (await Promise.all(names.map(name => readFile(new URL(directory + '/' + name, source), 'utf8')))).join('\n');
};
const appCode = await loadParts(composition.scripts, 'source'), appStyle = await loadParts(composition.styles, 'styles');
const template = await readFile(new URL('index.html', source), 'utf8');
for (const marker of ['/*__ROADMAP_APP__*/','/*__ROADMAP_STYLE__*/']) if (template.split(marker).length !== 2) throw Error('Invalid application template');
await writeFile(new URL('index.html', output), template.replace('/*__ROADMAP_APP__*/', () => appCode).replace('/*__ROADMAP_STYLE__*/', () => appStyle));
async function hashDirectory(directory, hash) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    hash.update(entry.name);
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await hashDirectory(file, hash);
    else hash.update(await readFile(file));
  }
}
await buildAgentPackage(new URL('api/agent-plugin/', output));
const hash = createHash('sha256');
await hashDirectory(output, hash);
const revision = hash.digest('hex').slice(0, 16);
const worker = new URL('sw.js', output);
await writeFile(worker, (await readFile(worker, 'utf8')).replace('__BUILD_REVISION__', revision));
await writeFile(new URL('.nojekyll', output), '');
console.log(`ROADMAPler built: public/ → site/, revision ${revision}`);
