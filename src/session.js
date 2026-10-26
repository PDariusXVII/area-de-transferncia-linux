'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TOOL_BINS = {
  xdotool: 'xdotool', xclip: 'xclip', xsel: 'xsel',
  wlPaste: 'wl-paste', wlCopy: 'wl-copy', wtype: 'wtype',
  ydotool: 'ydotool', ydotoold: 'ydotoold',
  gdbus: 'gdbus', gsettings: 'gsettings',
  gnomeExtensions: 'gnome-extensions', gnomeShell: 'gnome-shell',
};

function which(bin, pathVar = process.env.PATH || '') {
  for (const dir of pathVar.split(':')) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* tenta o próximo */ }
  }
  return null;
}

/** Normaliza XDG_CURRENT_DESKTOP (ex.: "ubuntu:GNOME", "zorin:GNOME", "XFCE", "KDE", "sway"). */
function detectDesktop(raw = '') {
  const d = raw.toLowerCase();
  if (/xfce/.test(d)) return 'xfce';
  if (/cinnamon/.test(d)) return 'cinnamon';
  if (/mate/.test(d)) return 'mate';
  if (/kde|plasma/.test(d)) return 'kde';
  if (/sway|hyprland|river|wayfire|labwc|niri/.test(d)) return 'wlroots';
  if (/gnome/.test(d)) return 'gnome';
  return 'other';
}

function detectSession(env = process.env, whichFn = which) {
  const declared = (env.XDG_SESSION_TYPE || '').toLowerCase();
  let type = 'unknown';
  if (declared === 'wayland' || declared === 'x11') type = declared;
  else if (env.WAYLAND_DISPLAY) type = 'wayland';
  else if (env.DISPLAY) type = 'x11';

  const tools = {};
  for (const [key, bin] of Object.entries(TOOL_BINS)) tools[key] = whichFn(bin, env.PATH || '');

  return {
    type,                                   // 'x11' | 'wayland' | 'unknown'
    desktop: detectDesktop(env.XDG_CURRENT_DESKTOP),
    desktopRaw: env.XDG_CURRENT_DESKTOP || '',
    hasDisplay: Boolean(env.DISPLAY),       // X11 nativo OU XWayland
    hasWaylandDisplay: Boolean(env.WAYLAND_DISPLAY),
    tools,
  };
}

/**
 * Quais fontes de captura ligar.
 *  - wl-watch : wl-paste --watch (compositores com data-control: KDE, Sway, Hyprland...). NÃO existe no GNOME/Mutter.
 *  - poll     : API de clipboard do Electron (X11 nativo ou XWayland).
 *  - bridge   : caixa de entrada alimentada pela extensão GNOME (única via completa no GNOME/Wayland). Sempre ouvindo.
 */
function pickMonitors(s, cfg) {
  if (cfg.monitor !== 'auto') return [cfg.monitor];
  const list = [];
  if (s.type === 'wayland' && s.tools.wlPaste && s.desktop !== 'gnome') list.push('wl-watch');
  if (s.hasDisplay) list.push('poll');
  list.push('bridge');
  return list;
}

/** Ordem de tentativas para simular Ctrl+V. */
function pickPasteChain(s, cfg, { bridgeAlive = false } = {}) {
  if (cfg.paste !== 'auto') return [cfg.paste];
  const chain = [];
  if (bridgeAlive) chain.push('bridge');
  if (s.type === 'wayland') {
    if (s.tools.wtype && s.desktop === 'wlroots') chain.push('wtype');
    if (s.tools.ydotool) chain.push('ydotool');
  }
  if (s.hasDisplay && s.tools.xdotool) chain.push('xdotool'); // X11 e janelas XWayland
  return chain;
}

module.exports = { which, detectDesktop, detectSession, pickMonitors, pickPasteChain };
