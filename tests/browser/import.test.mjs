import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = JSON.parse(await readFile(new URL('../fixtures/project-format.json', import.meta.url), 'utf8'));
let server, browser, origin;
const contexts = new Set();

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/ROADMAPler\//, '') || 'index.html';
      const path = resolve(root, 'site', relative);
      if (!path.startsWith(resolve(root, 'site') + '/')) throw Error('Invalid path');
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
      response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}/ROADMAPler/`;
  const executable = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
});

after(async () => {
  for (const context of contexts) await context.close();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function device(serviceWorkers = 'block') {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers });
  contexts.add(context);
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.roadmapApp && window.roadmapCloud);
  return { context, page };
}
async function vault(page) { return page.evaluate(() => window.roadmapApp.getVault()); }
async function imported(page, data) {
  await page.locator('#projectFile').setInputFiles({ name: 'project.roadmap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}
async function fixture(page, inactive = false) {
  return page.evaluate(({ data, inactive }) => {
    const next = window.roadmapApp.getVault();
    next.projects[0].data = data;
    next.projects[0].cloud = { enabled: true, provider: 'supabase', owner: 'fixture-owner', id: '11111111-1111-4111-8111-111111111111', revision: 7, base: structuredClone(data) };
    next.projects[0].customLibraryField = { keep: true };
    if (inactive) {
      const other = window.roadmapApp.emptyProject();
      other.data.project.name = 'Другой проект';
      next.projects.push(other);
      next.active = other.id;
    }
    window.roadmapApp.saveVault(next);
    return window.roadmapApp.getVault();
  }, { data: fixtures.find(f => f.name === 'unknown-fields-preserved').data, inactive });
}

for (const inactive of [false, true]) {
  test(`import keeps cloud binding and metadata (${inactive ? 'inactive' : 'active'})`, async () => {
    const { page } = await device();
    const before = await fixture(page, inactive);
    const target = before.projects[0];
    const input = structuredClone(target.data);
    input.project.description = 'Imported update';
    await imported(page, input);
    await page.locator('#importDialog').waitFor({ state: 'visible' });
    await page.locator('#updateImported').click();
    await page.locator('#importDialog').waitFor({ state: 'hidden' });
    let current = await vault(page);
    let updated = current.projects.find(p => p.id === target.id);
    assert.deepEqual(updated.cloud, target.cloud);
    assert.deepEqual(updated.customLibraryField, target.customLibraryField);
    assert.equal(updated.data.project.description, 'Imported update');
    assert.deepEqual(updated.data.tasks, target.data.tasks);
    assert.deepEqual(current.cloudDeletions || [], []);
    assert.deepEqual(current.projects.filter(p => p.id !== target.id), before.projects.filter(p => p.id !== target.id));
    await page.locator('#undo').click();
    current = await vault(page);
    assert.deepEqual(current.projects.find(p => p.id === target.id), target);
    await page.locator('#redo').click();
    assert.deepEqual((await vault(page)).projects.find(p => p.id === target.id).cloud, target.cloud);
    await page.reload();
    await page.waitForFunction(() => window.roadmapApp);
    updated = (await vault(page)).projects.find(p => p.id === target.id);
    assert.equal(updated.data.project.description, 'Imported update');
    assert.deepEqual(updated.cloud, target.cloud);
  });
}

test('all invalid contract fixtures are rejected before changing the vault', async () => {
  const { page } = await device();
  const before = await vault(page);
  for (const item of fixtures.filter(f => !f.valid)) {
    await imported(page, item.data);
    await page.waitForFunction(() => document.getElementById('projectFile').value === '');
    assert.equal(await page.locator('#importDialog').isVisible(), false, item.name);
    assert.deepEqual(await vault(page), before, item.name);
  }
});

test('cancel and storage failure leave the cloud project and history unchanged', async () => {
  const { page } = await device();
  const before = await fixture(page);
  const input = structuredClone(before.projects[0].data);
  input.project.description = 'Not committed';
  await imported(page, input);
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  await page.locator('#cancelImport').click();
  assert.deepEqual(await vault(page), before);
  await imported(page, input);
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  const history = await page.evaluate(() => JSON.stringify({ undo: undoStack, redo: redoStack }));
  await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw Error('Storage test failure'); }; });
  await page.locator('#updateImported').click();
  assert.match(await page.locator('#importError').textContent(), /Storage test failure/);
  assert.deepEqual(await vault(page), before);
  assert.equal(await page.evaluate(() => JSON.stringify({ undo: undoStack, redo: redoStack })), history);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
});

test('create imported copy stays local and retains the existing cloud project', async () => {
  const { page } = await device();
  const before = await fixture(page);
  await imported(page, before.projects[0].data);
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  await page.locator('#createImported').click();
  const after = await vault(page);
  assert.equal(after.projects.length, 2);
  assert.deepEqual(after.projects.find(p => p.id === before.projects[0].id), before.projects[0]);
  assert.equal(after.projects.find(p => p.id === after.active).cloud, undefined);
});

test('portable HTML includes the shared validator and preserves data offline', async () => {
  const { context, page } = await device();
  const before = await fixture(page);
  const expected = before.projects[0].data;
  const pending = page.waitForEvent('download');
  await page.evaluate(() => document.getElementById('save').click());
  const download = await pending;
  const directory = await mkdtemp(join(tmpdir(), 'roadmap-portable-'));
  try {
    const path = join(directory, 'project.html');
    await download.saveAs(path);
    const html = await readFile(path, 'utf8');
    assert.doesNotMatch(html, /src="\.\/app\/(project-format|history)\.js"/);
    const portable = await context.newPage();
    const errors = [];
    portable.on('pageerror', error => errors.push(error.message));
    await portable.goto(pathToFileURL(path).href);
    await portable.waitForFunction(() => window.roadmapApp);
    assert.deepEqual(await portable.evaluate(() => window.roadmapApp.getVault().projects[0].data), expected);
    assert.equal(await portable.locator('[data-project-format][src], [data-history][src]').count(), 0);
    await portable.evaluate(() => change(() => { state.project.description = 'portable edit'; }));
    await portable.locator('#undo').click();
    assert.deepEqual(await portable.evaluate(() => window.roadmapApp.getVault().projects[0].data), expected);
    assert.equal(await portable.locator('[data-cloud]').count(), 0);
    assert.equal(await portable.evaluate(() => window.RoadmapProjectFormat.validateProject(window.roadmapApp.getVault().projects[0].data).format), 'roadmap-project');
    assert.deepEqual(errors, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('PWA caches the shared contract and reloads offline', async () => {
  const { context, page } = await device('allow');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.roadmapApp && window.RoadmapProjectFormat && window.RoadmapHistory);
  assert.equal(await page.evaluate(() => window.RoadmapProjectFormat.validateProject(window.roadmapApp.getVault().projects[0].data).format), 'roadmap-project');
  await context.setOffline(false);
});


test('invalid legacy vault stays unchanged and can be downloaded intact', async () => {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  contexts.add(context);
  const legacy = { version: 1, active: 'legacy', projects: [{ id: 'legacy', data: fixtures.find(item => item.name === 'missing-track-title').data }] };
  const raw = JSON.stringify(legacy);
  await context.addInitScript(raw => localStorage.setItem('roadmapler-projects:/ROADMAPler/', raw), raw);
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.roadmapApp);
  assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-projects:/ROADMAPler/')), raw);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать исходные данные', exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString('utf8'), raw);
  await page.locator('#newProject').click();
  await page.locator('#projectTitle').fill('Do not overwrite legacy');
  await page.locator('#projectForm button[type=submit]').click();
  assert.match(await page.locator('#projectError').textContent(), /Хранилище|хранилище/);
  assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-projects:/ROADMAPler/')), raw);
});

test('rotated history supports undo, redo, branching and PWA restoration', async () => {
  const { page } = await device();
  await page.evaluate(() => {
    for (let i = 1; i <= 70; i++) change(() => { state.project.description = String(i); });
  });
  const checkpoint = await page.evaluate(() => {
    window.roadmapUpdate.prepare();
    return JSON.parse(sessionStorage.getItem(updateKey));
  });
  assert.equal(checkpoint.undo.length, 50);
  assert.equal(checkpoint.sessions.find(([id]) => id === JSON.parse(checkpoint.vaultRaw).active)[1].undo.length, 0);
  await page.reload();
  await page.waitForFunction(() => window.roadmapApp);
  await page.evaluate(() => { for (let i = 0; i < 50; i++) document.getElementById('undo').click(); });
  assert.equal((await vault(page)).projects[0].data.project.description, '20');
  assert.equal(await page.locator('#undo').isDisabled(), true);
  await page.evaluate(() => { for (let i = 0; i < 50; i++) document.getElementById('redo').click(); });
  assert.equal((await vault(page)).projects[0].data.project.description, '70');
  await page.locator('#undo').click();
  await page.evaluate(() => change(() => { state.project.description = 'branch'; }));
  assert.equal(await page.locator('#redo').isDisabled(), true);
});

test('large projects bound history payload without changing saved data', async () => {
  const { page } = await device();
  const result = await page.evaluate(() => {
    for (let i = 1; i <= 8; i++) change(() => { state.project.description = 'Ж'.repeat(400000) + i; });
    window.roadmapUpdate.prepare();
    const checkpoint = JSON.parse(sessionStorage.getItem(updateKey));
    return { count: checkpoint.undo.length, bytes: RoadmapHistory.bytes(checkpoint.undo) + RoadmapHistory.bytes(checkpoint.redo), max: RoadmapHistory.maxBytes };
  });
  assert.equal(result.count, 2);
  assert.ok(result.bytes <= result.max);
  await page.locator('#undo').click();
  assert.equal((await vault(page)).projects[0].data.project.description, 'Ж'.repeat(400000) + '7');
  await page.locator('#redo').click();
  assert.equal((await vault(page)).projects[0].data.project.description, 'Ж'.repeat(400000) + '8');
});

test('cloud and imported histories share limits and stay per project', async () => {
  const { page } = await device();
  await page.evaluate(() => {
    const next = window.roadmapApp.getVault();
    next.projects.push(window.roadmapApp.emptyProject());
    next.projects[1].data.project.name = 'Cloud history project';
    window.roadmapApp.saveVault(next);
    for (let i = 1; i <= 65; i++) {
      const changed = window.roadmapApp.getVault();
      changed.projects[1].data.project.description = 'remote-' + i;
      window.roadmapApp.saveVault(changed, true);
    }
    switchProject(vault.projects[1].id);
  });
  for (let i = 1; i <= 3; i++) {
    const input = (await vault(page)).projects[1].data;
    input.project.description = 'import-' + i;
    await imported(page, input);
    await page.locator('#importDialog').waitFor({ state: 'visible' });
    await page.locator('#updateImported').click();
    await page.locator('#importDialog').waitFor({ state: 'hidden' });
  }
  await page.evaluate(() => { for (let i = 0; i < 50; i++) document.getElementById('undo').click(); });
  assert.equal((await vault(page)).projects[1].data.project.description, 'remote-18');
  await page.evaluate(() => switchProject(vault.projects[0].id));
  assert.equal(await page.locator('#undo').isDisabled(), true);
  await page.evaluate(() => switchProject(vault.projects[1].id));
  assert.equal(await page.locator('#redo').isDisabled(), false);
});

test('checkpoint shares history budget across projects and fails safely on quota', async () => {
  const { page } = await device();
  const result = await page.evaluate(() => {
    const next = window.roadmapApp.getVault();
    for (let i = 0; i < 3; i++) next.projects.push(window.roadmapApp.emptyProject());
    next.projects[1].data.project.name = 'Cloud history project';
    window.roadmapApp.saveVault(next);
    for (const project of vault.projects) {
      switchProject(project.id);
      for (let i = 1; i <= 4; i++) change(() => { state.project.description = 'x'.repeat(180000) + i; });
    }
    window.roadmapUpdate.prepare();
    const snapshot = JSON.parse(sessionStorage.getItem(updateKey));
    const size = RoadmapHistory.bytes(snapshot.undo) + RoadmapHistory.bytes(snapshot.redo) + snapshot.sessions.reduce((n, [, saved]) => n + RoadmapHistory.bytes(saved.undo) + RoadmapHistory.bytes(saved.redo), 0);
    window.roadmapUpdate.cancel();
    const before = JSON.stringify([undoStack, redoStack, [...projectSessions]]);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === updateKey) throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); };
    let error;
    try { window.roadmapUpdate.prepare(); } catch (e) { error = e.name; } finally { Storage.prototype.setItem = original; }
    return { size, limit: RoadmapHistory.maxBytes, unchanged: before === JSON.stringify([undoStack, redoStack, [...projectSessions]]), error, data: vault.projects.map(p => p.data.project.description) };
  });
  assert.ok(result.size <= result.limit);
  assert.equal(result.error, 'QuotaExceededError');
  assert.equal(result.unchanged, true);
  assert.ok(result.data.every(value => value === 'x'.repeat(180000) + '4'));
});

test('card opens directly in editor from its title and edit icon', async () => {
  const { page } = await device();
  await page.getByRole('button', { name: 'Создать карточку: Продукт / Backlog', exact: true }).click();
  await page.locator('#taskName').fill('Editable card');
  await page.locator('#taskBody').fill('Original description');
  await page.locator('#saveTask').click();
  const card = page.locator('.card').filter({ hasText: 'Editable card' });
  await card.locator('.card-open').click();
  assert.equal(await page.locator('#taskDialog').isVisible(), true);
  assert.equal(await page.locator('#taskBody').inputValue(), 'Original description');
  await page.locator('#taskBody').fill('Cancelled description');
  await page.locator('#taskCancel').click();
  await card.getByRole('button', { name: 'Редактировать карточку Editable card', exact: true }).click();
  assert.equal(await page.locator('#taskBody').inputValue(), 'Original description');
  await page.locator('#taskBody').fill('Saved description');
  await page.locator('#saveTask').click();
  assert.equal((await vault(page)).projects[0].data.tasks[0].description, 'Saved description');
  await page.locator('#undo').click();
  assert.equal((await vault(page)).projects[0].data.tasks[0].description, 'Original description');
  await page.locator('#redo').click();
  assert.equal((await vault(page)).projects[0].data.tasks[0].description, 'Saved description');
  assert.equal(await page.locator('#cardView').count(), 0);
});
