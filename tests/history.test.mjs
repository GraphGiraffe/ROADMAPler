import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app/history.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const history = context.RoadmapHistory;

test('count rotation keeps the newest contiguous commands', () => {
  const undo = [], redo = [];
  for (let i = 0; i < 70; i++) history.record(undo, redo, String(i));
  assert.deepEqual(undo, Array.from({ length: 50 }, (_, i) => String(i + 20)));
  redo.push('abandoned branch');
  history.record(undo, redo, '70');
  assert.deepEqual(redo, []);
  assert.equal(undo[0], '21');
});

test('UTF-16 size budget and oversized snapshots never leave a gap', () => {
  const undo = [], redo = [];
  const entry = 'Ж'.repeat(400000);
  for (let i = 0; i < 5; i++) history.record(undo, redo, entry + i);
  assert.equal(undo.length, 2);
  assert.ok(history.bytes(undo) <= history.maxBytes);
  history.record(undo, redo, 'x'.repeat(history.maxBytes));
  assert.equal(undo.length, 0);
  history.record(undo, redo, 'after oversized snapshot');
  assert.deepEqual(undo, ['after oversized snapshot']);
});

test('transfer protects newest redo and respects a shared budget', () => {
  const undo = ['older undo', 'recent undo'], redo = ['redo'];
  history.trim(undo, redo, 'redo', 12);
  assert.deepEqual(undo, []);
  assert.deepEqual(redo, ['redo']);
  history.trim(undo, redo, 'undo', 0);
  assert.deepEqual(redo, []);
});

test('portable installer has identical history limits and behavior', () => {
  const portable = vm.createContext({});
  vm.runInContext(history.portableSource, portable);
  const undo = [], redo = [];
  for (let i = 0; i < 70; i++) portable.RoadmapHistory.record(undo, redo, String(i));
  assert.equal(portable.RoadmapHistory.maxBytes, history.maxBytes);
  assert.equal(undo.length, 50);
  assert.equal(undo[0], '20');
});
