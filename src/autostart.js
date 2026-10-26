'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Inicialização com a sessão (padrão freedesktop): ~/.config/autostart/mv-clipboard.desktop.
 * Usa o mesmo molde (packaging/mv-clipboard.desktop.in) que scripts/autostart.sh, então os dois geram o mesmo arquivo.
 * A verdade é sempre o arquivo em disco (não guardamos esse estado no config.json).
 */
const homeOf = (env) => env.HOME || os.homedir();
const configHome = (env) => env.XDG_CONFIG_HOME || path.join(homeOf(env), '.config');

function autostartPath(env = process.env) {
  return path.join(configHome(env), 'autostart', 'mv-clipboard.desktop');
}

/** Prefere ~/.local/bin/mv-clipboard (criado pelo instalador); senão, o launcher da pasta do projeto. */
function resolveExec({ env = process.env, appRoot }) {
  const link = path.join(homeOf(env), '.local', 'bin', 'mv-clipboard');
  try { fs.accessSync(link, fs.constants.X_OK); return link; } catch { return path.join(appRoot, 'bin', 'mv-clipboard'); }
}

/** Exec com espaços precisa de aspas (especificação .desktop). */
const quoteExec = (p) => (/\s/.test(p) ? `"${p.replace(/(["`$\\])/g, '\\$1')}"` : p);

function render(template, exec) {
  return template.split('@EXEC@').join(quoteExec(exec));
}

function isEnabled(env = process.env) {
  try {
    const text = fs.readFileSync(autostartPath(env), 'utf8');
    return !/^(Hidden=true|X-GNOME-Autostart-enabled=false)/im.test(text);
  } catch { return false; }
}

/** Liga/desliga. Devolve o estado final (true = ativado). */
function setEnabled(enabled, { env = process.env, appRoot }) {
  const file = autostartPath(env);
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return false;
  }
  const template = fs.readFileSync(path.join(appRoot, 'packaging', 'mv-clipboard.desktop.in'), 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, render(template, resolveExec({ env, appRoot })));
  fs.renameSync(tmp, file);
  return true;
}

module.exports = { autostartPath, resolveExec, quoteExec, render, isEnabled, setEnabled };
