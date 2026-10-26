'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAccelerator, normalizeAccelerator, validateAccelerator, toGnomeBinding, fromGnomeBinding } = require('../src/accelerator');

test('normalizeAccelerator: apelidos, caixa e ordem canônica (Ctrl, Alt, Shift, Super)', () => {
  const cases = {
    'ctrl+alt+v': 'Ctrl+Alt+V', 'Super+V': 'Super+V', 'Meta+v': 'Super+V', 'Win+v': 'Super+V',
    'CommandOrControl+Shift+c': 'Ctrl+Shift+C', 'Control+Option+x': 'Ctrl+Alt+X', 'Super+Ctrl+V': 'Ctrl+Super+V',
    'alt+space': 'Alt+Space', 'Ctrl+f5': 'Ctrl+F5', 'Ctrl+pageup': 'Ctrl+PageUp', 'Super+1': 'Super+1', ' ctrl + v ': 'Ctrl+V',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeAccelerator(input), want, input);
});

test('parseAccelerator rejeita o que não é atalho', () => {
  for (const bad of ['', '  ', 'V+', '+V', 'Ctrl+', 'Foo+V', 'Ctrl+VV', 'Ctrl++', 'Ctrl+F25', 'Ctrl+F0', 'Ctrl+Escape', null, undefined, 42]) {
    assert.equal(parseAccelerator(bad), null, String(bad));
  }
});

test('validateAccelerator: exige Ctrl, Alt ou Super', () => {
  assert.deepEqual(validateAccelerator('ctrl+alt+v'), { ok: true, value: 'Ctrl+Alt+V' });
  assert.equal(validateAccelerator('Alt+Space').ok, true);
  assert.equal(validateAccelerator('Super+PageUp').ok, true);
  const noMod = validateAccelerator('V');
  assert.equal(noMod.ok, false);
  const shiftOnly = validateAccelerator('Shift+V');
  assert.equal(shiftOnly.ok, false);
  assert.match(shiftOnly.error, /Ctrl, Alt ou Super/);
  assert.match(validateAccelerator('lixo').error, /inválido/);
});

test('toGnomeBinding', () => {
  const cases = {
    'Super+V': '<Super>v', 'Ctrl+Alt+V': '<Control><Alt>v', 'Ctrl+Shift+F5': '<Control><Shift>F5', 'Alt+Space': '<Alt>space',
    'Super+PageUp': '<Super>Page_Up', 'Super+PageDown': '<Super>Page_Down', 'Super+1': '<Super>1', 'Ctrl+Alt+Delete': '<Control><Alt>Delete',
    'Ctrl+Super+Left': '<Control><Super>Left',
  };
  for (const [accel, want] of Object.entries(cases)) assert.equal(toGnomeBinding(accel), want, accel);
  assert.throws(() => toGnomeBinding('lixo'), /inválido/);
});

test('fromGnomeBinding aceita variantes do GNOME e faz ida e volta', () => {
  assert.equal(fromGnomeBinding('<Super>v'), 'Super+V');
  assert.equal(fromGnomeBinding("'<Super>v'"), 'Super+V');
  assert.equal(fromGnomeBinding('<Primary><Mod1>x'), 'Ctrl+Alt+X');
  assert.equal(fromGnomeBinding('<Control><Alt>v'), 'Ctrl+Alt+V');
  assert.equal(fromGnomeBinding('<Super>Page_Up'), 'Super+PageUp');
  assert.equal(fromGnomeBinding('<Mod4>space'), 'Super+Space');
  for (const bad of ['', 'disabled', '<Foo>v', '<Super>', null, 7]) assert.equal(fromGnomeBinding(bad), null, String(bad));
  for (const a of ['Super+V', 'Ctrl+Alt+V', 'Ctrl+Shift+F5', 'Alt+Space', 'Super+PageDown', 'Ctrl+Super+Left', 'Alt+9']) {
    assert.equal(fromGnomeBinding(toGnomeBinding(a)), a, a);
  }
});
