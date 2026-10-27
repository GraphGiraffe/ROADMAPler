import { cp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Resolve against this script so the output never depends on the working directory.
const source = new URL('../public/', import.meta.url);
const output = new URL('../site/', import.meta.url);

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
console.log(`RoadMap built: public/ → site/, revision ${revision}`);
