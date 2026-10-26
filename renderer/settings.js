'use strict';
// Tela de Configurações (dentro do próprio painel, para não perder o foco como aconteceria com outra janela).
// As mudanças valem na hora: cada controle chama window.mvclip.setSettings() e o processo principal valida tudo.
(() => {
  const $ = (id) => document.getElementById(id);
  const ACCENTS = [
    ['#60CDFF', 'Azul'], ['#7BD88F', 'Verde'], ['#C58AF9', 'Roxo'],
    ['#F28B82', 'Vermelho'], ['#FDD663', 'Amarelo'], ['#FF9F6B', 'Laranja'],
  ];
  const HOTKEY_HELP = {
    gnome: 'Aplicado no GNOME (funciona em X11 e Wayland).',
    globalShortcut: 'Atalho global do X11.',
    manual: 'Wayland fora do GNOME: registre o comando mv-clipboard-ctl toggle no atalho do seu compositor.',
  };

  let current = null;   // últimas configurações recebidas do processo principal
  let recording = false;
  const timers = new Map();

  // ---------- atalho a partir do teclado (layout independente: usa event.code) ----------
  const CODE_KEYS = {
    Space: 'Space', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  function keyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    return CODE_KEYS[code] || null;
  }
  /** KeyboardEvent -> "Ctrl+Alt+V" (null se for só modificador/tecla não suportada). Quem valida de fato é o processo principal. */
  function acceleratorFromEvent(e) {
    const key = keyFromCode(e.code);
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    return [...mods, key].join('+');
  }

  // ---------- visual ----------
  function applyVisuals(s) {
    if (!s) return;
    const root = document.documentElement.style; // CSSOM: permitido pela CSP (só style="" inline é bloqueado)
    if (typeof s.opacity === 'number') root.setProperty('--mica-bg', `rgba(32, 32, 32, ${s.opacity})`);
    if (typeof s.accent === 'string') root.setProperty('--accent', s.accent);
  }

  // ---------- mensagens ----------
  function show(el, text) {
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }
  const errorText = (errors) => Object.entries(errors || {}).map(([k, v]) => (k === '_' ? v : `${k}: ${v}`)).join(' · ');

  // ---------- preencher a tela ----------
  function buildSwatches() {
    const box = $('accent-swatches');
    box.replaceChildren(...ACCENTS.map(([color, name]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.color = color;
      b.title = name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.style.backgroundColor = color;
      return b;
    }));
  }

  function render(s) {
    current = s;
    const pretty = s.hotkey.replace(/\+/g, ' + ');
    $('hotkey-current').textContent = pretty;
    const preset = $('hotkey-preset');
    preset.value = [...preset.options].some((o) => o.value === s.hotkey) ? s.hotkey : '';
    $('hotkey-help').textContent = `${HOTKEY_HELP[s.hotkeyMode] || ''} Combinações já usadas pelo sistema não chegam ao app: se a gravação não captar a sua, escolha uma da lista.`.trim();
    $('opt-autostart').checked = Boolean(s.autostart);
    $('opt-showOnStart').checked = Boolean(s.showOnStart);
    $('opt-closeOnBlur').checked = Boolean(s.closeOnBlur);
    $('opt-position').value = s.position;
    const max = $('opt-maxItems');
    if (![...max.options].some((o) => Number(o.value) === s.maxItems)) {
      const extra = document.createElement('option');
      extra.value = String(s.maxItems);
      extra.textContent = String(s.maxItems);
      max.append(extra);
    }
    max.value = String(s.maxItems);
    const pct = Math.round(s.opacity * 100);
    $('opt-opacity').value = String(pct);
    $('opt-opacity-value').textContent = `${pct}%`;
    for (const sw of $('accent-swatches').children) sw.setAttribute('aria-checked', String(sw.dataset.color.toLowerCase() === s.accent.toLowerCase()));
    applyVisuals(s);
  }

  /** Envia um patch ao processo principal e mostra erros/avisos. Devolve o resultado. */
  async function save(patch) {
    let result;
    try {
      result = await window.mvclip.setSettings(patch);
    } catch (err) {
      show($('settings-error'), `Não foi possível salvar: ${err.message}`);
      return null;
    }
    if (result.settings) render(result.settings); // em caso de erro, volta os controles ao valor real
    show($('settings-error'), errorText(result.errors));
    show($('settings-note'), (result.warnings || []).join(' '));
    return result;
  }

  // ---------- gravar atalho ----------
  function stopRecording() {
    recording = false;
    const btn = $('hotkey-record');
    btn.classList.remove('is-recording');
    btn.textContent = 'Gravar…';
    document.removeEventListener('keydown', onRecordKey, true);
  }
  function startRecording() {
    recording = true;
    show($('settings-error'), '');
    const btn = $('hotkey-record');
    btn.classList.add('is-recording');
    btn.textContent = 'Pressione a combinação… (Esc cancela)';
    document.addEventListener('keydown', onRecordKey, true); // captura antes do atalho Esc/setas da lista
  }
  function onRecordKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); return; }
    const accel = acceleratorFromEvent(e);
    if (!accel) return; // só um modificador apertado: espera a tecla
    if (!(e.ctrlKey || e.altKey || e.metaKey)) { show($('settings-error'), 'Use ao menos Ctrl, Alt ou Super na combinação.'); return; }
    stopRecording();
    save({ hotkey: accel });
  }

  // ---------- botões com confirmação em dois cliques (sem diálogo bloqueante) ----------
  function confirmClick(btn, confirmLabel, action) {
    const original = btn.dataset.label || (btn.dataset.label = btn.textContent);
    btn.addEventListener('click', () => {
      if (timers.has(btn)) {
        clearTimeout(timers.get(btn));
        timers.delete(btn);
        btn.textContent = original;
        action();
        return;
      }
      btn.textContent = confirmLabel;
      timers.set(btn, setTimeout(() => { timers.delete(btn); btn.textContent = original; }, 4000));
    });
  }

  // ---------- abrir / fechar ----------
  const isOpen = () => document.body.dataset.view === 'settings';

  async function open() {
    show($('settings-error'), '');
    show($('settings-note'), '');
    const s = await window.mvclip.getSettings();
    if (s) render(s);
    document.body.dataset.view = 'settings';
    $('settings-scroll').scrollTop = 0;
    $('settings-back').focus();
  }
  function close() {
    stopRecording();
    delete document.body.dataset.view;
  }

  // ---------- ligações ----------
  buildSwatches();
  $('settings-back').addEventListener('click', close);
  $('opt-autostart').addEventListener('change', (e) => save({ autostart: e.target.checked }));
  $('opt-showOnStart').addEventListener('change', (e) => save({ showOnStart: e.target.checked }));
  $('opt-closeOnBlur').addEventListener('change', (e) => save({ closeOnBlur: e.target.checked }));
  $('opt-position').addEventListener('change', (e) => save({ position: e.target.value }));
  $('opt-maxItems').addEventListener('change', (e) => save({ maxItems: Number(e.target.value) }));
  $('hotkey-preset').addEventListener('change', (e) => { if (e.target.value) save({ hotkey: e.target.value }); });
  $('hotkey-record').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
  $('opt-opacity').addEventListener('input', (e) => {           // prévia ao arrastar
    const v = Number(e.target.value) / 100;
    $('opt-opacity-value').textContent = `${e.target.value}%`;
    applyVisuals({ opacity: v });
  });
  $('opt-opacity').addEventListener('change', (e) => save({ opacity: Number(e.target.value) / 100 }));
  $('accent-swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) save({ accent: sw.dataset.color });
  });
  confirmClick($('btn-clear-all'), 'Clique de novo para apagar tudo', () => window.mvclip.clearAll());
  confirmClick($('btn-quit'), 'Clique de novo para encerrar', () => window.mvclip.quit());
  $('btn-settings').addEventListener('click', open);

  // Aplica o visual salvo assim que a página carrega e quando outro lugar mudar as configurações.
  window.mvclip.getSettings().then((s) => { if (s) { current = s; applyVisuals(s); } });
  window.mvclip.onSettingsChanged((s) => { if (s) { if (isOpen()) render(s); else { current = s; applyVisuals(s); } } });

  window.MVSettings = { open, close, isOpen, applyVisuals, acceleratorFromEvent, get current() { return current; } };
})();
