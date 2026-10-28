/* Bounded snapshot history shared by web, PWA and portable HTML. */
(function installHistory() {
  'use strict';
  const maxEntries = 50, maxBytes = 2 * 1024 * 1024;
  const bytes = entries => entries.reduce((size, entry) => size + entry.length * 2, 0);

  // Keep a contiguous suffix: dropping a middle snapshot would skip a command.
  // Budget counts UTF-16 payload bytes, not the JavaScript engine's heap overhead.
  function trim(undo, redo, preferred = 'undo', budget = maxBytes) {
    const first = preferred === 'redo' ? undo : redo;
    const second = preferred === 'redo' ? redo : undo;
    let size = bytes(undo) + bytes(redo);
    while (undo.length + redo.length > maxEntries || size > budget) {
      const stack = first.length ? first : second;
      if (!stack.length) break;
      size -= stack.shift().length * 2;
    }
    return size;
  }
  function record(undo, redo, entry) {
    undo.push(entry);
    redo.length = 0;
    trim(undo, redo);
  }
  const api = { maxEntries, maxBytes, bytes, trim, record };
  Object.defineProperty(api, 'portableSource', { get: () => '(' + installHistory.toString() + ')();' });
  globalThis.RoadmapHistory = Object.freeze(api);
})();
