'use strict';
// Em sessão Wayland o app deve reiniciar UMA vez com --ozone-platform=x11 (XWayland).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

Object.assign(process.env, {
  XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'zorin:GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0',
  XDG_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-rl-')),
});
delete process.env.MVCLIP_NATIVE_WAYLAND;
const { installFakeElectron } = require('./helpers/fake-electron');

test('Wayland sem a flag: relança com --ozone-platform=x11 e não inicia o app', () => {
  const env = installFakeElectron({ userData: os.tmpdir(), hasOzoneSwitch: false });
  require('../main.js');
  assert.equal(env.calls.relaunch.length, 1);
  assert.ok(env.calls.relaunch[0].args.includes('--ozone-platform=x11'));
  assert.deepEqual(env.calls.exit, [0]);
  assert.equal(env.windows.length, 0);
  env.restore();
});
