'use strict';
// Com a flag já presente (launcher/npm start) NÃO pode relançar (evita loop) e deve iniciar normalmente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-nrl-'));
Object.assign(process.env, {
  XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'zorin:GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0',
  XDG_RUNTIME_DIR: runtime, PATH: '/nonexistent',
});
const { installFakeElectron } = require('./helpers/fake-electron');

test('Wayland com --ozone-platform=x11: inicia, usa GNOME (sem globalShortcut) e escuta só a ponte + poll', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-ud-'));
  const env = installFakeElectron({ userData, hasOzoneSwitch: true, ozoneValue: 'x11' });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  require('../main.js');
  await new Promise((r) => setTimeout(r, 150));
  console.log = origLog;
  assert.deepEqual(env.calls.relaunch, []);
  assert.equal(env.windows.length, 1);
  assert.deepEqual(env.calls.shortcuts, []);           // GNOME: atalho é do gsettings
  assert.match(logs.join('\n'), /sessão=wayland desktop=gnome x11=true fontes=\[poll,bridge\]/);
  env.fake.app.emit('before-quit');
  env.restore();
});
