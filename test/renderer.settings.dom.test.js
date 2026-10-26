'use strict';
// Tela de Configurações no DOM (precisa do jsdom; sem ele os testes são pulados).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch { /* jsdom não instalado */ }
const skip = JSDOM ? false : 'jsdom não instalado (npm i -D jsdom para habilitar)';

const root = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');

const BASE = {
  hotkey: 'Super+V', hotkeyMode: 'gnome', autostart: false, showOnStart: false, closeOnBlur: true,
  position: 'bottom-right', maxItems: 50, opacity: 0.88, accent: '#60CDFF', session: { type: 'wayland', desktop: 'gnome' },
};

/** Sobe o DOM completo com um mvclip falso. `reply(patch)` decide a resposta de setSettings. */
async function boot({ settings = BASE, reply } = {}) {
  const calls = [];
  let pushSettings = () => {};
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  let state = { ...settings };
  window.mvclip = {
    list: async () => [], paste: async () => {}, pin: async () => {}, remove: async () => {},
    clear: async () => { calls.push(['clear']); }, hide: () => { calls.push(['hide']); },
    onChanged: () => {}, onShown: (cb) => { window.__fireShown = cb; },
    getSettings: async () => state,
    setSettings: async (patch) => {
      calls.push(['set', patch]);
      if (reply) return reply(patch, state);
      state = { ...state, ...patch };
      return { ok: true, settings: state, errors: {}, warnings: [] };
    },
    onSettingsChanged: (cb) => { pushSettings = cb; },
    clearAll: async () => { calls.push(['clearAll']); },
    quit: () => { calls.push(['quit']); },
  };
  window.eval(rendererJs);
  window.eval(settingsJs);
  await new Promise((r) => setTimeout(r, 10));
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const ev = (type, init) => new window.Event(type, { bubbles: true, ...init });
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (init) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const openSettings = async () => { click($('btn-settings')); await new Promise((r) => setTimeout(r, 10)); };
  // Objetos criados dentro do jsdom têm outro Object.prototype: normaliza via JSON para comparar valores.
  const sets = () => calls.filter((c) => c[0] === 'set').map((c) => JSON.parse(JSON.stringify(c[1])));
  return { window, doc, $, ev, click, key, calls, sets, openSettings, push: (s) => pushSettings(s), get state() { return state; } };
}
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('a engrenagem abre a tela e os controles refletem as configurações', { skip }, async () => {
  const t = await boot({ settings: { ...BASE, hotkey: 'Ctrl+Alt+V', autostart: true, position: 'cursor', maxItems: 100, opacity: 0.7, accent: '#C58AF9', showOnStart: true, closeOnBlur: false } });
  assert.equal(t.doc.body.dataset.view, undefined);
  await t.openSettings();
  assert.equal(t.doc.body.dataset.view, 'settings');
  assert.equal(t.$('hotkey-current').textContent, 'Ctrl + Alt + V');
  assert.equal(t.$('hotkey-preset').value, 'Ctrl+Alt+V');
  assert.equal(t.$('opt-autostart').checked, true);
  assert.equal(t.$('opt-showOnStart').checked, true);
  assert.equal(t.$('opt-closeOnBlur').checked, false);
  assert.equal(t.$('opt-position').value, 'cursor');
  assert.equal(t.$('opt-maxItems').value, '100');
  assert.equal(t.$('opt-opacity').value, '70');
  assert.equal(t.$('opt-opacity-value').textContent, '70%');
  const checked = [...t.doc.querySelectorAll('.swatch')].filter((s) => s.getAttribute('aria-checked') === 'true');
  assert.deepEqual(checked.map((s) => s.dataset.color), ['#C58AF9']);
  assert.match(t.$('hotkey-help').textContent, /Aplicado no GNOME/);
});

test('atalho fora da lista aparece como "Personalizado"; maxItems fora da lista ganha opção própria', { skip }, async () => {
  const t = await boot({ settings: { ...BASE, hotkey: 'Alt+F9', maxItems: 75 } });
  await t.openSettings();
  assert.equal(t.$('hotkey-preset').value, '');
  assert.equal(t.$('opt-maxItems').value, '75');
  assert.equal(t.$('hotkey-current').textContent, 'Alt + F9');
});

test('cada controle envia o patch certo', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  const change = async (el, setter) => { setter(el); el.dispatchEvent(t.ev('change')); await wait(); };
  await change(t.$('opt-autostart'), (e) => { e.checked = true; });
  await change(t.$('opt-showOnStart'), (e) => { e.checked = true; });
  await change(t.$('opt-closeOnBlur'), (e) => { e.checked = false; });
  await change(t.$('opt-position'), (e) => { e.value = 'cursor'; });
  await change(t.$('opt-maxItems'), (e) => { e.value = '200'; });
  await change(t.$('hotkey-preset'), (e) => { e.value = 'Super+Shift+V'; });
  await change(t.$('opt-opacity'), (e) => { e.value = '70'; });
  t.click(t.doc.querySelector('.swatch[data-color="#7BD88F"]'));
  await wait();
  assert.deepEqual(t.sets(), [
    { autostart: true }, { showOnStart: true }, { closeOnBlur: false }, { position: 'cursor' }, { maxItems: 200 },
    { hotkey: 'Super+Shift+V' }, { opacity: 0.7 }, { accent: '#7BD88F' },
  ]);
});

test('visual: o slider mostra prévia na hora e as cores viram variáveis CSS', { skip }, async () => {
  const t = await boot({ settings: { ...BASE, accent: '#F28B82', opacity: 0.6 } });
  assert.equal(t.doc.documentElement.style.getPropertyValue('--accent'), '#F28B82');      // aplicado já ao carregar
  assert.equal(t.doc.documentElement.style.getPropertyValue('--mica-bg'), 'rgba(32, 32, 32, 0.6)');
  await t.openSettings();
  const range = t.$('opt-opacity');
  range.value = '50';
  range.dispatchEvent(t.ev('input'));
  assert.equal(t.doc.documentElement.style.getPropertyValue('--mica-bg'), 'rgba(32, 32, 32, 0.5)');
  assert.equal(t.$('opt-opacity-value').textContent, '50%');
  assert.deepEqual(t.sets(), []);                                                          // prévia não salva
});

test('erro do processo principal: mostra a mensagem e devolve o controle ao valor real', { skip }, async () => {
  const t = await boot({ reply: (patch, state) => ({ ok: false, settings: state, errors: { hotkey: 'já está em uso por outro atalho do sistema.' }, warnings: [] }) });
  await t.openSettings();
  const sel = t.$('hotkey-preset');
  sel.value = 'Ctrl+Alt+V';
  sel.dispatchEvent(t.ev('change'));
  await wait();
  assert.equal(t.$('settings-error').classList.contains('hidden'), false);
  assert.match(t.$('settings-error').textContent, /hotkey: já está em uso/);
  assert.equal(sel.value, 'Super+V');
  assert.equal(t.$('hotkey-current').textContent, 'Super + V');
});

test('avisos (ex.: Wayland fora do GNOME) aparecem na nota', { skip }, async () => {
  const t = await boot({ reply: (patch, state) => ({ ok: true, settings: { ...state, ...patch, hotkeyMode: 'manual' }, errors: {}, warnings: ['Registre o comando no compositor.'] }) });
  await t.openSettings();
  t.$('opt-autostart').checked = true;
  t.$('opt-autostart').dispatchEvent(t.ev('change'));
  await wait();
  assert.equal(t.$('settings-note').classList.contains('hidden'), false);
  assert.equal(t.$('settings-note').textContent, 'Registre o comando no compositor.');
  assert.match(t.$('hotkey-help').textContent, /Wayland fora do GNOME/);
});

test('gravador de atalho: combinação válida é enviada; só modificador espera; Esc cancela sem fechar a tela', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  const rec = t.$('hotkey-record');
  t.click(rec);
  assert.equal(rec.classList.contains('is-recording'), true);
  t.key({ code: 'ControlLeft', key: 'Control', ctrlKey: true });                  // só modificador: ignora
  assert.equal(rec.classList.contains('is-recording'), true);
  t.key({ code: 'KeyV', key: 'V', shiftKey: true });                              // Shift+V não vale
  assert.match(t.$('settings-error').textContent, /Ctrl, Alt ou Super/);
  assert.equal(rec.classList.contains('is-recording'), true);
  t.key({ code: 'Escape', key: 'Escape' });                                       // cancela
  assert.equal(rec.classList.contains('is-recording'), false);
  assert.equal(t.doc.body.dataset.view, 'settings');                              // Esc NÃO saiu da tela
  assert.deepEqual(t.sets(), []);

  t.click(rec);
  t.key({ code: 'KeyV', key: 'v', ctrlKey: true, altKey: true });
  await wait();
  assert.equal(rec.classList.contains('is-recording'), false);
  assert.deepEqual(t.sets(), [{ hotkey: 'Ctrl+Alt+V' }]);
  assert.equal(t.$('hotkey-current').textContent, 'Ctrl + Alt + V');
});

test('acceleratorFromEvent: layout independente, ordem canônica e teclas especiais', { skip }, async () => {
  const t = await boot();
  const f = t.window.MVSettings.acceleratorFromEvent;
  assert.equal(f({ code: 'KeyV', metaKey: true }), 'Super+V');
  assert.equal(f({ code: 'KeyC', ctrlKey: true, shiftKey: true, altKey: true, metaKey: true }), 'Ctrl+Alt+Shift+Super+C');
  assert.equal(f({ code: 'Digit5', ctrlKey: true }), 'Ctrl+5');
  assert.equal(f({ code: 'F12', altKey: true }), 'Alt+F12');
  assert.equal(f({ code: 'Space', altKey: true }), 'Alt+Space');
  assert.equal(f({ code: 'ArrowUp', ctrlKey: true }), 'Ctrl+Up');
  assert.equal(f({ code: 'PageDown', metaKey: true }), 'Super+PageDown');
  assert.equal(f({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(f({ code: 'Escape' }), null);
});

test('Esc: com a tela aberta volta ao histórico (sem fechar a janela); no histórico fecha a janela', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  t.key({ key: 'Escape', code: 'Escape' });
  assert.equal(t.doc.body.dataset.view, undefined);
  assert.deepEqual(t.calls.filter((c) => c[0] === 'hide'), []);
  t.key({ key: 'Escape', code: 'Escape' });
  assert.deepEqual(t.calls.filter((c) => c[0] === 'hide'), [['hide']]);
});

test('voltar e reabrir a janela (ui:shown) levam de volta ao histórico', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  t.click(t.$('settings-back'));
  assert.equal(t.doc.body.dataset.view, undefined);
  await t.openSettings();
  await t.window.__fireShown();
  assert.equal(t.doc.body.dataset.view, undefined);
});

test('apagar tudo e encerrar exigem dois cliques', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  t.click(t.$('btn-clear-all'));
  assert.deepEqual(t.calls.filter((c) => c[0] === 'clearAll'), []);
  assert.match(t.$('btn-clear-all').textContent, /Clique de novo/);
  t.click(t.$('btn-clear-all'));
  assert.deepEqual(t.calls.filter((c) => c[0] === 'clearAll'), [['clearAll']]);
  assert.equal(t.$('btn-clear-all').textContent, 'Apagar todo o histórico');
  t.click(t.$('btn-quit'));
  assert.deepEqual(t.calls.filter((c) => c[0] === 'quit'), []);
  t.click(t.$('btn-quit'));
  assert.deepEqual(t.calls.filter((c) => c[0] === 'quit'), [['quit']]);
});

test('mudança vinda de fora (settings:changed) aplica o visual mesmo com a tela fechada', { skip }, async () => {
  const t = await boot();
  t.push({ ...BASE, accent: '#FDD663', opacity: 0.95 });
  assert.equal(t.doc.documentElement.style.getPropertyValue('--accent'), '#FDD663');
  assert.equal(t.doc.documentElement.style.getPropertyValue('--mica-bg'), 'rgba(32, 32, 32, 0.95)');
});

test('setas e Enter não mexem na lista enquanto a tela de configurações está aberta', { skip }, async () => {
  const t = await boot();
  await t.openSettings();
  t.key({ key: 'ArrowDown', code: 'ArrowDown' });
  t.key({ key: 'Enter', code: 'Enter' });
  assert.equal(t.doc.querySelectorAll('.is-selected').length, 0);
  assert.deepEqual(t.calls, []);
});

test('o HTML não usa estilo inline (a CSP style-src self bloquearia)', async () => {
  const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(raw, /\sstyle\s*=/i);
  assert.doesNotMatch(settingsJs, /setAttribute\(['"]style/);
});
