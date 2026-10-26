'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateAccelerator } = require('./accelerator');

/**
 * Esquema único das configurações: padrões + validação. Usado ao ler config.json e ao receber alterações da
 * tela de Configurações (nada vindo do renderer entra sem passar por aqui).
 */
const num = (def, min, max, integer = true) => ({ type: 'number', default: def, min, max, integer });
const str = (def, extra = {}) => ({ type: 'string', default: def, ...extra });
const bool = (def) => ({ type: 'boolean', default: def });

const SCHEMA = Object.freeze({
  // --- avançadas (só config.json) ---
  maxTextBytes: num(1_000_000, 1_000, 20_000_000),  // ignora textos maiores que ~1 MB
  maxImageBytes: num(12_000_000, 10_000, 100_000_000), // ignora imagens maiores que ~12 MB
  pollMs: num(600, 100, 10_000),                     // intervalo do polling (X11 / XWayland)
  pasteDelayMs: num(140, 0, 2_000),                  // espera o foco voltar antes do Ctrl+V
  blurGraceMs: num(350, 0, 3_000),                   // ignora "blur" logo após mostrar a janela
  monitor: str('auto', { enum: ['auto', 'poll', 'wl-watch', 'bridge'] }),
  paste: str('auto', { enum: ['auto', 'bridge', 'xdotool', 'ydotool', 'wtype'] }),
  margin: num(12, 0, 200),                           // distância das bordas da área útil (px)

  // --- tela de Configurações ---
  hotkey: str('Super+V', { validate: (v) => validateAccelerator(v) }), // atalho para abrir/fechar
  showOnStart: bool(false),                          // mostrar a janela assim que o app inicia
  closeOnBlur: bool(true),                           // fechar ao clicar fora
  position: str('bottom-right', { enum: ['bottom-right', 'cursor'] }), // 'cursor' só é confiável em X11 puro
  maxItems: num(50, 5, 500),                         // itens NÃO fixados mantidos no histórico
  opacity: num(0.88, 0.4, 1, false),                 // opacidade do painel (sem blur real do desktop no Linux)
  accent: str('#60CDFF', { pattern: /^#[0-9a-fA-F]{6}$/ }), // cor de destaque
});

const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SCHEMA).map(([k, d]) => [k, d.default])));

/** Valida um único valor; devolve { ok, value } ou { ok: false, error }. */
function checkValue(key, value) {
  const def = SCHEMA[key];
  if (!def) return { ok: false, error: 'configuração desconhecida' };
  if (typeof value !== def.type || (def.type === 'number' && !Number.isFinite(value))) {
    return { ok: false, error: `esperava ${def.type}` };
  }
  if (def.type === 'number') {
    if (def.integer && !Number.isInteger(value)) return { ok: false, error: 'esperava um número inteiro' };
    if (value < def.min || value > def.max) return { ok: false, error: `fora do intervalo (${def.min} a ${def.max})` };
  }
  if (def.enum && !def.enum.includes(value)) return { ok: false, error: `valores aceitos: ${def.enum.join(', ')}` };
  if (def.pattern && !def.pattern.test(value)) return { ok: false, error: 'formato inválido' };
  if (def.validate) {
    const r = def.validate(value);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, value: r.value };
  }
  return { ok: true, value };
}

/** Valida um objeto parcial: { clean, errors } — `clean` só tem o que é válido. */
function sanitize(patch) {
  const clean = {};
  const errors = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { clean, errors: { _: 'esperava um objeto' } };
  for (const [key, value] of Object.entries(patch)) {
    const r = checkValue(key, value);
    if (r.ok) clean[key] = r.value; else errors[key] = r.error;
  }
  return { clean, errors };
}

/** Lê <dir>/config.json; valores inválidos ou desconhecidos são ignorados (vale o padrão). */
function loadConfig(dir) {
  const cfg = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    Object.assign(cfg, sanitize(raw).clean);
  } catch { /* sem config.json (ou ilegível): usa os padrões */ }
  return cfg;
}

/** Grava <dir>/config.json de forma atômica (só chaves conhecidas). */
function saveConfig(dir, cfg) {
  const data = Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, cfg[k]]));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'config.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { SCHEMA, DEFAULTS, checkValue, sanitize, loadConfig, saveConfig };
