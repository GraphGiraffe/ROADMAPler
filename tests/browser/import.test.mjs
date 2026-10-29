import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
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
      const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/(?:ROADMAPler|SECOND)\//, '') || 'index.html';
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
  await page.waitForFunction(() => window.roadmapApp && window.roadmapCloud && window.roadmapApp.canWrite());
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
  await page.waitForFunction(() => window.roadmapApp && window.RoadmapProjectFormat && window.RoadmapHistory && window.RoadmapRecovery);
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

test('Integrations offers the same checked plugin ZIP as the discovery API without login', async () => {
  const { context, page } = await device();
  const data = await (await context.request.get(origin + 'api/agent-plugin/manifest.json')).json();
  assert.equal(data.name, 'roadmapler'); assert.equal(data.credentialsIncluded, false);
  await page.evaluate(() => document.querySelector('.menu-panel').parentElement.open = true);
  await page.getByRole('button', { name: 'Интеграции', exact: true }).click();
  await page.locator('#agentPluginDownload').waitFor({ state: 'visible' });
  assert.match(await page.locator('#agentPluginState').textContent(), new RegExp(data.version.replaceAll('.', '\\.')));
  const href = await page.locator('#agentPluginDownload').getAttribute('href');
  assert.equal(href, new URL(data.archive.url, origin + 'api/agent-plugin/manifest.json').href);
  assert.equal(await page.locator('#integrationForm').isVisible(), false);
  const pending = page.waitForEvent('download');
  await page.locator('#agentPluginDownload').click();
  const download = await pending;
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const archive = Buffer.concat(chunks);
  assert.equal(archive.length, data.archive.bytes);
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(archive).digest('hex'), data.archive.sha256);
  assert.match((await context.request.get(origin + 'api/agent-plugin/README.txt')).headers()['content-type'] || '', /./);
});

test('plugin download failure is shown in app and can be retried', async () => {
  const { page } = await device();
  await page.route('**/api/agent-plugin/manifest.json', route => route.fulfill({ status: 503, body: '{}' }));
  await page.evaluate(() => document.querySelector('.menu-panel').parentElement.open = true);
  await page.getByRole('button', { name: 'Интеграции', exact: true }).click();
  await page.locator('#agentPluginRetry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#agentPluginDownload').isVisible(), false);
  assert.match(await page.locator('#agentPluginState').textContent(), /Не удалось/);
  await page.unroute('**/api/agent-plugin/manifest.json');
  await page.locator('#agentPluginRetry').click();
  await page.locator('#agentPluginDownload').waitFor({ state: 'visible' });
});

async function recoveryDevice(fragment = '', options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  contexts.add(context);
  const calls = [], state = { recoverStatus: 200, verifyStatus: 200, updateStatus: 200, ...options };
  const token = 'recovery-access-test', refresh = 'recovery-refresh-test';
  if (state.savedSession) await context.addInitScript(({ origin, session, data }) => {
    localStorage.setItem('roadmapler-cloud:/ROADMAPler/', JSON.stringify(session));
    localStorage.setItem('roadmapler-projects:/ROADMAPler/', JSON.stringify({ version: 1, active: 'saved', projects: [{ id: 'saved', data }] }));
  }, { origin, session: state.savedSession, data: fixtures.find(f => f.name === 'unknown-fields-preserved').data });
  let page;
  await context.route('https://klsxfhettffjbnmuxivg.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    calls.push({ path: url.pathname, query: url.search, method: request.method(), body: request.postDataJSON(), authorization: request.headers().authorization, pageURL: page.url() });
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ json: [] });
    if (url.pathname === '/auth/v1/recover') return route.fulfill({ status: state.recoverStatus, json: state.recoverStatus === 200 ? {} : { msg: 'rate limit' } });
    if (url.pathname === '/auth/v1/token') { if (url.searchParams.get('grant_type') === 'password' && state.loginStatus) return route.fulfill({ status: state.loginStatus, json: { msg: 'Wrong test password' } }); if (state.refreshGate) await state.refreshGate; return route.fulfill({ json: { access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, user: { id: 'existing-user', email: 'signed@example.org' } } }); }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'GET' && state.verifyGate) await state.verifyGate;
      const status = request.method() === 'PUT' ? state.updateStatus : state.verifyStatus;
      return route.fulfill({ status, json: status === 200 ? { id: 'recovered-user', email: 'recovered@example.org' } : { msg: 'Rejected ' + token } });
    }
    return route.abort();
  });
  page = await context.newPage();
  await page.goto(origin + fragment);
  await page.waitForFunction(() => window.roadmapApp && window.RoadmapRecovery);
  return { context, page, calls, state, token, refresh };
}
async function openRecoveryRequest(page) {
  await page.evaluate(() => document.querySelector('.menu-panel').parentElement.open = true);
  await page.getByRole('button', { name: 'Аккаунт', exact: true }).click();
  await page.locator('#cloudForgotPassword').click();
}
const recoveryFragment = '?recovery=1#type=recovery&access_token=recovery-access-test&refresh_token=recovery-refresh-test';

test('recovery email validates locally and sends a scoped redirect without exposing account existence', async () => {
  const { page, calls } = await recoveryDevice();
  const before = await vault(page);
  await openRecoveryRequest(page);
  await page.locator('#recoveryEmail').fill('invalid'); await page.locator('#recoverySend').click();
  assert.match(await page.locator('#recoveryError').textContent(), /корректную/);
  assert.equal(calls.length, 0);
  await page.locator('#recoveryEmail').fill('user@example.org'); await page.locator('#recoverySend').click();
  await page.waitForFunction(() => document.getElementById('recoveryRequest').hidden);
  assert.match(await page.locator('#recoveryState').textContent(), /Если аккаунт/);
  assert.deepEqual(calls[0].body, { email: 'user@example.org' });
  assert.equal(new URLSearchParams(calls[0].query).get('redirect_to'), origin + '?recovery=1');
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].authorization, undefined);
  assert.deepEqual(await vault(page), before);
});

test('recovery email reports rate/network errors in app and supports explicit retry', async () => {
  const { page, calls, state } = await recoveryDevice('', { recoverStatus: 429 });
  await openRecoveryRequest(page); await page.locator('#recoveryEmail').fill('user@example.org');
  await page.locator('#recoverySend').click();
  await page.waitForFunction(() => document.getElementById('recoveryError').textContent.includes('Не удалось'));
  assert.equal(calls.length, 1); assert.equal(await page.locator('#recoverySend').isEnabled(), true);
  state.recoverStatus = 200; await page.locator('#recoverySend').click();
  await page.waitForFunction(() => document.getElementById('recoveryRequest').hidden);
  assert.equal(calls.length, 2);
});

test('recovery callback clears URL secrets and changes password without replacing the existing account or projects', async () => {
  const savedSession = { provider: 'supabase', url: 'https://klsxfhettffjbnmuxivg.supabase.co', key: 'sb_publishable_saved', token: 'existing-access', refresh: 'existing-refresh', user: { id: 'existing-user', email: 'existing@example.org' }, expires: Date.now() + 3600000, remember: true };
  const { page, calls, token, refresh } = await recoveryDevice(recoveryFragment, { savedSession });
  await page.locator('#recoveryPasswordForm').waitFor({ state: 'visible' });
  assert.equal(page.url(), origin);
  assert.match(await page.locator('#recoveryState').textContent(), /recovered@example.org/);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  assert.ok(calls.filter(c => c.path === '/auth/v1/user').every(c => !c.pageURL.includes(token) && !c.pageURL.includes(refresh)));
  await page.locator('#recoveryPassword').fill('New-secret-password');
  await page.locator('#recoveryPasswordAgain').fill('New-secret-password');
  await page.locator('#recoverySave').click();
  await page.locator('#recoveryLogin').waitFor({ state: 'visible' });
  const update = calls.find(c => c.method === 'PUT');
  assert.deepEqual(update.body, { password: 'New-secret-password' });
  assert.equal(update.authorization, 'Bearer ' + token);
  assert.equal(await page.locator('#recoveryPassword').inputValue(), '');
  assert.equal(await page.locator('#recoveryPasswordAgain').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('roadmapler-cloud:/ROADMAPler/'))), savedSession);
  const current = await vault(page);
  assert.deepEqual(current.projects[0].data, fixtures.find(f => f.name === 'unknown-fields-preserved').data);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const secret of [token, refresh, 'New-secret-password']) assert.equal(stored.includes(secret), false);
  await page.locator('#recoveryClose').click();
});

test('password validation blocks writes and transient failure permits an explicit retry', async () => {
  const { page, calls, state } = await recoveryDevice(recoveryFragment, { updateStatus: 503 });
  await page.locator('#recoveryPasswordForm').waitFor({ state: 'visible' });
  await page.locator('#recoveryPassword').fill('short'); await page.locator('#recoverySave').click();
  assert.match(await page.locator('#recoveryError').textContent(), /12/);
  await page.locator('#recoveryPassword').fill('New-secret-password'); await page.locator('#recoveryPasswordAgain').fill('Different-password'); await page.locator('#recoverySave').click();
  assert.match(await page.locator('#recoveryError').textContent(), /не совпадают/);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  await page.locator('#recoveryPasswordAgain').fill('New-secret-password'); await page.locator('#recoverySave').click();
  await page.waitForFunction(() => document.getElementById('recoveryError').textContent.includes('Не удалось сохранить'));
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
  assert.equal(await page.locator('#recoveryPassword').inputValue(), '');
  state.updateStatus = 200;
  await page.locator('#recoveryPassword').fill('New-secret-password'); await page.locator('#recoveryPasswordAgain').fill('New-secret-password'); await page.locator('#recoverySave').click();
  await page.locator('#recoveryLogin').waitFor({ state: 'visible' });
  assert.equal(calls.filter(c => c.method === 'PUT').length, 2);
});

test('expired, malformed and wrong-type recovery links cannot change a password', async () => {
  for (const [fragment, options] of [[recoveryFragment, { verifyStatus: 401 }], ['?recovery=1#error=access_denied&error_description=expired', {}], ['?recovery=1#type=signup&access_token=not-recovery', {}]]) {
    const { page, calls } = await recoveryDevice(fragment, options);
    await page.waitForFunction(() => document.getElementById('recoveryError').textContent.length > 0);
    assert.equal(page.url(), origin);
    assert.equal(await page.locator('#recoveryPasswordForm').isVisible(), false);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
    assert.equal((await page.locator('#recoveryDialog').textContent()).includes('recovery-access-test'), false);
  }
});

test('closing recovery while checking a link discards late results and never retains its session', async () => {
  let release; const verifyGate = new Promise(resolve => { release = resolve; });
  const { page, calls, token } = await recoveryDevice(recoveryFragment, { verifyGate });
  try {
    await page.locator('#recoveryDialog').waitFor({ state: 'visible' });
    await page.locator('#recoveryClose').click();
    release();
    await page.waitForFunction(() => !document.getElementById('recoveryDialog').open);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#recoveryPasswordForm').isVisible(), false);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
    assert.equal((await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(token), false);
  } finally { release(); }
});


test('large-board measurement: search coalesces rendering and avoids vault serialization', async () => {
  const { page } = await device();
  const measurements = [];
  for (const count of [200, 1000]) {
    await page.evaluate(count => {
      const next = window.roadmapApp.getVault(), data = next.projects[0].data;
      data.formatVersion = 2;
      data.tracks = Array.from({ length: 6 }, (_, i) => ({ id: 'track-' + i, title: 'Track ' + i }));
      data.releases = Array.from({ length: 8 }, (_, i) => ({ id: 'release-' + i, title: 'Release ' + i }));
      data.tasks = Array.from({ length: count }, (_, i) => ({ id: 'card-' + i, title: 'Card ' + i, description: 'Details '.repeat(20), status: 'planned', track: 'track-' + (i % 6), release: 'release-' + (i % 8) }));
      window.roadmapApp.saveVault(next);
      document.getElementById('search').value = '';
      document.getElementById('search').dispatchEvent(new Event('input'));
    }, count);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
    measurements.push(await page.evaluate(async count => {
      let vaultSerializations = 0, viewWrites = 0, projectWrites = 0, renders = 0;
      const stringify = JSON.stringify, setItem = Storage.prototype.setItem, replace = Element.prototype.replaceChildren;
      JSON.stringify = function(value, ...args) { if (value?.projects?.some?.(p => p?.data?.format === 'roadmap-project')) vaultSerializations++; return stringify.call(this, value, ...args); };
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('roadmapler-project-views:')) viewWrites++; if (key.startsWith('roadmapler-projects:')) projectWrites++; return setItem.call(this, key, value); };
      Element.prototype.replaceChildren = function(...args) { if (this.id === 'board') renders++; return replace.apply(this, args); };
      try {
        const started = performance.now(), search = document.getElementById('search');
        for (const query of ['C', 'Ca', 'Car', 'Card', 'Card ', 'Card 9', 'Card ', 'Card 2', 'Card ', 'Card 1']) { search.value = query; search.dispatchEvent(new Event('input')); }
        const dispatchMs = performance.now() - started;
        await new Promise(resolve => setTimeout(resolve, 400));
        return { cards: count, inputEvents: 10, dispatchMs: +dispatchMs.toFixed(2), renders, viewWrites, vaultSerializations, projectWrites, displayedCards: document.querySelectorAll('.card').length };
      } finally { JSON.stringify = stringify; Storage.prototype.setItem = setItem; Element.prototype.replaceChildren = replace; }
    }, count));
  }
  await mkdir(join(root, 'tmp_files'), { recursive: true });
  const phase = process.env.ROADMAP_BENCH_BASELINE === '1' ? 'before' : 'after';
  await writeFile(join(root, 'tmp_files', 'board-performance-' + phase + '.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log('Large-board measurement:', JSON.stringify(measurements));
  if (phase === 'after') for (const result of measurements) { assert.equal(result.projectWrites, 0); assert.equal(result.vaultSerializations, 0); assert.ok(result.renders <= 1); assert.ok(result.viewWrites <= 1); assert.ok(result.displayedCards > 0); }
});

test('two tabs serialize project writes; promotion never overwrites a stale snapshot', async () => {
  const { context, page: first } = await device();
  const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => window.roadmapApp);
  assert.equal(await second.evaluate(() => window.roadmapApp.canWrite()), false);
  const result = await Promise.all([
    first.evaluate(() => change(() => { state.project.description = 'First tab'; })),
    second.evaluate(() => change(() => { state.project.description = 'Second tab'; }))
  ]);
  assert.deepEqual(result, [true, false]);
  await second.waitForFunction(() => vaultStale);
  assert.equal(await second.evaluate(() => JSON.parse(localStorage.getItem(vaultKey)).projects[0].data.project.description), 'First tab');
  await first.close();
  await second.waitForFunction(() => writeGuard.canWrite());
  assert.equal(await second.evaluate(() => window.roadmapApp.canWrite()), false);
  assert.equal(await second.evaluate(() => change(() => { state.project.description = 'Stale write'; })), false);
  await second.reload(); await second.waitForFunction(() => window.roadmapApp?.canWrite());
  assert.equal((await vault(second)).projects[0].data.project.description, 'First tab');
  assert.equal(await second.evaluate(() => change(() => { state.project.description = 'Fresh second tab'; })), true);
  assert.equal(await second.evaluate(() => JSON.parse(localStorage.getItem(vaultKey)).projects[0].data.project.description), 'Fresh second tab');
});

test('write ownership is scoped to the application path', async () => {
  const { context, page: first } = await device();
  const second = await context.newPage(); await second.goto(origin.replace('/ROADMAPler/', '/SECOND/')); await second.waitForFunction(() => window.roadmapApp?.canWrite());
  assert.equal(await first.evaluate(() => change(() => { state.project.name = 'First scope'; })), true);
  assert.equal(await second.evaluate(() => change(() => { state.project.name = 'Second scope'; })), true);
  assert.equal((await vault(first)).projects[0].data.project.name, 'First scope');
  assert.equal((await vault(second)).projects[0].data.project.name, 'Second scope');
});

test('unsupported locks keep data readable and exportable without unsafe writes', async () => {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });contexts.add(context);
  await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  const page = await context.newPage();await page.goto(origin);await page.waitForFunction(() => window.roadmapApp);
  const before = await vault(page);
  assert.equal(await page.evaluate(() => window.roadmapApp.canWrite()), false);
  assert.equal(await page.evaluate(() => change(() => { state.project.description = 'Unsafe write'; })), false);
  assert.deepEqual(await vault(page), before);
  assert.equal(await page.evaluate(() => localStorage.getItem(vaultKey)), null);
  const download = page.waitForEvent('download');await page.evaluate(() => document.getElementById('exportProject').click());
  assert.equal((await download).suggestedFilename(), 'project.roadmap.json');
});

test('project views migrate without deleting legacy data and flush on immediate reload', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });contexts.add(context);
  const legacy = JSON.stringify({ version: 1, projects: [['initial', { search: 'legacy', showDone: false, showDoneReleases: false }]] });
  await context.addInitScript(raw => { if (!localStorage.getItem('roadmapler-project-views:/ROADMAPler/')) localStorage.setItem('roadmapler-project-views:/ROADMAPler/', raw); }, legacy);
  const page = await context.newPage();await page.goto(origin);await page.waitForFunction(() => window.roadmapApp?.canWrite());
  assert.equal(await page.locator('#search').inputValue(), 'legacy');
  await page.locator('#search').fill('latest input');
  await page.reload();await page.waitForFunction(() => window.roadmapApp?.canWrite());
  assert.equal(await page.locator('#search').inputValue(), 'latest input');
  assert.equal(await page.locator('#showDone').isChecked(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-project-views:/ROADMAPler/')), legacy);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(viewStorageKey(vault.active))).search), 'latest input');
});

test('read-only tabs can browse projects and independent view writes do not overwrite each other', async () => {
  const { context, page: first } = await device();
  const ids = await first.evaluate(() => { const next = window.roadmapApp.getVault();next.projects.push(window.roadmapApp.emptyProject());window.roadmapApp.saveVault(next);return next.projects.map(p => p.id); });
  const second = await context.newPage();await second.goto(origin);await second.waitForFunction(() => window.roadmapApp);
  await second.evaluate(id => switchProject(id), ids[1]);
  assert.equal((await vault(second)).active, ids[1]);
  await first.locator('#search').fill('First view');await second.locator('#search').fill('Second view');
  await first.evaluate(() => flushProjectViews());await second.evaluate(() => flushProjectViews());
  const views = await first.evaluate(ids => ids.map(id => JSON.parse(localStorage.getItem(viewStorageKey(id))).search), ids);
  assert.deepEqual(views, ['First view', 'Second view']);
  assert.equal(await second.evaluate(() => JSON.parse(localStorage.getItem(vaultKey)).active), ids[0]);
});

function signedInSession() { return { provider: 'supabase', url: 'https://klsxfhettffjbnmuxivg.supabase.co', key: 'sb_publishable_saved', token: 'existing-access', refresh: 'existing-refresh', user: { id: 'existing-user', email: 'signed@example.org' }, label: 'signed@example.org', expires: Date.now() + 3600000, remember: true }; }
async function openAccount(page) { await page.evaluate(() => document.querySelector('.menu-panel').parentElement.open = true); await page.getByRole('button', { name: 'Аккаунт', exact: true }).click(); }

test('signed-in account exposes password actions without opening a different connection', async () => {
  const { page } = await recoveryDevice('', { savedSession: signedInSession() });
  await openAccount(page);
  assert.equal(await page.locator('#cloudLogin').isVisible(), false);
  assert.doesNotMatch(await page.locator('#cloudAccountState').textContent(), /Локальный режим/);
  assert.equal(await page.locator('#cloudForgotPassword').isVisible(), true);
  assert.equal(await page.locator('#cloudChangePassword').isVisible(), true);
  await page.screenshot({ path: join(root, 'tmp_files/account-actions-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: join(root, 'tmp_files/account-actions-desktop.png') });
  await page.locator('#cloudForgotPassword').click();
  assert.equal(await page.locator('#recoveryEmail').inputValue(), 'signed@example.org');
});

test('signout requires confirmation and cancellation preserves connection and projects', async () => {
  const session = signedInSession(); const { page } = await recoveryDevice('', { savedSession: session });
  const before = await vault(page);await openAccount(page);await page.locator('#cloudDisconnect').click();
  assert.equal(await page.locator('#cloudSignoutDialog').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('roadmapler-cloud:/ROADMAPler/'))), session);
  await page.locator('#cloudSignoutCancel').click();
  assert.equal(await page.locator('#cloudAccount').isVisible(), true);
  assert.deepEqual(await vault(page), before);
  await page.locator('#cloudDisconnect').click();await page.locator('#cloudSignoutConfirm').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-cloud:/ROADMAPler/')), null);
  assert.deepEqual(await vault(page), before);
});

test('signed-in password change uses current account and never logs it out on cancel or success', async () => {
  const session = signedInSession();const { page, calls } = await recoveryDevice('', { savedSession: session });
  await openAccount(page);await page.locator('#cloudChangePassword').click();
  assert.equal(await page.locator('#recoveryPasswordForm').isVisible(), true);
  await page.locator('#recoveryClose').click();
  assert.equal(calls.filter(c => c.path === '/auth/v1/logout').length, 0);
  await openAccount(page);await page.locator('#cloudChangePassword').click();
  await page.locator('#recoveryPassword').fill('New-account-password');await page.locator('#recoveryPasswordAgain').fill('New-account-password');await page.locator('#recoverySave').click();
  await page.locator('#recoveryLogin').waitFor({ state: 'visible' });
  assert.equal(calls.find(c => c.method === 'PUT').authorization, 'Bearer existing-access');
  assert.equal(calls.filter(c => c.path === '/auth/v1/logout').length, 0);
  assert.equal(calls.filter(c => c.path === '/auth/v1/recover').length, 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('roadmapler-cloud:/ROADMAPler/'))), session);
});


test('signout is not undone by an in-flight session refresh', async () => {
  let release;const refreshGate = new Promise(resolve => { release = resolve; });
  const session = signedInSession();session.expires = Date.now() - 1;
  const { page, calls } = await recoveryDevice('', { savedSession: session, refreshGate });
  try {
    const refreshStarted = page.waitForRequest(request => request.url().includes('/auth/v1/token'));
    await openAccount(page);await refreshStarted;
    await page.locator('#cloudDisconnect').click();await page.locator('#cloudSignoutConfirm').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-cloud:/ROADMAPler/')), null);
    const loggedOut = page.waitForResponse(response => response.url().includes('/auth/v1/logout'));
    release();await loggedOut;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.evaluate(() => localStorage.getItem('roadmapler-cloud:/ROADMAPler/')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('roadmapler-cloud:/ROADMAPler/')), null);
    assert.equal(calls.find(c => c.path === '/auth/v1/logout').authorization, 'Bearer late-access');
  } finally { release(); }
});


test('failed connection switch still persists refreshes of the retained account', async () => {
  const { page } = await recoveryDevice('', { savedSession: signedInSession(), loginStatus: 400 });
  await openAccount(page);await page.getByRole('button', { name: 'Сменить подключение', exact: true }).click();
  await page.locator('#cloudEmail').fill('other@example.org');await page.locator('#cloudPassword').fill('Wrong-test-password');await page.locator('#cloudConnect').click();
  await page.waitForFunction(() => document.getElementById('cloudError').textContent.includes('Wrong test password'));
  await page.clock.setFixedTime(new Date(Date.now() + 7200000));
  await page.locator('#cloudRetry').click();
  await page.waitForFunction(() => document.getElementById('cloudAccountState').textContent.includes('Синхронизировано'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roadmapler-cloud:/ROADMAPler/')));
  assert.equal(saved.token, 'late-access');assert.equal(saved.user.id, 'existing-user');
});

for (const choice of ['mine', 'cloud', 'both', 'deleted', 'stale']) {
  test(`conflict choices preserve versions and revision checks: ${choice}`, async () => {
    const { page, context } = await recoveryDevice('', { savedSession: signedInSession() });
    await page.waitForFunction(() => window.roadmapApp.canWrite());
    const base = structuredClone(fixtures.find(f => f.name === 'unknown-fields-preserved').data);
    const local = structuredClone(base), remote = structuredClone(base);
    local.project.description = 'Local change'; remote.project.description = 'Cloud change';
    const record = { id: '11111111-1111-4111-8111-111111111111', revision: 2, data: choice === 'deleted' ? null : remote, deleted: choice === 'deleted' };
    const writes = [];
    await context.route('https://klsxfhettffjbnmuxivg.supabase.co/rest/v1/**', async route => {
      const request = route.request();
      if (request.method() === 'POST') { const body = request.postDataJSON(); writes.push(body); Object.assign(record, { revision: 3, data: body.p_data, deleted: body.p_deleted }); }
      return route.fulfill({ json: [record] });
    });
    await page.evaluate(({ base, local, id }) => {
      const next = window.roadmapApp.getVault();next.projects = [{ id: 'saved', data: local, cloud: { enabled: true, provider: 'supabase', owner: 'supabase:https://klsxfhettffjbnmuxivg.supabase.co:existing-user', id, revision: 1, base } }];next.active = 'saved';window.roadmapApp.saveVault(next);
    }, { base, local, id: record.id });
    await page.waitForFunction(() => document.querySelector('#cloudStatus').dataset.state === 'conflict');
    await page.locator('#cloudStatus').click();
    await page.locator('#cloudConflict').waitFor({ state: 'visible' });
    assert.match(await page.locator('#cloudMineSummary').innerText(), /название или описание/);
    assert.match(await page.locator('#cloudRemoteSummary').innerText(), choice === 'deleted' ? /удалён/ : /название или описание/);
    const mine = await page.locator('#cloudKeepMine').boundingBox(), cloud = await page.locator('#cloudKeepCloud').boundingBox(), both = await page.locator('#cloudKeepBoth').boundingBox();
    assert.ok(mine.x < cloud.x && both.y > mine.y);
    if (choice === 'stale') record.revision++;
    await page.locator(choice === 'mine' ? '#cloudKeepMine' : choice === 'cloud' || choice === 'stale' ? '#cloudKeepCloud' : '#cloudKeepBoth').click();
    if (choice === 'stale') {
      await page.waitForFunction(() => document.querySelector('#cloudConflictError').textContent.includes('снова изменилась'));
      assert.deepEqual((await vault(page)).projects[0].data, local);assert.equal(writes.length, 0);return;
    }
    await page.locator('#cloudConflict').waitFor({ state: 'hidden' });
    const next = await vault(page), original = next.projects.find(p => p.id === 'saved');
    if (choice === 'mine') { assert.equal(writes.length, 1);assert.equal(writes[0].p_expected, 2);assert.deepEqual(original.data, local);assert.equal(next.projects.length, 2); }
    else { assert.equal(writes.length, 0);if (choice === 'deleted') assert.equal(original, undefined);else assert.deepEqual(original.data, remote);assert.equal(next.projects.length, choice === 'both' ? 2 : 1); }
    if (choice === 'both' || choice === 'deleted') { const saved = next.projects.find(p => p.id !== 'saved');assert.equal(saved.data.project.description, local.project.description);assert.equal(saved.cloud, undefined); }
  });
}

test('browser chrome follows the selected theme on toggle and reload', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light', viewport: { width: 390, height: 844 } });
  contexts.add(context);
  const page = await context.newPage();
  await page.goto(origin);await page.waitForFunction(() => window.roadmapApp);
  const chrome = () => page.evaluate(() => {
    const color = document.querySelector('meta[name="theme-color"]').content;
    const probe = document.createElement('span');probe.style.color = color;document.body.append(probe);
    const actual = getComputedStyle(probe).color;probe.remove();
    return { actual, expected: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.dataset.theme };
  });
  for (const theme of ['dark', 'light']) {
    await page.locator('#themeToggle').click();
    let state = await chrome();assert.equal(state.theme, theme);assert.equal(state.actual, state.expected);
    await page.reload();await page.waitForFunction(() => window.roadmapApp);
    state = await chrome();assert.equal(state.theme, theme);assert.equal(state.actual, state.expected);
  }
  await page.evaluate(() => localStorage.removeItem('roadmap-theme'));
  await page.emulateMedia({ colorScheme: 'dark' });await page.reload();await page.waitForFunction(() => window.roadmapApp);
  const state = await chrome();assert.equal(state.theme, 'dark');assert.equal(state.actual, state.expected);
});

for (const [saved, system, expected] of [['dark','light','dark'], ['light','dark','light'], [null,'dark','dark']]) {
  test(`theme is applied before application loads: saved ${saved}, system ${system}`, async () => {
    const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: system });contexts.add(context);
    if (saved) await context.addInitScript(theme => localStorage.setItem('roadmap-theme', theme), saved);
    let resume;const gate = new Promise(resolve => resume = resolve);
    await context.route('**/app/project-format.js', async route => { await gate;await route.continue(); });
    const page = await context.newPage();
    try {
      await page.goto(origin, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.RoadmapTheme);
      assert.equal(await page.evaluate(() => !!window.roadmapApp), false);
      const early = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, color: document.querySelector('meta[name="theme-color"]').content, background: getComputedStyle(document.documentElement).backgroundColor, manifest: document.querySelector('link[rel="manifest"]').getAttribute('href') }));
      assert.equal(early.theme, expected);assert.equal(early.color, expected === 'dark' ? '#1c2922' : '#f3f0e7');
      assert.equal(early.background, expected === 'dark' ? 'rgb(28, 41, 34)' : 'rgb(243, 240, 231)');
      assert.equal(early.manifest, expected === 'dark' ? './manifest-dark.webmanifest' : './manifest.webmanifest');
      const light = await (await context.request.get(origin + 'manifest.webmanifest')).json();
      const dark = await (await context.request.get(origin + 'manifest-dark.webmanifest')).json();
      assert.equal(dark.background_color, '#1c2922');assert.equal(dark.theme_color, '#1c2922');
      for (const field of ['id','start_url','scope','icons']) assert.deepEqual(dark[field], light[field]);
    } finally { resume(); }
    await page.waitForFunction(() => window.roadmapApp);
    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), expected === 'dark' ? './manifest.webmanifest' : './manifest-dark.webmanifest');
  });
}
