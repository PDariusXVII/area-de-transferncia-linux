'use strict';
// Roda scripts/setup-gnome.sh de verdade, com gsettings/gnome-shell/gnome-extensions falsos (estado em JSON).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const KB = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mv-clipboard/';
const SLOT = `org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${KB}`;

const { FAKE_GSETTINGS } = require('./helpers/fake-gsettings');

function sandbox(shellVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-gnome-'));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  const w = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  w('gsettings', FAKE_GSETTINGS);
  w('gnome-shell', `#!/bin/sh\necho "GNOME Shell ${shellVersion}"\n`);
  w('gnome-extensions', `#!/bin/sh\necho "$@" >> "${dir}/gnome-extensions.log"\n[ "$1" = info ] && printf '%s\\n' 'mv-clipboard-bridge@mv.local' '  Name: MV Clipboard Bridge' '  State: ACTIVE'\nexit 0\n`);
  const env = { ...process.env, XDG_SESSION_TYPE: 'wayland', HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_GS_DB: path.join(dir, 'gs.json') };
  const db = () => JSON.parse(fs.readFileSync(env.FAKE_GS_DB, 'utf8'));
  const run = (...args) => execFileSync('bash', [path.join(ROOT, 'scripts', 'setup-gnome.sh'), ...args], { env, encoding: 'utf8' });
  return { dir, home, env, db, run };
}

test('setup-gnome: libera Super+V, registra o atalho e instala a extensão ESM (GNOME 46)', () => {
  const s = sandbox('46.7');
  const out = s.run();
  const db = s.db();
  // Super+V sai do toggle-message-tray, Super+M permanece
  assert.equal(db['org.gnome.shell.keybindings|toggle-message-tray'], "['<Super>m']");
  // atalho personalizado
  assert.equal(db['org.gnome.settings-daemon.plugins.media-keys|custom-keybindings'], `['${KB}']`);
  assert.equal(db[`${SLOT}|binding`], '<Super>v');
  assert.equal(db[`${SLOT}|name`], 'MV Clipboard');
  assert.equal(db[`${SLOT}|command`], `${s.home}/.local/bin/mv-clipboard-ctl toggle`);
  // links e extensão
  assert.ok(fs.lstatSync(path.join(s.home, '.local/bin/mv-clipboard-ctl')).isSymbolicLink());
  const ext = path.join(s.home, '.local/share/gnome-shell/extensions/mv-clipboard-bridge@mv.local');
  assert.match(fs.readFileSync(path.join(ext, 'extension.js'), 'utf8'), /export default class MvClipboardBridge/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ext, 'metadata.json'), 'utf8')).uuid, 'mv-clipboard-bridge@mv.local');
  assert.match(db['org.gnome.shell|enabled-extensions'], /user-theme.*mv-clipboard-bridge@mv\.local/);
  assert.match(fs.readFileSync(path.join(s.dir, 'gnome-extensions.log'), 'utf8'), /enable mv-clipboard-bridge@mv\.local/);
  assert.match(out, /Wayland, SAIA e ENTRE/);
});

test('setup-gnome: idempotente (rodar duas vezes não duplica nada)', () => {
  const s = sandbox('46.7');
  s.run();
  s.run();
  const db = s.db();
  assert.equal(db['org.gnome.settings-daemon.plugins.media-keys|custom-keybindings'], `['${KB}']`);
  assert.equal((db['org.gnome.shell|enabled-extensions'].match(/mv-clipboard-bridge/g) || []).length, 1);
  assert.equal(db['org.gnome.shell.keybindings|toggle-message-tray'], "['<Super>m']");
});

test('setup-gnome: GNOME 43 (Zorin 17) instala a extensão legada', () => {
  const s = sandbox('43.9');
  s.run();
  const ext = path.join(s.home, '.local/share/gnome-shell/extensions/mv-clipboard-bridge@mv.local');
  const code = fs.readFileSync(path.join(ext, 'extension.js'), 'utf8');
  assert.match(code, /function init\(\)/);
  assert.doesNotMatch(code, /^import /m);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ext, 'metadata.json'), 'utf8'))['shell-version'], ['43', '44']);
});

test('setup-gnome --no-extension: só o atalho', () => {
  const s = sandbox('46.7');
  s.run('--no-extension');
  assert.ok(!fs.existsSync(path.join(s.home, '.local/share/gnome-shell/extensions')));
  assert.equal(s.db()[`${SLOT}|binding`], '<Super>v');
});

test('setup-gnome: sem gsettings, falha com mensagem clara', () => {
  const bash = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  const r = spawnSync(bash, [path.join(ROOT, 'scripts', 'setup-gnome.sh')], {
    env: { PATH: '/nonexistent', HOME: os.tmpdir() }, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /gsettings não encontrado/);
});

test('setup-gnome: desktop sem os esquemas do GNOME (Xfce/KDE) explica o que fazer e não toca em nada', () => {
  const s = sandbox('46.7');
  s.env.FAKE_GS_NO_GNOME = '1';
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'setup-gnome.sh')], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não tem o esquema de atalhos do GNOME/);
  assert.match(r.stderr, /mv-clipboard-ctl toggle/);
  assert.ok(!fs.existsSync(s.env.FAKE_GS_DB), 'nenhuma configuração foi gravada');
  assert.ok(fs.lstatSync(path.join(s.home, '.local/bin/mv-clipboard-ctl')).isSymbolicLink());
});

test('setup-gnome --binding: usa outro atalho e NÃO mexe no Super+V da bandeja', () => {
  const s = sandbox('46.7');
  s.run('--no-extension', '--binding', '<Control><Alt>v');
  const db = s.db();
  assert.equal(db[`${SLOT}|binding`], '<Control><Alt>v');
  assert.equal(db['org.gnome.shell.keybindings|toggle-message-tray'], undefined);
});

test('setup-gnome: reativa extensões de usuário desligadas e mostra o estado da extensão', () => {
  const s = sandbox('46.7');
  s.env.FAKE_GS_DISABLE_EXT = '1';
  const out = s.run();
  assert.equal(s.db()['org.gnome.shell|disable-user-extensions'], 'false');
  assert.match(out, /Extensões de usuário estavam desativadas: reativei/);
  assert.match(out, /Estado da extensão: State: ACTIVE/);
});

test('setup-gnome: dica de recarga depende da sessão (Xorg: Alt+F2 r; Wayland: novo login)', () => {
  const x = sandbox('46.7');
  x.env.XDG_SESSION_TYPE = 'x11';
  assert.match(x.run(), /Alt\+F2, digite r/);
  const w = sandbox('46.7');
  assert.match(w.run(), /Wayland, SAIA e ENTRE/);
});
