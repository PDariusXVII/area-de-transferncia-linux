'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Mailbox } = require('../src/mailbox');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-mb-'));
const once = (em, ev, ms = 1500) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout esperando "${ev}"`)), ms);
  em.once(ev, (v) => { clearTimeout(t); resolve(v); });
});
const drop = (box, name, obj) => {
  const f = path.join(box.inbox, name);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  fs.renameSync(`${f}.tmp`, `${f}.json`);
};

test('recebe mensagens da caixa de entrada e apaga o arquivo', async () => {
  const box = new Mailbox({ root: tmp() });
  box.start();
  try {
    const p = once(box, 'message');
    drop(box, `${Date.now()}-a`, { type: 'toggle' });
    assert.deepEqual(await p, { type: 'toggle' });
    assert.deepEqual(fs.readdirSync(box.inbox), []);
  } finally { box.stop(); }
});

test('ignora mensagem velha (app estava fechado) e JSON corrompido', async () => {
  const box = new Mailbox({ root: tmp(), staleMs: 1000 });
  fs.mkdirSync(box.inbox, { recursive: true });
  drop(box, `${Date.now() - 60_000}-old`, { type: 'toggle' });
  fs.writeFileSync(path.join(box.inbox, `${Date.now()}-bad.json`), '{nope');
  const seen = [];
  box.on('message', (m) => seen.push(m));
  box.start();
  try {
    drop(box, `${Date.now()}-ok`, { type: 'show' });
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(seen, [{ type: 'show' }]);
  } finally { box.stop(); }
});

test('mv-clipboard-ctl entrega o comando ao app', async () => {
  const root = tmp();
  const box = new Mailbox({ root: path.join(root, 'mv-clipboard') });
  box.start();
  try {
    const p = once(box, 'message');
    execFileSync('sh', [path.join(__dirname, '..', 'bin', 'mv-clipboard-ctl'), 'toggle'], { env: { ...process.env, XDG_RUNTIME_DIR: root } });
    assert.deepEqual(await p, { type: 'toggle' });
  } finally { box.stop(); }
});

test('mv-clipboard-ctl rejeita comando desconhecido', () => {
  assert.throws(() => execFileSync('sh', [path.join(__dirname, '..', 'bin', 'mv-clipboard-ctl'), 'rm-rf'], { stdio: 'pipe' }));
});

test('sendToShell cria arquivo atômico; bridgeAlive depende do batimento', () => {
  const box = new Mailbox({ root: tmp() });
  box.start();
  try {
    box.sendToShell({ type: 'paste', shift: true });
    const files = fs.readdirSync(box.shell);
    assert.equal(files.length, 1);
    assert.match(files[0], /^\d+-[0-9a-f]{8}\.json$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(box.shell, files[0]), 'utf8')), { type: 'paste', shift: true });

    assert.equal(box.bridgeAlive(), false);
    fs.writeFileSync(path.join(box.root, 'shell.alive'), 'x');
    assert.equal(box.bridgeAlive(), true);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(box.root, 'shell.alive'), old, old);
    assert.equal(box.bridgeAlive(), false);
  } finally { box.stop(); }
});

test('app.alive é criado ao iniciar e removido ao parar', () => {
  const box = new Mailbox({ root: tmp() });
  box.start();
  assert.ok(fs.existsSync(path.join(box.root, 'app.alive')));
  box.stop();
  assert.ok(!fs.existsSync(path.join(box.root, 'app.alive')));
});
