'use strict';
const { execFile } = require('node:child_process');
const { validateAccelerator, toGnomeBinding, fromGnomeBinding } = require('./accelerator');

/**
 * Atalho para abrir/fechar a janela — estratégia por ambiente:
 *  - gnome          : atalho personalizado do GNOME (gsettings) chamando `mv-clipboard-ctl toggle`. Funciona em X11 e Wayland.
 *                     Se for Super+V, libera também o Super+V padrão do GNOME (bandeja de notificações).
 *  - globalShortcut : X11 fora do GNOME (Xfce, Cinnamon, MATE...): globalShortcut do Electron.
 *  - manual         : Wayland fora do GNOME (KDE, Sway, Hyprland): apps comuns não capturam teclas globais;
 *                     o usuário registra `mv-clipboard-ctl toggle` no atalho do próprio compositor.
 */
const KB_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const KB_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mv-clipboard/';
const KB_SLOT = `${KB_SCHEMA}.custom-keybinding:${KB_PATH}`;

function defaultRun(bin, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/** "['a', 'b']" | "@as []" | "[]" -> array de strings (null se não entender: nesse caso NÃO alteramos nada). */
function parseStringArray(text) {
  const t = String(text).trim().replace(/^@as\s+/, '');
  if (t === '' || t === '[]') return [];
  if (!/^\[('[^']*'(,\s*)?)*\]$/.test(t)) return null;
  return [...t.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
const toGVariantArray = (list) => `[${list.map((s) => `'${s}'`).join(', ')}]`;

async function gsGet(run, gsettings, schema, key) {
  const r = await run(gsettings, ['get', schema, key]);
  if (!r.ok) throw new Error(`gsettings get ${schema} ${key} falhou: ${r.stderr.trim() || 'erro'}`);
  return r.stdout.trim();
}
async function gsSet(run, gsettings, schema, key, value) {
  const r = await run(gsettings, ['set', schema, key, value]);
  if (!r.ok) throw new Error(`gsettings set ${schema} ${key} falhou: ${r.stderr.trim() || 'erro'}`);
}

/** Atalho atual do MV Clipboard no GNOME ("Ctrl+Alt+V") ou null se não estiver registrado. */
async function readGnomeBinding({ gsettings, run = defaultRun }) {
  const listText = await gsGet(run, gsettings, KB_SCHEMA, 'custom-keybindings').catch(() => '');
  const list = parseStringArray(listText);
  if (!list || !list.includes(KB_PATH)) return null;
  const r = await run(gsettings, ['get', KB_SLOT, 'binding']);
  return r.ok ? fromGnomeBinding(r.stdout.trim()) : null;
}

/** Registra (ou atualiza) o atalho personalizado do GNOME. Lança erro se algo falhar. */
async function applyGnomeBinding({ gsettings, accel, command, run = defaultRun }) {
  const binding = toGnomeBinding(accel);

  const list = parseStringArray(await gsGet(run, gsettings, KB_SCHEMA, 'custom-keybindings'));
  if (list === null) throw new Error('Não entendi a lista de atalhos do GNOME; não alterei nada.');
  if (!list.includes(KB_PATH)) await gsSet(run, gsettings, KB_SCHEMA, 'custom-keybindings', toGVariantArray([...list, KB_PATH]));

  await gsSet(run, gsettings, KB_SLOT, 'name', 'MV Clipboard');
  await gsSet(run, gsettings, KB_SLOT, 'command', command);
  await gsSet(run, gsettings, KB_SLOT, 'binding', binding);

  // Super+V é do GNOME por padrão (bandeja de notificações): libera para o nosso atalho valer.
  if (binding.toLowerCase() === '<super>v') {
    const tray = await run(gsettings, ['get', 'org.gnome.shell.keybindings', 'toggle-message-tray']);
    const current = tray.ok ? parseStringArray(tray.stdout) : null;
    if (current && current.some((k) => k.toLowerCase() === '<super>v')) {
      await gsSet(run, gsettings, 'org.gnome.shell.keybindings', 'toggle-message-tray',
        toGVariantArray(current.filter((k) => k.toLowerCase() !== '<super>v')));
    }
  }
  return binding;
}

class HotkeyManager {
  constructor({ globalShortcut, session, onTrigger, command, log = () => {}, run = defaultRun, forceGlobal = false }) {
    this.globalShortcut = globalShortcut;
    this.session = session;
    this.onTrigger = onTrigger;
    this.command = command; // ex.: "/home/u/.local/bin/mv-clipboard-ctl toggle"
    this.log = log;
    this.run = run;
    this.forceGlobal = forceGlobal; // MVCLIP_FORCE_GLOBALSHORTCUT=1: usa globalShortcut mesmo no GNOME/Wayland
    this.registered = null; // acelerador registrado via globalShortcut
  }

  get mode() {
    const s = this.session;
    if (this.forceGlobal) return 'globalShortcut';
    if (s.desktop === 'gnome' && s.tools.gsettings) return 'gnome';
    if (s.type === 'x11') return 'globalShortcut';
    return 'manual';
  }

  /** Atalho em vigor: no GNOME lê do sistema (o usuário pode ter mudado fora do app); senão, o configurado. */
  async current(configured) {
    if (this.mode === 'gnome') {
      try { return (await readGnomeBinding({ gsettings: this.session.tools.gsettings, run: this.run })) || configured; } catch { return configured; }
    }
    return configured;
  }

  /** Chamado ao iniciar o app. */
  startup(configured) {
    if (this.mode === 'gnome') {
      this.log('GNOME: atalho tratado pelo gsettings (scripts/setup-gnome.sh ou Configurações do app); globalShortcut não será usado.');
      return { ok: true, mode: 'gnome' };
    }
    if (this.mode === 'manual') {
      this.log('Wayland fora do GNOME: configure no compositor o comando `mv-clipboard-ctl toggle` para o atalho.');
      return { ok: true, mode: 'manual' };
    }
    return this.registerGlobal(configured);
  }

  registerGlobal(accel) {
    const previous = this.registered;
    try {
      if (previous) this.globalShortcut.unregister(previous);
      const ok = this.globalShortcut.register(accel, this.onTrigger);
      if (!ok) {
        if (previous) this.globalShortcut.register(previous, this.onTrigger);
        this.log(`${accel} já está em uso por outro atalho do sistema.`);
        return { ok: false, mode: 'globalShortcut', error: `${accel} já está em uso por outro atalho do sistema.` };
      }
      this.registered = accel;
      this.log(`${accel} registrado via globalShortcut (X11).`);
      return { ok: true, mode: 'globalShortcut', value: accel };
    } catch (err) {
      this.log('globalShortcut indisponível:', err.message);
      return { ok: false, mode: 'globalShortcut', error: `globalShortcut indisponível: ${err.message}` };
    }
  }

  /** Aplica um novo atalho. Retorna { ok, mode, value?, error?, note? } — nunca lança. */
  async apply(accel) {
    const v = validateAccelerator(accel);
    if (!v.ok) return { ok: false, mode: this.mode, error: v.error };
    const mode = this.mode;
    if (mode === 'gnome') {
      try {
        await applyGnomeBinding({ gsettings: this.session.tools.gsettings, accel: v.value, command: this.command, run: this.run });
        this.log(`Atalho do GNOME atualizado: ${v.value}`);
        return { ok: true, mode, value: v.value };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }
    if (mode === 'globalShortcut') return this.registerGlobal(v.value);
    return {
      ok: true, mode, value: v.value,
      note: 'Wayland fora do GNOME: o app não captura teclas globais. Registre o comando "mv-clipboard-ctl toggle" no atalho do seu compositor.',
    };
  }

  stop() { try { this.globalShortcut.unregisterAll(); } catch { /* ignora */ } }
}

module.exports = { HotkeyManager, applyGnomeBinding, readGnomeBinding, parseStringArray, toGVariantArray, KB_PATH, KB_SCHEMA, KB_SLOT };
