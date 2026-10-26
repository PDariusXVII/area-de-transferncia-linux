'use strict';
// bin/mv-clipboard: resolve o link simbólico, força XWayland e respeita as variáveis MVCLIP_*.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function project({ where = 'dist' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-launch-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules/electron/dist'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'bin', 'mv-clipboard'), path.join(dir, 'bin', 'mv-clipboard'));
  fs.chmodSync(path.join(dir, 'bin', 'mv-clipboard'), 0o755);
  const fake = where === 'dist' ? 'node_modules/electron/dist/electron' : 'node_modules/.bin/electron';
  fs.writeFileSync(path.join(dir, fake), `#!/bin/sh\necho ${where}\nfor a in "$@"; do echo "$a"; done\n`, { mode: 0o755 });
  const link = path.join(dir, 'mv-link');
  fs.symlinkSync(path.join(dir, 'bin', 'mv-clipboard'), link);
  const run = (env = {}, ...args) => execFileSync(link, args, { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).trim().split('\n');
  return { dir, run };
}

test('inicia o Electron do projeto (via symlink) com --ozone-platform=x11', () => {
  const p = project();
  assert.deepEqual(p.run(), ['dist', fs.realpathSync(p.dir), '--ozone-platform=x11']);
});

test('repassa argumentos (ex.: --show)', () => {
  const p = project();
  assert.deepEqual(p.run({}, '--show'), ['dist', fs.realpathSync(p.dir), '--ozone-platform=x11', '--show']);
});

test('MVCLIP_NO_SANDBOX acrescenta --no-sandbox; MVCLIP_NATIVE_WAYLAND não força X11', () => {
  const p = project();
  assert.deepEqual(p.run({ MVCLIP_NO_SANDBOX: '1' }), ['dist', fs.realpathSync(p.dir), '--ozone-platform=x11', '--no-sandbox']);
  assert.deepEqual(p.run({ MVCLIP_NATIVE_WAYLAND: '1' }), ['dist', fs.realpathSync(p.dir)]);
});

test('prefere o binário direto (não depende de `node` no PATH) e cai para .bin/electron se faltar', () => {
  const dist = project({ where: 'dist' });
  assert.equal(dist.run()[0], 'dist');
  const bin = project({ where: 'bin' });
  assert.equal(bin.run()[0], 'bin');
});
