import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app/project-format.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const contract = context.RoadmapProjectFormat;
const fixtures = JSON.parse(await readFile(new URL('./fixtures/project-format.json', import.meta.url), 'utf8'));

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const input = structuredClone(fixture.data);
    const before = structuredClone(input);
    if (fixture.valid) assert.equal(contract.validateProject(input), input);
    else assert.throws(() => contract.validateProject(input));
    assert.deepEqual(input, before, 'validation must never modify input');
  });
}

test('portable installer preserves the same validation contract', () => {
  const portable = vm.createContext({});
  vm.runInContext(contract.portableSource, portable);
  for (const fixture of fixtures) {
    if (fixture.valid) assert.doesNotThrow(() => portable.RoadmapProjectFormat.validateProject(fixture.data));
    else assert.throws(() => portable.RoadmapProjectFormat.validateProject(fixture.data));
  }
});
