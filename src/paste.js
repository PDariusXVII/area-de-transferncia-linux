'use strict';
const { execFile } = require('node:child_process');

// Terminais colam com Ctrl+Shift+V (Ctrl+V é "literal next" lá).
const TERMINAL_HINTS = [
  'gnome-terminal', 'terminal', 'console', 'kitty', 'alacritty', 'konsole', 'tilix', 'xterm', 'terminator',
  'wezterm', 'foot', 'ptyxis', 'guake', 'yakuake', 'urxvt', 'tmux',
];
const isTerminalClass = (cls = '') => {
  const c = String(cls).toLowerCase();
  return TERMINAL_HINTS.some((hint) => c.includes(hint));
};

function run(bin, args, timeout = 2000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  });
}

// Códigos de tecla do kernel (linux/input-event-codes.h): LEFTCTRL=29, LEFTSHIFT=42, V=47.
const STRATEGIES = {
  /** GNOME: a extensão injeta as teclas por dentro do shell (funciona em Wayland e X11, sem permissões extras). */
  async bridge({ mailbox, terminal }) {
    mailbox.sendToShell({ type: 'paste', shift: terminal === true });
    return true;
  },
  /** X11 e janelas XWayland. */
  async xdotool({ tools, terminal }) {
    return (await run(tools.xdotool, ['key', '--clearmodifiers', terminal ? 'ctrl+shift+v' : 'ctrl+v'])).ok;
  },
  /** Qualquer Wayland, via /dev/uinput (precisa do daemon ydotoold e permissão no uinput). */
  async ydotool({ tools, terminal }) {
    const seq = terminal ? ['29:1', '42:1', '47:1', '47:0', '42:0', '29:0'] : ['29:1', '47:1', '47:0', '29:0'];
    return (await run(tools.ydotool, ['key', ...seq])).ok;
  },
  /** Sway/Hyprland e outros wlroots (protocolo virtual-keyboard). Não funciona no GNOME. */
  async wtype({ tools, terminal }) {
    const args = terminal ? ['-M', 'ctrl', '-M', 'shift', 'v', '-m', 'shift', '-m', 'ctrl'] : ['-M', 'ctrl', 'v', '-m', 'ctrl'];
    return (await run(tools.wtype, args)).ok;
  },
};

/** Detecta terminal na janela X11 em foco (só enxerga janelas X11/XWayland). */
async function detectTerminalX11(tools) {
  if (!tools.xdotool) return false;
  const r = await run(tools.xdotool, ['getwindowfocus', 'getwindowclassname']);
  return r.ok && isTerminalClass(r.stdout);
}

/** Tenta cada estratégia da cadeia até uma funcionar. Retorna o nome da que funcionou (ou null). */
async function simulatePaste(ctx) {
  for (const name of ctx.chain) {
    try {
      if (await STRATEGIES[name]?.(ctx)) return name;
    } catch (err) {
      ctx.log?.(`colar via ${name} falhou:`, err.message);
    }
  }
  return null;
}

module.exports = { TERMINAL_HINTS, isTerminalClass, detectTerminalX11, simulatePaste, STRATEGIES };
