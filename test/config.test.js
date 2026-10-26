'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SCHEMA, DEFAULTS, sanitize, loadConfig, saveConfig } = require('../src/config');
const { Settings } = require('../src/settings');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-cfg-'));

test('padrões', () => {
  assert.equal(DEFAULTS.hotkey, 'Super+V');
  assert.equal(DEFAULTS.maxItems, 50);
  assert.equal(DEFAULTS.opacity, 0.88);
  assert.equal(DEFAULTS.accent, '#60CDFF');
  assert.equal(DEFAULTS.closeOnBlur, true);
  assert.equal(DEFAULTS.showOnStart, false);
  assert.equal(DEFAULTS.position, 'bottom-right');
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.ok(!('autostart' in SCHEMA), 'autostart é lido do disco (arquivo .desktop), não do config.json');
});

test('sanitize: aceita valores válidos e normaliza o atalho', () => {
  const { clean, errors } = sanitize({ maxItems: 100, opacity: 0.4, accent: '#AABBCC', position: 'cursor', hotkey: 'ctrl+alt+v', closeOnBlur: false });
  assert.deepEqual(errors, {});
  assert.deepEqual(clean, { maxItems: 100, opacity: 0.4, accent: '#AABBCC', position: 'cursor', hotkey: 'Ctrl+Alt+V', closeOnBlur: false });
});

test('sanitize: rejeita tipo errado, fora do intervalo, enum, formato, atalho e chave desconhecida', () => {
  const { clean, errors } = sanitize({
    maxItems: 4, opacity: 0.3, accent: '#12345', position: 'left', hotkey: 'Shift+V', closeOnBlur: 'sim', pollMs: 50, bogus: 1,
  });
  assert.deepEqual(clean, {});
  assert.deepEqual(Object.keys(errors).sort(), ['accent', 'bogus', 'closeOnBlur', 'hotkey', 'maxItems', 'opacity', 'pollMs', 'position']);
  assert.match(errors.maxItems, /fora do intervalo/);
  assert.match(errors.position, /bottom-right, cursor/);
  assert.match(errors.hotkey, /Ctrl, Alt ou Super/);
  assert.match(errors.bogus, /desconhecida/);
});

test('sanitize: inteiro, NaN, string numérica e objeto inválido', () => {
  assert.ok(sanitize({ maxItems: 50.5 }).errors.maxItems);
  assert.ok(sanitize({ maxItems: '50' }).errors.maxItems);
  assert.ok(sanitize({ opacity: NaN }).errors.opacity);
  assert.ok(sanitize({ maxItems: 501 }).errors.maxItems);
  assert.equal(sanitize({ maxItems: 500 }).clean.maxItems, 500);
  assert.ok(sanitize(null).errors._);
  assert.ok(sanitize([1]).errors._);
});

test('loadConfig: ignora valores inválidos/desconhecidos e aplica os bons', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ maxItems: 100, opacity: 5, accent: 'azul', hotkey: 'alt+v', lixo: true }));
  const cfg = loadConfig(dir);
  assert.equal(cfg.maxItems, 100);
  assert.equal(cfg.opacity, 0.88);
  assert.equal(cfg.accent, '#60CDFF');
  assert.equal(cfg.hotkey, 'Alt+V');
  assert.ok(!('lixo' in cfg));
});

test('loadConfig: arquivo ausente ou corrompido usa os padrões', () => {
  assert.deepEqual(loadConfig(tmp()), { ...DEFAULTS });
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ não é json');
  assert.deepEqual(loadConfig(dir), { ...DEFAULTS });
});

test('saveConfig: atômico, 0600, só chaves conhecidas, ida e volta', () => {
  const dir = tmp();
  saveConfig(dir, { ...DEFAULTS, maxItems: 75, extra: 'x' });
  const file = path.join(dir, 'config.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.maxItems, 75);
  assert.ok(!('extra' in raw));
  assert.equal(loadConfig(dir).maxItems, 75);
});

test('Settings: objeto vivo, commit devolve só o que mudou, grava e emite evento', () => {
  const dir = tmp();
  const s = new Settings(dir);
  const live = s.cfg;
  const events = [];
  s.on('changed', (c) => events.push(c));
  assert.deepEqual(s.commit({ maxItems: 50 }), {});          // igual ao padrão: nada muda
  assert.equal(events.length, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'config.json')));
  assert.deepEqual(s.commit({ maxItems: 80, opacity: 0.6 }), { maxItems: 80, opacity: 0.6 });
  assert.equal(live.maxItems, 80);                           // mesma referência: quem guardou `cfg` enxerga
  assert.deepEqual(events, [{ maxItems: 80, opacity: 0.6 }]);
  assert.equal(new Settings(dir).cfg.opacity, 0.6);          // persistiu
});
