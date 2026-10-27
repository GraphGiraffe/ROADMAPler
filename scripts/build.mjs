import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

// Resolve against this script so the output never depends on the working directory.
const source = new URL('../public/', import.meta.url);
const output = new URL('../site/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await writeFile(new URL('.nojekyll', output), '');
console.log('RoadMap built: public/ → site/');
