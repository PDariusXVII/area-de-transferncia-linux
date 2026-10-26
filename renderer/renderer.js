'use strict';

// Ícones: mesmos SVGs do protótipo.
const ICON = {
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  imageWhite: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  pinBadge: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="accent-text"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>',
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>',
};

const MENU_ICON = (paths, cls = 'text-gray-300') =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${cls}">${paths}</svg>`;

const MENU_PLAIN = `
  <div class="menu-item flex items-center gap-3 px-3.5 py-2 cursor-default" data-act="paste-plain">
    ${MENU_ICON('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/>')}
    <span class="text-[13px] font-medium text-gray-100">Colar como texto simples</span>
  </div>`;

// A sincronização entre dispositivos é um recurso da conta Microsoft: fica visível (fidelidade ao design), porém desativado.
const MENU_SYNC = `
  <div class="menu-item flex items-center gap-3 px-3.5 py-2 cursor-default" data-act="sync" aria-disabled="true" title="Indisponível no Linux">
    ${MENU_ICON('<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>')}
    <span class="text-[13px] font-medium text-gray-100">Sincronizar dispositivos</span>
  </div>`;

const menuPin = (pinned) => `
  <div class="menu-item flex items-center gap-3 px-3.5 py-2 cursor-default" data-act="pin">
    ${MENU_ICON('<path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>')}
    <span class="text-[13px] font-medium text-gray-100">${pinned ? 'Desafixar item' : 'Fixar item'}</span>
  </div>`;

const MENU_DELETE = `
  <div class="menu-item flex items-center gap-3 px-3.5 py-2 cursor-default group/delete hover:bg-red-500/20" data-act="delete">
    ${MENU_ICON('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 'text-red-400 group-hover/delete:text-red-300')}
    <span class="text-[13px] font-medium text-red-400 group-hover/delete:text-red-300">Excluir</span>
  </div>`;

/** Heurística simples: trecho multilinha com cara de código ganha o bloco monoespaçado do protótipo. */
function looksLikeCode(text) {
  if (!text.includes('\n')) return false;
  const hits = [/[{};]/, /^\s{2,}\S/m, /\b(import|const|let|var|function|class|def|return|void|public|#include)\b/, /=>|::|\(\)|<\/?\w+>/]
    .filter((re) => re.test(text)).length;
  return hits >= 2;
}

function buildCard(it) {
  const isText = it.kind === 'text';
  const card = document.createElement('div');
  card.className = 'fluent-item group/card relative rounded-[8px] p-3.5 cursor-default shadow-sm';
  card.dataset.id = it.id;

  // Só markup estático aqui; o conteúdo do usuário entra depois via textContent/src (sem risco de injeção de HTML).
  card.innerHTML = `
    <div class="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 z-50">
      <button class="fluent-icon-btn p-1.5 rounded-[4px] text-gray-300 hover:text-white" data-act="pin" title="${it.pinned ? 'Desafixar' : 'Fixar'}">${ICON.pin}</button>
      <button class="fluent-icon-btn p-1.5 rounded-[4px] text-gray-300 hover:text-white" data-act="delete" title="Excluir">${ICON.trash}</button>
      <div class="menu-wrap group/menu relative">
        <button class="fluent-icon-btn p-1.5 rounded-[4px] text-gray-300 hover:text-white bg-white/5" title="Ver mais">${ICON.more}</button>
        <div class="menu absolute right-0 top-[110%] w-[220px] fluent-menu rounded-[8px] py-1.5 flex flex-col
                    opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible
                    transition-all duration-150 transform origin-top-right translate-y-[-5px] group-hover/menu:translate-y-0">
          ${isText ? MENU_PLAIN : ''}
          ${MENU_SYNC}
          <div class="h-[1px] w-full bg-white/10 my-1"></div>
          ${menuPin(it.pinned)}
          ${MENU_DELETE}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2.5 ${isText ? 'mb-2' : 'mb-2.5'}">
      ${isText ? ICON.file : ICON.image}
      <span class="text-[11.5px] font-medium text-gray-400 uppercase tracking-widest">${isText ? 'Texto' : 'Imagem'}</span>
      ${it.pinned ? `<div class="ml-auto group-hover/card:opacity-0 transition-opacity">${ICON.pinBadge}</div>` : ''}
    </div>
    <div data-slot="body"></div>`;

  const body = card.querySelector('[data-slot="body"]');
  if (isText && looksLikeCode(it.text)) {
    const pre = document.createElement('div');
    pre.className = 'bg-[#111111]/70 p-3 rounded-[6px] border border-white/5 font-mono text-[12px] leading-relaxed text-[#DCDCAA] overflow-hidden whitespace-pre max-h-[120px]';
    pre.textContent = it.text.split('\n').slice(0, 7).join('\n');
    body.append(pre);
  } else if (isText) {
    const p = document.createElement('p');
    p.className = 'text-[13.5px] leading-relaxed text-[#E2E2E2] line-clamp-3 break-words';
    p.textContent = it.text;
    body.append(p);
  } else {
    body.innerHTML = `
      <div class="w-full h-[130px] bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] rounded-[6px] border border-white/5 flex items-center justify-center relative overflow-hidden">
        <img class="max-w-full max-h-full object-contain" alt="" draggable="false">
        <div class="absolute bottom-2 left-2 bg-black/50 px-2.5 py-1 rounded-full backdrop-blur-md border border-white/10 z-10 flex items-center gap-1.5">
          ${ICON.imageWhite}<span class="text-[11px] font-medium text-white" data-slot="dims"></span>
        </div>
      </div>`;
    body.querySelector('img').src = it.url;
    body.querySelector('[data-slot="dims"]').textContent = it.width && it.height ? `${it.width}×${it.height}` : 'imagem';
  }
  return card;
}

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
let items = [];
let selected = -1;

function applySelection() {
  [...listEl.children].forEach((el, i) => el.classList.toggle('is-selected', i === selected));
  listEl.children[selected]?.scrollIntoView({ block: 'nearest' });
}

function render(next) {
  items = Array.isArray(next) ? next : [];
  if (selected >= items.length) selected = items.length - 1;
  listEl.replaceChildren(...items.map(buildCard));
  emptyEl.classList.toggle('hidden', items.length > 0);
  emptyEl.classList.toggle('flex', items.length === 0);
  applySelection();
}

// Clique no card = colar. Botões/menu têm data-act e não disparam a colagem.
listEl.addEventListener('click', (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) { window.mvclip.paste(id); return; }
  e.stopPropagation();
  if (act === 'pin') window.mvclip.pin(id);
  else if (act === 'delete') window.mvclip.remove(id);
  else if (act === 'paste-plain') window.mvclip.paste(id); // o histórico guarda texto puro; igual a colar normal
});

// Dropdown: se não couber embaixo (a lista rola e corta), abre para cima.
listEl.addEventListener('mouseover', (e) => {
  const wrap = e.target.closest('.menu-wrap');
  if (!wrap) return;
  const menu = wrap.querySelector('.menu');
  const room = listEl.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom;
  menu.classList.toggle('flip-up', room < menu.offsetHeight + 12);
});

document.addEventListener('keydown', (e) => {
  // Com a tela de configurações aberta, Esc volta para o histórico (não fecha a janela) e as setas não mexem na lista.
  if (window.MVSettings?.isOpen()) {
    if (e.key === 'Escape') window.MVSettings.close();
    return;
  }
  if (e.key === 'Escape') { window.mvclip.hide(); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown') selected = Math.min(items.length - 1, selected + 1);
  else if (e.key === 'ArrowUp') selected = Math.max(0, selected - 1);
  else if (e.key === 'Enter' && selected >= 0) { window.mvclip.paste(items[selected].id); return; }
  else if (e.key === 'Delete' && selected >= 0) { window.mvclip.remove(items[selected].id); return; }
  else return;
  e.preventDefault();
  applySelection();
});

document.getElementById('btn-clear').addEventListener('click', () => window.mvclip.clear());
// btn-settings: abre a tela de Configurações (renderer/settings.js).

window.mvclip.onChanged(render);
window.mvclip.onShown(async () => {
  window.MVSettings?.close(); // sempre reabre no histórico
  selected = -1;
  render(await window.mvclip.list());
  listEl.scrollTop = 0;
});
window.mvclip.list().then(render);
