'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isTerminalClass, simulatePaste, detectTerminalX11 } = require('../src/paste');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-paste-'));

/** Cria um executável falso que registra os argumentos recebidos. */
function fakeTool(dir, name, { exitCode = 0, stdout = '' } = {}) {
  const log = path.join(dir, `${name}.log`);
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\n${stdout ? `echo "${stdout}"\n` : ''}exit ${exitCode}\n`, { mode: 0o755 });
  return { bin, read: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('isTerminalClass', () => {
  for (const c of ['Gnome-terminal', 'kitty', 'Alacritty', 'org.gnome.Console', 'org.gnome.Ptyxis', 'konsole', 'XTerm']) assert.equal(isTerminalClass(c), true, c);
  for (const c of ['firefox', 'Code', 'org.gnome.Nautilus', 'libreoffice-writer', '']) assert.equal(isTerminalClass(c), false, c);
});

test('xdotool: Ctrl+V normal e Ctrl+Shift+V em terminal', async () => {
  const dir = tmp();
  const x = fakeTool(dir, 'xdotool');
  const tools = { xdotool: x.bin };
  assert.equal(await simulatePaste({ chain: ['xdotool'], tools, terminal: false }), 'xdotool');
  assert.equal(await simulatePaste({ chain: ['xdotool'], tools, terminal: true }), 'xdotool');
  assert.deepEqual(x.read(), ['key --clearmodifiers ctrl+v', 'key --clearmodifiers ctrl+shift+v']);
});

test('ydotool usa códigos de tecla do kernel (Ctrl=29, V=47, Shift=42)', async () => {
  const dir = tmp();
  const y = fakeTool(dir, 'ydotool');
  const tools = { ydotool: y.bin };
  await simulatePaste({ chain: ['ydotool'], tools, terminal: false });
  await simulatePaste({ chain: ['ydotool'], tools, terminal: true });
  assert.deepEqual(y.read(), ['key 29:1 47:1 47:0 29:0', 'key 29:1 42:1 47:1 47:0 42:0 29:0']);
});

test('wtype', async () => {
  const dir = tmp();
  const w = fakeTool(dir, 'wtype');
  await simulatePaste({ chain: ['wtype'], tools: { wtype: w.bin }, terminal: false });
  assert.deepEqual(w.read(), ['-M ctrl v -m ctrl']);
});

test('cadeia: pula estratégia que falha e usa a próxima', async () => {
  const dir = tmp();
  const bad = fakeTool(dir, 'ydotool', { exitCode: 1 });
  const good = fakeTool(dir, 'xdotool');
  const used = await simulatePaste({ chain: ['ydotool', 'xdotool'], tools: { ydotool: bad.bin, xdotool: good.bin }, terminal: false });
  assert.equal(used, 'xdotool');
  assert.equal(bad.read().length, 1);
});

test('cadeia vazia ou estratégia inexistente retorna null', async () => {
  assert.equal(await simulatePaste({ chain: [], tools: {} }), null);
  assert.equal(await simulatePaste({ chain: ['inexistente'], tools: {} }), null);
});

test('bridge envia mensagem de colar para a extensão e não chama mais nada', async () => {
  const sent = [];
  const mailbox = { sendToShell: (m) => sent.push(m) };
  const used = await simulatePaste({ chain: ['bridge', 'xdotool'], tools: {}, mailbox, terminal: false });
  assert.equal(used, 'bridge');
  assert.deepEqual(sent, [{ type: 'paste', shift: false }]);
});

test('detectTerminalX11 lê a classe da janela em foco', async () => {
  const dir = tmp();
  const term = fakeTool(dir, 'xdotool', { stdout: 'Gnome-terminal' });
  assert.equal(await detectTerminalX11({ xdotool: term.bin }), true);
  const dir2 = tmp();
  const ff = fakeTool(dir2, 'xdotool', { stdout: 'firefox' });
  assert.equal(await detectTerminalX11({ xdotool: ff.bin }), false);
  assert.equal(await detectTerminalX11({}), false);
});
