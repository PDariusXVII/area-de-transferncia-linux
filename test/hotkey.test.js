'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HotkeyManager, applyGnomeBinding, parseStringArray, toGVariantArray, KB_PATH, KB_SLOT } = require('../src/hotkey');
const { writeFakeGsettings } = require('./helpers/fake-gsettings');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-hk-'));
const noop = () => {};

function gnomeSession() {
  const dir = tmp();
  process.env.FAKE_GS_DB = path.join(dir, 'gs.json');
  delete process.env.FAKE_GS_NO_GNOME;
  const gsettings = writeFakeGsettings(path.join(dir, 'bin'));
  const db = () => (fs.existsSync(process.env.FAKE_GS_DB) ? JSON.parse(fs.readFileSync(process.env.FAKE_GS_DB, 'utf8')) : {});
  return { session: { type: 'wayland', desktop: 'gnome', tools: { gsettings } }, gsettings, db };
}
function fakeGlobalShortcut({ failOn = [] } = {}) {
  const calls = { register: [], unregister: [] };
  return {
    calls,
    register: (a) => { calls.register.push(a); return !failOn.includes(a); },
    unregister: (a) => { calls.unregister.push(a); },
    unregisterAll: () => { calls.unregister.push('*'); },
  };
}

test('parseStringArray / toGVariantArray', () => {
  assert.deepEqual(parseStringArray('@as []'), []);
  assert.deepEqual(parseStringArray('[]'), []);
  assert.deepEqual(parseStringArray(''), []);
  assert.deepEqual(parseStringArray("['<Super>v', '<Super>m']"), ['<Super>v', '<Super>m']);
  assert.deepEqual(parseStringArray("['/a/b/', '/c/']\n"), ['/a/b/', '/c/']);
  assert.equal(parseStringArray("['a', 1]"), null);
  assert.equal(parseStringArray('lixo'), null);
  assert.equal(toGVariantArray(['a', 'b']), "['a', 'b']");
  assert.equal(toGVariantArray([]), '[]');
});

test('GNOME: apply registra o atalho personalizado e current() lê de volta do sistema', async () => {
  const g = gnomeSession();
  const hk = new HotkeyManager({ globalShortcut: fakeGlobalShortcut(), session: g.session, command: '/x/mv-clipboard-ctl toggle', onTrigger: noop, log: noop });
  assert.equal(hk.mode, 'gnome');
  assert.equal(await hk.current('Super+V'), 'Super+V');            // nada registrado ainda: cai no configurado
  const r = await hk.apply('ctrl+alt+v');
  assert.deepEqual(r, { ok: true, mode: 'gnome', value: 'Ctrl+Alt+V' });
  const db = g.db();
  assert.equal(db['org.gnome.settings-daemon.plugins.media-keys|custom-keybindings'], `['${KB_PATH}']`);
  assert.equal(db[`${KB_SLOT}|binding`], '<Control><Alt>v');
  assert.equal(db[`${KB_SLOT}|name`], 'MV Clipboard');
  assert.equal(db[`${KB_SLOT}|command`], '/x/mv-clipboard-ctl toggle');
  assert.equal(db['org.gnome.shell.keybindings|toggle-message-tray'], undefined);   // outro atalho: não mexe na bandeja
  assert.equal(await hk.current('Super+V'), 'Ctrl+Alt+V');
});

test('GNOME: aplicar Super+V libera o atalho da bandeja de notificações; repetir é idempotente', async () => {
  const g = gnomeSession();
  const hk = new HotkeyManager({ globalShortcut: fakeGlobalShortcut(), session: g.session, command: 'cmd', onTrigger: noop, log: noop });
  await hk.apply('Super+V');
  await hk.apply('Super+V');
  const db = g.db();
  assert.equal(db['org.gnome.shell.keybindings|toggle-message-tray'], "['<Super>m']");
  assert.equal(db['org.gnome.settings-daemon.plugins.media-keys|custom-keybindings'], `['${KB_PATH}']`);
  assert.equal(db[`${KB_SLOT}|binding`], '<Super>v');
});

test('GNOME: preserva atalhos personalizados que já existiam', async () => {
  const g = gnomeSession();
  fs.writeFileSync(process.env.FAKE_GS_DB, JSON.stringify({
    'org.gnome.settings-daemon.plugins.media-keys|custom-keybindings': "['/org/x/custom0/']",
  }));
  await applyGnomeBinding({ gsettings: g.gsettings, accel: 'Alt+V', command: 'cmd' });
  assert.equal(g.db()['org.gnome.settings-daemon.plugins.media-keys|custom-keybindings'], `['/org/x/custom0/', '${KB_PATH}']`);
});

test('GNOME: lista de atalhos ilegível -> erro e NADA é alterado', async () => {
  const g = gnomeSession();
  const weird = "[('x', 1)]";
  fs.writeFileSync(process.env.FAKE_GS_DB, JSON.stringify({ 'org.gnome.settings-daemon.plugins.media-keys|custom-keybindings': weird }));
  const hk = new HotkeyManager({ globalShortcut: fakeGlobalShortcut(), session: g.session, command: 'cmd', onTrigger: noop, log: noop });
  const r = await hk.apply('Alt+V');
  assert.equal(r.ok, false);
  assert.match(r.error, /Não entendi a lista de atalhos/);
  assert.deepEqual(g.db(), { 'org.gnome.settings-daemon.plugins.media-keys|custom-keybindings': weird });
});

test('atalho inválido é recusado antes de tocar em qualquer coisa', async () => {
  const g = gnomeSession();
  const hk = new HotkeyManager({ globalShortcut: fakeGlobalShortcut(), session: g.session, command: 'cmd', onTrigger: noop, log: noop });
  const r = await hk.apply('Shift+V');
  assert.equal(r.ok, false);
  assert.match(r.error, /Ctrl, Alt ou Super/);
  assert.deepEqual(g.db(), {});
});

test('gsettings quebrado -> erro claro, sem lançar exceção', async () => {
  const session = { type: 'wayland', desktop: 'gnome', tools: { gsettings: '/bin/false' } };
  const hk = new HotkeyManager({ globalShortcut: fakeGlobalShortcut(), session, command: 'cmd', onTrigger: noop, log: noop });
  const r = await hk.apply('Alt+V');
  assert.equal(r.ok, false);
  assert.match(r.error, /gsettings/);
});

test('X11 fora do GNOME: globalShortcut; trocar desregistra o anterior; conflito mantém o antigo', async () => {
  const gs = fakeGlobalShortcut({ failOn: ['Ctrl+Alt+V'] });
  const session = { type: 'x11', desktop: 'xfce', tools: { gsettings: null } };
  const hk = new HotkeyManager({ globalShortcut: gs, session, command: 'cmd', onTrigger: noop, log: noop });
  assert.equal(hk.mode, 'globalShortcut');
  assert.deepEqual(hk.startup('Super+V'), { ok: true, mode: 'globalShortcut', value: 'Super+V' });
  assert.deepEqual(await hk.apply('Alt+V'), { ok: true, mode: 'globalShortcut', value: 'Alt+V' });
  assert.deepEqual(gs.calls.unregister, ['Super+V']);
  const conflict = await hk.apply('Ctrl+Alt+V');
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /já está em uso/);
  assert.equal(hk.registered, 'Alt+V');                       // continua com o anterior
  assert.equal(gs.calls.register.at(-1), 'Alt+V');            // e ele foi re-registrado
  assert.equal(await hk.current('Alt+V'), 'Alt+V');
});

test('Wayland fora do GNOME: modo manual com instrução', async () => {
  const session = { type: 'wayland', desktop: 'kde', tools: { gsettings: null } };
  const gs = fakeGlobalShortcut();
  const hk = new HotkeyManager({ globalShortcut: gs, session, command: 'cmd', onTrigger: noop, log: noop });
  assert.equal(hk.mode, 'manual');
  assert.deepEqual(hk.startup('Super+V'), { ok: true, mode: 'manual' });
  const r = await hk.apply('Ctrl+Alt+V');
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'manual');
  assert.match(r.note, /mv-clipboard-ctl toggle/);
  assert.deepEqual(gs.calls.register, []);
});

test('forceGlobal (MVCLIP_FORCE_GLOBALSHORTCUT) usa globalShortcut mesmo no GNOME', () => {
  const gs = fakeGlobalShortcut();
  const hk = new HotkeyManager({ globalShortcut: gs, session: { type: 'wayland', desktop: 'gnome', tools: { gsettings: '/x' } }, command: 'c', onTrigger: noop, log: noop, forceGlobal: true });
  assert.equal(hk.mode, 'globalShortcut');
  hk.startup('Super+V');
  assert.deepEqual(gs.calls.register, ['Super+V']);
});

test('GNOME no startup: não registra globalShortcut', () => {
  const gs = fakeGlobalShortcut();
  const hk = new HotkeyManager({ globalShortcut: gs, session: { type: 'x11', desktop: 'gnome', tools: { gsettings: '/x' } }, command: 'c', onTrigger: noop, log: noop });
  assert.deepEqual(hk.startup('Super+V'), { ok: true, mode: 'gnome' });
  assert.deepEqual(gs.calls.register, []);
});
