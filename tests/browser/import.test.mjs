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
    assert.doesNotMatch(html, /src="\.\/app\/project-format\.js"/);
    const portable = await context.newPage();
    const errors = [];
    portable.on('pageerror', error => errors.push(error.message));
    await portable.goto(pathToFileURL(path).href);
    await portable.waitForFunction(() => window.roadmapApp);
    assert.deepEqual(await portable.evaluate(() => window.roadmapApp.getVault().projects[0].data), expected);
    assert.equal(await portable.locator('[data-project-format][src]').count(), 0);
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
  await page.waitForFunction(() => window.roadmapApp && window.RoadmapProjectFormat);
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
