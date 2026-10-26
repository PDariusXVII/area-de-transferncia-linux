#!/usr/bin/env node
'use strict';
/**
 * Diagnóstico: `npm run doctor` (ou `node src/doctor.js [--json]`).
 * Não precisa do Electron. Diz o que está faltando para X11/Wayland e como corrigir.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { detectSession, pickMonitors, pickPasteChain } = require('./session');
const { Mailbox } = require('./mailbox');
const { DEFAULTS } = require('./config');
const autostart = require('./autostart');
const { fromGnomeBinding } = require('./accelerator');

const NODE_MIN = [22, 12, 0]; // exigido pelo pacote do Electron 43 (engines)
const nodeAtLeast = (v) => {
  const a = String(v).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) > NODE_MIN[i]) return true; if ((a[i] || 0) < NODE_MIN[i]) return false; }
  return true;
};

const EXT_UUID = 'mv-clipboard-bridge@mv.local';
const KB_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mv-clipboard/';
const KB_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';

function sh(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function ageOf(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return null; }
}

function runDoctor(env = process.env) {
  const s = detectSession(env);
  const r = []; // { level: 'ok' | 'warn' | 'fail' | 'info', msg }
  const add = (level, msg) => r.push({ level, msg });
  const t = s.tools;

  add('info', `sessão=${s.type} desktop=${s.desktop} (${s.desktopRaw || 'XDG_CURRENT_DESKTOP vazio'}) DISPLAY=${s.hasDisplay ? 'sim' : 'não'} WAYLAND_DISPLAY=${s.hasWaylandDisplay ? 'sim' : 'não'}`);
  if (s.type === 'unknown') add('fail', 'Não detectei sessão gráfica (X11/Wayland). Rode dentro da sessão do desktop, não por SSH/TTY.');

  // Node.js (só para instalar/compilar; o app em execução usa o Node embutido do Electron)
  if (nodeAtLeast(process.versions.node)) add('ok', `Node.js v${process.versions.node} ok (>= ${NODE_MIN.join('.')}).`);
  else add('fail', `Node.js v${process.versions.node} é antigo (o Electron 43 exige >= ${NODE_MIN.join('.')}). Rode: bash scripts/ensure-node.sh`);

  // Inicialização automática com a sessão
  if (autostart.isEnabled(env)) add('ok', `Inicialização automática ativa (${autostart.autostartPath(env)}).`);
  else add('warn', 'Inicialização automática desativada: ative em Configurações (engrenagem) ou com `bash scripts/autostart.sh enable`.');

  // Ferramentas
  if (t.xdotool) add('ok', 'xdotool encontrado (colar em X11/XWayland e ativar a janela).');
  else add('warn', 'xdotool ausente: sudo apt install xdotool');
  if (s.type === 'wayland' && s.desktop !== 'gnome') {
    if (t.wlPaste) add('ok', 'wl-clipboard encontrado (monitoramento via wl-paste --watch).');
    else add('fail', 'wl-clipboard ausente: sudo apt install wl-clipboard');
    if (!t.ydotool && !t.wtype) add('warn', 'Sem ydotool/wtype: colar automático só funcionará em janelas XWayland (xdotool). sudo apt install ydotool wtype');
    if (t.ydotool) {
      try { fs.accessSync('/dev/uinput', fs.constants.W_OK); add('ok', '/dev/uinput gravável (ydotool pode digitar).'); }
      catch { add('warn', '/dev/uinput sem permissão para o seu usuário: veja "ydotool" no README.'); }
    }
  }
  if (!t.gdbus) add('warn', 'gdbus ausente (libglib2.0-bin): não é crítico, mas o GNOME normalmente tem.');

  // GNOME / Zorin: atalho + extensão
  if (s.desktop === 'gnome') {
    if (!t.gsettings) {
      add('fail', 'gsettings ausente — não consigo verificar o atalho do GNOME.');
    } else {
      const list = sh(t.gsettings, ['get', KB_SCHEMA, 'custom-keybindings']) || '';
      let ours = null;
      if (list.includes(KB_PATH)) {
        const binding = sh(t.gsettings, ['get', `${KB_SCHEMA}.custom-keybinding:${KB_PATH}`, 'binding']);
        const command = sh(t.gsettings, ['get', `${KB_SCHEMA}.custom-keybinding:${KB_PATH}`, 'command']);
        ours = fromGnomeBinding(binding || '');
        add(ours ? 'ok' : 'warn', `Atalho do MV Clipboard: ${ours || 'sem combinação válida'} (binding=${binding}) command=${command}`);
      } else {
        add('fail', 'Atalho personalizado do MV Clipboard não está registrado no GNOME. Rode scripts/setup-gnome.sh (ou escolha um atalho em Configurações).');
      }
      const tray = sh(t.gsettings, ['get', 'org.gnome.shell.keybindings', 'toggle-message-tray']);
      const trayHasSuperV = Boolean(tray && /<super>v/i.test(tray));
      if (trayHasSuperV && (ours === 'Super+V' || ours === null)) add('fail', `Super+V ainda pertence ao GNOME (toggle-message-tray=${tray}). Rode scripts/setup-gnome.sh.`);
      else add('ok', trayHasSuperV ? 'Super+V continua da bandeja do GNOME, mas o seu atalho é outro: sem conflito.' : 'Super+V livre no GNOME (toggle-message-tray não usa mais Super+V).');
    }
    if (t.gnomeExtensions) {
      const info = sh(t.gnomeExtensions, ['info', EXT_UUID]);
      const state = info && /State:\s*(.+)/i.exec(info)?.[1].trim();
      if (!info) add('warn', `Extensão ${EXT_UUID} não instalada. No GNOME/Wayland ela é necessária para capturar cópias de apps Wayland e colar sem ydotool.`);
      else if (/^(ACTIVE|ENABLED)$/i.test(state)) add('ok', `Extensão ${EXT_UUID} ativa.`);
      else add('warn', `Extensão ${EXT_UUID} instalada, mas estado=${state}. Saia e entre na sessão e rode: gnome-extensions enable ${EXT_UUID}`);
    }
  }

  // Ponte / app em execução
  const root = Mailbox.defaultRoot(env);
  const shellAge = ageOf(path.join(root, 'shell.alive'));
  const appAge = ageOf(path.join(root, 'app.alive'));
  add(appAge !== null && appAge < 15000 ? 'ok' : 'info', appAge !== null && appAge < 15000 ? 'App MV Clipboard em execução.' : 'App MV Clipboard não está em execução agora.');
  add(shellAge !== null && shellAge < 15000 ? 'ok' : 'info', shellAge !== null && shellAge < 15000 ? 'Ponte da extensão GNOME ativa (batimento recente).' : 'Ponte da extensão GNOME sem batimento (normal se não for GNOME ou se a extensão não está ativa).');

  const bridgeAlive = shellAge !== null && shellAge < 15000;
  add('info', `fontes de captura: ${pickMonitors(s, DEFAULTS).join(', ')}`);
  const chain = pickPasteChain(s, DEFAULTS, { bridgeAlive });
  add(chain.length ? 'info' : 'fail', `cadeia para colar (Ctrl+V): ${chain.length ? chain.join(' -> ') : 'NENHUMA — instale xdotool (X11) ou use a extensão GNOME / ydotool (Wayland)'}`);

  if (s.type === 'wayland' && s.desktop === 'gnome' && !bridgeAlive) {
    add('warn', 'GNOME/Wayland sem a extensão ativa: o Mutter não expõe data-control, então só cópias de apps X11 (XWayland) serão capturadas.');
  }
  return { session: s, results: r };
}

function print({ results }) {
  const tag = { ok: '[ ok ]', warn: '[ !! ]', fail: '[FALHA]', info: '[ .. ]' };
  for (const { level, msg } of results) console.log(`${tag[level]} ${msg}`);
  const fails = results.filter((x) => x.level === 'fail').length;
  const warns = results.filter((x) => x.level === 'warn').length;
  console.log(`\nResumo: ${fails} falha(s), ${warns} aviso(s).`);
  return fails;
}

if (require.main === module) {
  const out = runDoctor();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
  process.exit(print(out) ? 1 : 0);
}

module.exports = { runDoctor };
