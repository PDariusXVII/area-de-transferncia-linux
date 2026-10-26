'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const autostart = require('../src/autostart');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-as-js-'));
const envOf = (home) => ({ HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') });

test('setEnabled(true) cria o .desktop (Exec no launcher do projeto) e isEnabled enxerga', () => {
  const home = tmp();
  const env = envOf(home);
  assert.equal(autostart.isEnabled(env), false);
  assert.equal(autostart.setEnabled(true, { env, appRoot: ROOT }), true);
  const text = fs.readFileSync(autostart.autostartPath(env), 'utf8');
  assert.match(text, /^Type=Application$/m);
  assert.match(text, /^X-GNOME-Autostart-enabled=true$/m);
  assert.ok(text.includes(`Exec=${path.join(ROOT, 'bin', 'mv-clipboard')}\n`));
  assert.doesNotMatch(text, /@EXEC@/);
  assert.equal(autostart.isEnabled(env), true);
  assert.equal(autostart.setEnabled(true, { env, appRoot: ROOT }), true);   // idempotente
});

test('setEnabled(false) remove; remover de novo não dá erro', () => {
  const env = envOf(tmp());
  autostart.setEnabled(true, { env, appRoot: ROOT });
  assert.equal(autostart.setEnabled(false, { env, appRoot: ROOT }), false);
  assert.equal(autostart.isEnabled(env), false);
  assert.equal(autostart.setEnabled(false, { env, appRoot: ROOT }), false);
});

test('prefere ~/.local/bin/mv-clipboard quando é executável', () => {
  const home = tmp();
  const link = path.join(home, '.local', 'bin', 'mv-clipboard');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.writeFileSync(link, '#!/bin/sh\n', { mode: 0o755 });
  const env = envOf(home);
  assert.equal(autostart.resolveExec({ env, appRoot: ROOT }), link);
  autostart.setEnabled(true, { env, appRoot: ROOT });
  assert.ok(fs.readFileSync(autostart.autostartPath(env), 'utf8').includes(`Exec=${link}\n`));
});

test('Exec com espaços ganha aspas; outros caracteres especiais são escapados', () => {
  assert.equal(autostart.quoteExec('/home/u/.local/bin/mv-clipboard'), '/home/u/.local/bin/mv-clipboard');
  assert.equal(autostart.quoteExec('/home/meu usuario/bin/mv'), '"/home/meu usuario/bin/mv"');
  assert.equal(autostart.quoteExec('/a b/$x'), '"/a b/\\$x"');
});

test('isEnabled: Hidden=true e X-GNOME-Autostart-enabled=false contam como desativado', () => {
  const env = envOf(tmp());
  autostart.setEnabled(true, { env, appRoot: ROOT });
  const file = autostart.autostartPath(env);
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${original}Hidden=true\n`);
  assert.equal(autostart.isEnabled(env), false);
  fs.writeFileSync(file, original.replace('enabled=true', 'enabled=false'));
  assert.equal(autostart.isEnabled(env), false);
});

test('o .desktop gerado pelo app é idêntico ao do scripts/autostart.sh', () => {
  const home = tmp();
  const env = envOf(home);
  autostart.setEnabled(true, { env, appRoot: ROOT });
  const fromJs = fs.readFileSync(autostart.autostartPath(env), 'utf8');
  fs.rmSync(autostart.autostartPath(env));
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'autostart.sh'), 'enable'], { env: { ...env, PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(autostart.autostartPath(env), 'utf8'), fromJs);
});
