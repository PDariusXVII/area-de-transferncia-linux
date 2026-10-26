'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runDoctor } = require('../src/doctor');

test('doctor roda sem ferramentas e aponta o que falta no GNOME/Wayland', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-doc-'));
  const { session, results } = runDoctor({
    XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'zorin:GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0',
    PATH: '/nonexistent', XDG_RUNTIME_DIR: rt,
  });
  assert.equal(session.desktop, 'gnome');
  const text = results.map((r) => `${r.level}: ${r.msg}`).join('\n');
  assert.match(text, /xdotool ausente/);
  assert.match(text, /gsettings ausente/);
  assert.match(text, /cadeia para colar.*NENHUMA/);
  assert.match(text, /GNOME\/Wayland sem a extensão ativa/);
});

test('doctor reconhece a ponte GNOME ativa pelo batimento', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-doc-'));
  fs.mkdirSync(path.join(rt, 'mv-clipboard'));
  fs.writeFileSync(path.join(rt, 'mv-clipboard', 'shell.alive'), String(Date.now()));
  const { results } = runDoctor({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', WAYLAND_DISPLAY: 'w', PATH: '/nonexistent', XDG_RUNTIME_DIR: rt });
  const text = results.map((r) => r.msg).join('\n');
  assert.match(text, /Ponte da extensão GNOME ativa/);
  assert.match(text, /cadeia para colar \(Ctrl\+V\): bridge/);
});

// ---------- atalho do GNOME configurável, Node e autostart ----------
const { applyGnomeBinding } = require('../src/hotkey');
const { writeFakeGsettings } = require('./helpers/fake-gsettings');
const autostart = require('../src/autostart');

function gnomeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-doc-gs-'));
  process.env.FAKE_GS_DB = path.join(dir, 'gs.json');
  const gsettings = writeFakeGsettings(path.join(dir, 'bin'));
  const env = {
    XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'zorin:GNOME', WAYLAND_DISPLAY: 'w', DISPLAY: ':0',
    PATH: path.join(dir, 'bin'), XDG_RUNTIME_DIR: dir, HOME: dir, XDG_CONFIG_HOME: path.join(dir, '.config'),
  };
  const text = () => runDoctor(env).results.map((r) => `${r.level}: ${r.msg}`).join('\n');
  return { env, gsettings, text };
}

test('doctor GNOME: sem atalho registrado e Super+V ainda da bandeja -> duas falhas com a solução', () => {
  const g = gnomeEnv();
  const text = g.text();
  assert.match(text, /fail: Atalho personalizado do MV Clipboard não está registrado/);
  assert.match(text, /fail: Super\+V ainda pertence ao GNOME/);
});

test('doctor GNOME: após aplicar Super+V tudo certo', async () => {
  const g = gnomeEnv();
  await applyGnomeBinding({ gsettings: g.gsettings, accel: 'Super+V', command: '/x/mv-clipboard-ctl toggle' });
  const text = g.text();
  assert.match(text, /ok: Atalho do MV Clipboard: Super\+V/);
  assert.match(text, /ok: Super\+V livre no GNOME/);
  assert.doesNotMatch(text, /fail: (Atalho|Super)/);   // (a cadeia de colagem pode falhar: PATH isolado sem xdotool)
});

test('doctor GNOME: atalho trocado (Ctrl+Alt+V) convive com o Super+V da bandeja', async () => {
  const g = gnomeEnv();
  await applyGnomeBinding({ gsettings: g.gsettings, accel: 'Ctrl+Alt+V', command: 'cmd' });
  const text = g.text();
  assert.match(text, /ok: Atalho do MV Clipboard: Ctrl\+Alt\+V/);
  assert.match(text, /sem conflito/);
  assert.doesNotMatch(text, /Super\+V ainda pertence/);
});

test('doctor: Node e inicialização automática', () => {
  const g = gnomeEnv();
  assert.match(g.text(), /Node\.js v\d+\.\d+\.\d+ ok \(>= 22\.12\.0\)/);
  assert.match(g.text(), /warn: Inicialização automática desativada/);
  autostart.setEnabled(true, { env: g.env, appRoot: path.join(__dirname, '..') });
  assert.match(g.text(), /ok: Inicialização automática ativa/);
});
