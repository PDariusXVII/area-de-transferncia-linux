'use strict';
// Teste de DOM do renderer (precisa do jsdom: `npm i -D jsdom`; sem ele, o teste é pulado).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch { /* jsdom não instalado */ }
const skip = JSDOM ? false : 'jsdom não instalado (npm i -D jsdom para habilitar)';

const root = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="renderer\.js"><\/script>/, '');
const code = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

const ID = (n) => String(n).repeat(40).slice(0, 40);
const ITEMS = [
  { id: ID(1), kind: 'text', pinned: true, text: 'void main() {\n  runApp(const MyApp());\n}\n// código', chars: 40 },
  { id: ID(2), kind: 'text', pinned: false, text: 'Reunião às 15h <img src=x onerror="window.__xss=1"> com o time', chars: 60 },
  { id: ID(3), kind: 'image', pinned: false, width: 1920, height: 1080, url: 'file:///tmp/x/images/abc.png' },
];

/** Sobe o DOM com um window.mvclip falso e executa renderer.js. */
async function boot(initial = ITEMS) {
  const calls = [];
  let shown = () => {};
  let changed = () => {};
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function scrollIntoView() {}; // jsdom não implementa
  window.mvclip = {
    list: async () => initial,
    paste: async (id) => { calls.push(['paste', id]); },
    pin: async (id) => { calls.push(['pin', id]); },
    remove: async (id) => { calls.push(['remove', id]); },
    clear: async () => { calls.push(['clear']); },
    hide: () => { calls.push(['hide']); },
    onChanged: (cb) => { changed = cb; },
    onShown: (cb) => { shown = cb; },
  };
  window.eval(code);
  await new Promise((r) => setTimeout(r, 10));
  return { window, doc: window.document, calls, fireShown: () => shown(), fireChanged: (items) => changed(items) };
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const key = (win, k) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('renderiza um card por item, com rótulos, fixado e imagem', { skip }, async () => {
  const { doc } = await boot();
  const cards = [...doc.querySelectorAll('#list > [data-id]')];
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.dataset.id), ITEMS.map((i) => i.id));
  assert.match(cards[0].textContent, /Texto/);
  assert.ok(cards[0].querySelector('svg.accent-text'), 'selo de fixado no item fixado');
  assert.equal(cards[1].querySelector('svg.accent-text'), null);
  assert.match(cards[2].textContent, /Imagem/);
  assert.equal(cards[2].querySelector('img').getAttribute('src'), 'file:///tmp/x/images/abc.png');
  assert.match(cards[2].textContent, /1920×1080/);
  assert.equal(doc.getElementById('empty').classList.contains('hidden'), true);
});

test('texto do usuário nunca vira HTML (sem injeção)', { skip }, async () => {
  const { doc, window } = await boot();
  const card = doc.querySelector(`[data-id="${ID(2)}"]`);
  assert.equal(card.querySelector('[data-slot="body"] img'), null);
  assert.match(card.querySelector('[data-slot="body"]').textContent, /<img src=x onerror=/);
  assert.equal(window.__xss, undefined);
});

test('texto com cara de código usa o bloco monoespaçado; texto comum usa parágrafo', { skip }, async () => {
  const { doc } = await boot();
  assert.ok(doc.querySelector(`[data-id="${ID(1)}"] [data-slot="body"] .font-mono`));
  assert.ok(doc.querySelector(`[data-id="${ID(2)}"] [data-slot="body"] p.line-clamp-3`));
});

test('clicar no card cola; botões de ação não colam', { skip }, async () => {
  const { doc, calls } = await boot();
  const card = doc.querySelector(`[data-id="${ID(2)}"]`);
  click(card.querySelector('[data-slot="body"]'));
  click(card.querySelector('button[data-act="pin"]'));
  click(card.querySelector('button[data-act="delete"]'));
  click(card.querySelector('.menu [data-act="pin"]'));
  click(card.querySelector('.menu [data-act="paste-plain"]'));
  assert.deepEqual(calls, [['paste', ID(2)], ['pin', ID(2)], ['remove', ID(2)], ['pin', ID(2)], ['paste', ID(2)]]);
});

test('menu: "colar como texto simples" só em texto; sincronizar fica desativado', { skip }, async () => {
  const { doc } = await boot();
  assert.ok(doc.querySelector(`[data-id="${ID(2)}"] [data-act="paste-plain"]`));
  assert.equal(doc.querySelector(`[data-id="${ID(3)}"] [data-act="paste-plain"]`), null);
  assert.equal(doc.querySelector(`[data-id="${ID(2)}"] [data-act="sync"]`).getAttribute('aria-disabled'), 'true');
  assert.match(doc.querySelector(`[data-id="${ID(1)}"] .menu`).textContent, /Desafixar item/);
  assert.match(doc.querySelector(`[data-id="${ID(2)}"] .menu`).textContent, /Fixar item/);
});

test('clicar em "sincronizar" (desativado) não cola nem apaga nada', { skip }, async () => {
  const { doc, calls } = await boot();
  click(doc.querySelector(`[data-id="${ID(2)}"] [data-act="sync"]`));
  assert.deepEqual(calls, []);
});

test('teclado: setas, Enter cola, Delete remove, Esc fecha', { skip }, async () => {
  const { doc, window, calls } = await boot();
  key(window, 'ArrowDown');
  key(window, 'ArrowDown');
  assert.equal(doc.querySelectorAll('.is-selected').length, 1);
  assert.equal(doc.querySelector('.is-selected').dataset.id, ID(2));
  key(window, 'Enter');
  key(window, 'Delete');
  key(window, 'ArrowUp');
  key(window, 'Enter');
  key(window, 'Escape');
  assert.deepEqual(calls, [['paste', ID(2)], ['remove', ID(2)], ['paste', ID(1)], ['hide']]);
});

test('lista vazia mostra o estado vazio; "Limpar tudo" chama clear', { skip }, async () => {
  const { doc, calls, fireChanged } = await boot([]);
  const empty = doc.getElementById('empty');
  assert.equal(empty.classList.contains('hidden'), false);
  assert.equal(empty.classList.contains('flex'), true);
  fireChanged(ITEMS.slice(0, 1));
  assert.equal(empty.classList.contains('hidden'), true);
  assert.equal(doc.querySelectorAll('#list > [data-id]').length, 1);
  click(doc.getElementById('btn-clear'));
  assert.deepEqual(calls, [['clear']]);
});

test('ao abrir a janela (ui:shown) recarrega a lista e limpa a seleção', { skip }, async () => {
  const { doc, window, fireShown } = await boot(ITEMS.slice(0, 1));
  window.mvclip.list = async () => ITEMS;
  key(window, 'ArrowDown');
  assert.equal(doc.querySelectorAll('.is-selected').length, 1);
  await fireShown();
  assert.equal(doc.querySelectorAll('#list > [data-id]').length, 3);
  assert.equal(doc.querySelectorAll('.is-selected').length, 0);
});

test('o HTML não depende de CDN nem de fontes externas e tem CSP restritiva', async () => {
  const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(raw, /https?:\/\//);
  assert.match(raw, /Content-Security-Policy/);
  assert.match(raw, /<link rel="stylesheet" href="styles\.css">/);
  const css = fs.readFileSync(path.join(root, 'input.css'), 'utf8');
  assert.doesNotMatch(css, /@import\s+url\(/);
  assert.doesNotMatch(css, /unsplash/);
});
