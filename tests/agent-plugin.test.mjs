import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { buildAgentPackage } from '../scripts/agent-package.mjs';

let directory, manifest, files, archivePath, extracted, api, requests = [], apiStatus = 200;
const project = '10000000-0000-4000-8000-000000000001', token = 'rmi_' + 'a'.repeat(64);
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'roadmapler-plugin-test-'));
  const output = pathToFileURL(directory + '/');
  ({ descriptor: manifest, files } = await buildAgentPackage(output));
  archivePath = join(directory, manifest.archive.url);
  extracted = join(directory, 'extracted');
  // Independent ZIP implementation validates central directory, CRCs and extraction.
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', archivePath, extracted]);
  api = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(text) });
    response.writeHead(apiStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(apiStatus === 200 ? { id: project, revision: 7, tokenEcho: token } : { message: 'Denied ' + token, code: 'PT' + apiStatus }));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => api.on('listening', resolve));
  await writeFile(join(directory, 'credentials.json'), JSON.stringify({ projectId: project, token, publishableKey: 'sb_publishable_test', supabaseUrl: `http://127.0.0.1:${api.address().port}` }), { mode: 0o600 });
});
after(async () => { if (api) await new Promise(resolve => api.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });

function client() {
  const process = spawn(processExecPath, [join(extracted, 'server/mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: process.stdout });
  const pending = new Map(); let id = 0, stderr = '';
  process.stderr.on('data', chunk => { stderr += chunk; });
  lines.on('line', line => { const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id); });
  return {
    process,
    call(method, params) { const requestId = ++id; return new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(requestId); reject(Error('MCP response timeout')); }, 5000); pending.set(requestId, value => { clearTimeout(timeout); resolve(value); }); process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n'); }); },
    notify(method) { process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    async start(version = '2025-11-25') { const response = await this.call('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }); this.notify('notifications/initialized'); return response; },
    async close() { process.stdin.end(); await new Promise(resolve => process.on('exit', resolve)); lines.close(); assert.equal(stderr, ''); }
  };
}
const processExecPath = process.execPath;

test('package is reproducible, self contained and contains no user data or credentials', async () => {
  const second = new URL('second/', pathToFileURL(directory + '/'));
  const rebuilt = await buildAgentPackage(second);
  assert.deepEqual(rebuilt.descriptor, manifest);
  const archive = await readFile(archivePath);
  assert.equal(archive.length, manifest.archive.bytes);
  assert.equal(createHash('sha256').update(archive).digest('hex'), manifest.archive.sha256);
  for (const path of files.keys()) {
    assert.doesNotMatch(path, /(^|\/)(projects|archive|node_modules|credentials|\.git)(\/|\.|$)/);
    assert.deepEqual(await readFile(join(extracted, path)), files.get(path), path);
  }
  const plugin = JSON.parse(await readFile(join(extracted, 'plugin.json')));
  const compat = JSON.parse(await readFile(join(extracted, '.codex-plugin/plugin.json')));
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(compat.name, plugin.name); assert.equal(compat.version, plugin.version);
  assert.ok(plugin.extensions['com.openai'].interface.shortDescription.length <= 30);
  assert.equal([...files.keys()].filter(path => path.endsWith('/SKILL.md')).length, 3);
  for (const [path, content] of files) if (path.endsWith('/SKILL.md')) assert.match(content.toString(), /^---\nname: [a-z-]+\ndescription: .+\n---\n/);
  assert.equal((await readFile(join(extracted, 'server/integration-client.mjs'))).toString(), (await readFile(new URL('../scripts/integration-client.mjs', import.meta.url))).toString());
  assert.doesNotMatch(archive.toString('utf8'), new RegExp(token));
});

test('extracted MCP starts without dependencies and discovers all tools', async () => {
  const c = client();
  try {
    const early = await c.call('tools/list'); assert.equal(early.error.code, -32000);
    const init = await c.start('2025-03-26'); assert.equal(init.result.protocolVersion, '2025-03-26');
    const list = await c.call('tools/list'); assert.equal(list.result.tools.length, 18);
    assert.equal(new Set(list.result.tools.map(t => t.name)).size, 18);
    for (const tool of list.result.tools) { assert.equal(tool.inputSchema.additionalProperties, false); assert.ok(tool.annotations); }
    assert.ok(list.result.tools.find(t => t.name === 'roadmap_card_delete').annotations.destructiveHint);
    assert.equal((await c.call('ping')).result.constructor, Object);
    assert.equal((await c.call('missing')).error.code, -32601);
    const invalid = await c.call('tools/call', { name: 'roadmap_card_update', arguments: { task: 'card' } }); assert.equal(invalid.error.code, -32602);
  } finally { await c.close(); }
});

test('tools reuse CLI endpoints, validate schemas, preserve revisions and redact secrets', async () => {
  const c = client(); const credentials = join(directory, 'credentials.json'); requests = [];
  try {
    await c.start();
    const invoke = (name, args = {}) => c.call('tools/call', { name, arguments: { credentials, ...args } });
    const read = await invoke('roadmap_project_read'); assert.equal(read.result.isError, false); assert.equal(read.result.structuredContent.tokenEcho, '[token]');
    const cases = [
      ['roadmap_changes', { since: 4 }, 'roadmap_integration_changes', { p_since: 4 }],
      ['roadmap_cards_search', { query: 'find', limit: 100, offset: 100 }, 'roadmap_integration_cards', { p_action: 'search', p_limit: 100, p_offset: 100 }],
      ['roadmap_card_get', { task: 'card' }, 'roadmap_integration_cards', { p_action: 'get', p_task_id: 'card' }],
      ['roadmap_card_create', { task: 'new', expected: 7, patch: { title: 'New', description: 'Details', track: 'track', release: 'backlog', status: 'planned' } }, 'roadmap_integration_cards', { p_action: 'create', p_expected: 7 }],
      ['roadmap_card_update', { task: 'card', expected: 7, patch: { comment: 'note' } }, 'roadmap_integration_cards', { p_action: 'update', p_expected: 7, p_patch: { comment: 'note' } }],
      ['roadmap_card_comment', { task: 'card', expected: 7, text: 'append' }, 'roadmap_integration_cards', { p_action: 'comment', p_patch: { text: 'append' } }],
      ['roadmap_card_delete', { task: 'card', expected: 7, confirm_delete: 'card' }, 'roadmap_integration_cards', { p_action: 'delete' }]
    ];
    for (const kind of ['track', 'release']) {
      const plural = kind === 'track' ? 'tracks' : 'releases';
      cases.push(['roadmap_' + plural + '_search', { offset: 10, limit: 5 }, 'roadmap_integration_structure', { p_kind: plural, p_action: 'search' }]);
      for (const verb of ['get', 'create', 'update', 'delete']) cases.push(['roadmap_' + kind + '_' + verb, { id: kind, ...(verb === 'get' ? {} : { expected: 7 }), ...(verb === 'create' || verb === 'update' ? { patch: { title: 'Changed' }, position: 0 } : {}), ...(verb === 'delete' ? { cards: 'move', target_track: 'other', target_release: 'backlog', confirm_delete: kind } : {}) }, 'roadmap_integration_structure', { p_kind: plural, p_action: verb }]);
    }
    for (const [name, args, endpoint, fields] of cases) {
      assert.equal((await invoke(name, args)).result.isError, false, name);
      assert.equal(requests.at(-1).url, '/rest/v1/rpc/' + endpoint);
      for (const [key, expected] of Object.entries(fields)) assert.deepEqual(requests.at(-1).body[key], expected, name + ' ' + key);
      assert.equal(requests.at(-1).headers['x-roadmapler-token'], token);
    }
    const before = requests.length;
    for (const [name, args] of [['roadmap_card_update', { task: 'card', expected: 0, patch: {} }], ['roadmap_card_update', { task: 'card', expected: 7, patch: { source: 'unknown' } }], ['roadmap_cards_search', { limit: 101 }], ['roadmap_project_read', { token }]]) assert.equal((await invoke(name, args)).error.code, -32602);
    const denied = await invoke('roadmap_card_delete', { task: 'card', expected: 7, confirm_delete: 'other' }); assert.equal(denied.result.isError, true);
    assert.equal(requests.length, before);
    for (const status of [409, 401, 403, 410]) {
      apiStatus = status; const count = requests.length;
      const error = await invoke('roadmap_card_update', { task: 'card', expected: 7, patch: { title: 'Changed' } });
      assert.equal(error.result.isError, true); assert.equal(error.result.structuredContent.status, status); assert.equal(error.result.structuredContent.retryable, false);
      assert.equal(requests.length, count + 1); assert.doesNotMatch(JSON.stringify(error), new RegExp(token));
    }
  } finally { apiStatus = 200; await c.close(); }
});

test('unsafe credential files fail before any network call', async () => {
  const c = client(); const credentials = join(directory, 'credentials.json'); const count = requests.length;
  try {
    await c.start();
    await chmod(credentials, 0o644);
    assert.equal((await c.call('tools/call', { name: 'roadmap_project_read', arguments: { credentials } })).result.isError, true);
    await chmod(credentials, 0o600);
    const link = join(directory, 'credentials-link.json'); await symlink(credentials, link);
    assert.equal((await c.call('tools/call', { name: 'roadmap_project_read', arguments: { credentials: link } })).result.isError, true);
    assert.equal(requests.length, count);
  } finally { await chmod(credentials, 0o600); await c.close(); }
});
