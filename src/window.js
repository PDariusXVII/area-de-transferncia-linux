'use strict';
const { execFile } = require('node:child_process');

// Painel Fluent do protótipo: w-[380px] h-[580px]. A janela é maior (PAD) para a sombra não ser cortada.
const PANEL_W = 380;
const PANEL_H = 580;
const PAD = 24;
const WIN_W = PANEL_W + PAD * 2;
const WIN_H = PANEL_H + PAD * 2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Posição da janela (com a folga da sombra) dentro da área útil do monitor.
 * 'bottom-right' = canto inferior direito (como o Win+V); 'cursor' = colado ao cursor (só confiável em X11 puro).
 * Função pura: não depende do Electron, então é testável.
 */
function computeBounds({ workArea: wa, cursor = null, mode = 'bottom-right', margin = 12 }) {
  let px;
  let py; // canto superior esquerdo do PAINEL (sem a folga)
  if (mode === 'cursor' && cursor) {
    px = cursor.x + 8;
    py = cursor.y + 8;
  } else {
    px = wa.x + wa.width - PANEL_W - margin;
    py = wa.y + wa.height - PANEL_H - margin;
  }
  px = clamp(px, wa.x + margin, wa.x + wa.width - PANEL_W - margin);
  py = clamp(py, wa.y + margin, wa.y + wa.height - PANEL_H - margin);
  return { x: Math.round(px - PAD), y: Math.round(py - PAD), width: WIN_W, height: WIN_H };
}

class Popup {
  constructor({ electron, cfg, session, usingX11, preloadPath, htmlPath, log }) {
    this.electron = electron;
    this.cfg = cfg;
    this.session = session;
    this.usingX11 = usingX11;
    this.preloadPath = preloadPath;
    this.htmlPath = htmlPath;
    this.log = log;
    this.win = null;
    this.shownAt = 0;
    this.quitting = false;
  }

  create() {
    const { BrowserWindow } = this.electron;
    const win = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
      show: false,                    // nasce escondida: o app roda em segundo plano
      frame: false,                   // sem bordas/barra de título
      transparent: true,              // precisa de compositor (GNOME/KDE/Xfwm já têm)
      backgroundColor: '#00000000',   // ARGB totalmente transparente
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,              // não aparece na barra/Alt+Tab
      alwaysOnTop: true,              // flutuante
      focusable: true,
      title: 'MV Clipboard',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,  // mantém a UI viva mesmo escondida
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true); // aparece no workspace atual
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    // Como no Windows: clicou fora -> fecha. A tolerância evita fechar sozinha se o WM demorar a dar o foco.
    win.on('blur', () => {
      if (this.cfg.closeOnBlur !== false && Date.now() - this.shownAt >= this.cfg.blurGraceMs) this.hide();
    });
    // Fechar (Alt+F4) só esconde; o app continua monitorando.
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        this.hide();
      }
    });

    win.loadFile(this.htmlPath);
    this.win = win;
    return win;
  }

  get visible() { return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible()); }

  bounds() {
    const { screen } = this.electron;
    const wantsCursor = this.cfg.position === 'cursor';
    const cursor = wantsCursor ? screen.getCursorScreenPoint() : null;
    const display = cursor ? screen.getDisplayNearestPoint(cursor) : screen.getPrimaryDisplay();
    return computeBounds({ workArea: display.workArea, cursor, mode: this.cfg.position, margin: this.cfg.margin });
  }

  show() {
    if (!this.win || this.win.isDestroyed()) return;
    const target = this.bounds();
    this.shownAt = Date.now();
    this.win.setBounds(target);
    this.win.show();
    this.win.setBounds(target);       // alguns WMs recolocam a janela ao mapear: reaplica
    this.win.focus();
    this.activateX11();
    this.win.webContents.send('ui:shown');
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  toggle() { if (this.visible) this.hide(); else this.show(); }

  /**
   * O Mutter (GNOME) bloqueia "roubo de foco" de janelas mostradas sem evento de usuário recente.
   * Um pedido EWMH _NET_ACTIVE_WINDOW vindo de um "pager" (é o que o xdotool envia) sempre é aceito.
   */
  activateX11() {
    if (!this.usingX11 || !this.session.tools.xdotool) return;
    try {
      const xid = this.win.getNativeWindowHandle().readUInt32LE(0);
      execFile(this.session.tools.xdotool, ['windowactivate', String(xid)], () => {});
    } catch (err) {
      this.log('windowactivate falhou:', err.message);
    }
  }
}

module.exports = { Popup, computeBounds, PANEL_W, PANEL_H, PAD, WIN_W, WIN_H };
