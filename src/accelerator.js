'use strict';
/**
 * Atalhos de teclado: formato do Electron ("Ctrl+Alt+V", "Super+V") <-> formato do GNOME ("<Control><Alt>v").
 * Módulo puro (sem Electron), usado no processo principal e nos testes. O renderer tem uma cópia mínima só para
 * montar a string a partir do KeyboardEvent; quem valida de verdade é sempre este módulo.
 */

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super']; // ordem canônica
const MOD_ALIASES = {
  ctrl: 'Ctrl', control: 'Ctrl', commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  super: 'Super', meta: 'Super', win: 'Super', windows: 'Super', cmd: 'Super', command: 'Super',
};
const GNOME_MOD = { Ctrl: '<Control>', Alt: '<Alt>', Shift: '<Shift>', Super: '<Super>' };

// Teclas nomeadas aceitas (nome canônico -> keysym do GNOME)
const NAMED_KEYS = {
  Space: 'space', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'Page_Up', PageDown: 'Page_Down', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
};
const NAMED_LOWER = Object.fromEntries(Object.keys(NAMED_KEYS).map((k) => [k.toLowerCase(), k]));

/** Normaliza o nome da tecla (letra, dígito, F1..F24 ou nomeada) ou devolve null. */
function normalizeKey(raw) {
  const k = String(raw).trim();
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(k)) return k.toUpperCase();
  return NAMED_LOWER[k.toLowerCase()] || null;
}

/** "ctrl+alt+v" -> { mods: ['Ctrl','Alt'], key: 'V' } | null */
function parseAccelerator(accel) {
  if (typeof accel !== 'string' || !accel.trim()) return null;
  const parts = accel.split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) return null;
  const keyRaw = parts.pop();
  const mods = new Set();
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const key = normalizeKey(keyRaw);
  if (!key) return null;
  return { mods: MOD_ORDER.filter((m) => mods.has(m)), key };
}

function normalizeAccelerator(accel) {
  const p = parseAccelerator(accel);
  return p ? [...p.mods, p.key].join('+') : null;
}

/**
 * Regras: precisa de tecla válida e de pelo menos um modificador "forte" (Ctrl, Alt ou Super);
 * Shift sozinho + tecla atrapalharia a digitação normal.
 */
function validateAccelerator(accel) {
  const p = parseAccelerator(accel);
  if (!p) return { ok: false, error: 'Atalho inválido. Exemplo: Super+V ou Ctrl+Alt+V.' };
  if (!p.mods.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Super')) {
    return { ok: false, error: 'Use ao menos Ctrl, Alt ou Super na combinação.' };
  }
  return { ok: true, value: [...p.mods, p.key].join('+') };
}

/** "Ctrl+Alt+V" -> "<Control><Alt>v" (valor da chave `binding` do gsettings). */
function toGnomeBinding(accel) {
  const p = parseAccelerator(accel);
  if (!p) throw new Error(`Atalho inválido: ${accel}`);
  const key = NAMED_KEYS[p.key] || (/^[A-Z]$/.test(p.key) ? p.key.toLowerCase() : p.key);
  return p.mods.map((m) => GNOME_MOD[m]).join('') + key;
}

/** "<Control><Alt>v" -> "Ctrl+Alt+V" (ou null se não entender). */
function fromGnomeBinding(binding) {
  if (typeof binding !== 'string') return null;
  const text = binding.trim().replace(/^'|'$/g, '');
  const m = /^((?:<[A-Za-z0-9_]+>)*)(.+)$/.exec(text);
  if (!m || !m[2]) return null;
  const mods = [];
  for (const tag of m[1].match(/<[^>]+>/g) || []) {
    const name = tag.slice(1, -1).toLowerCase();
    if (name === 'control' || name === 'primary' || name === 'ctrl') mods.push('Ctrl');
    else if (name === 'alt' || name === 'mod1') mods.push('Alt');
    else if (name === 'shift') mods.push('Shift');
    else if (name === 'super' || name === 'mod4' || name === 'meta') mods.push('Super');
    else return null;
  }
  const keyName = m[2] === 'Page_Up' ? 'PageUp' : m[2] === 'Page_Down' ? 'PageDown' : m[2];
  const key = normalizeKey(keyName);
  if (!key) return null;
  return normalizeAccelerator([...mods, key].join('+'));
}

module.exports = { MOD_ORDER, parseAccelerator, normalizeAccelerator, validateAccelerator, toGnomeBinding, fromGnomeBinding };
