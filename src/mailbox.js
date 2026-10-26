'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

/**
 * Canal de comunicação por "caixas de correio" em $XDG_RUNTIME_DIR/mv-clipboard (inotify, sem dependências nativas):
 *   inbox/  -> mensagens PARA o app   (atalho Super+V via mv-clipboard-ctl, itens vindos da extensão GNOME)
 *   shell/  -> mensagens PARA a extensão GNOME (ex.: {"type":"paste"})
 * Cada mensagem é um arquivo <epoch_ms>-<id>.json criado de forma atômica (grava .tmp e renomeia).
 * Batimentos: o app toca app.alive; a extensão toca shell.alive (usados para saber se o outro lado está ativo).
 */
class Mailbox extends EventEmitter {
  constructor({ root, staleMs = 30_000, heartbeatMs = 5_000 }) {
    super();
    this.root = root;
    this.inbox = path.join(root, 'inbox');
    this.shell = path.join(root, 'shell');
    this.staleMs = staleMs;
    this.heartbeatMs = heartbeatMs;
    this._watcher = null;
    this._soonTimer = null;
    this._hbTimer = null;
  }

  static defaultRoot(env = process.env) {
    return path.join(env.XDG_RUNTIME_DIR || '/tmp', 'mv-clipboard');
  }

  start() {
    for (const dir of [this.inbox, this.shell]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this._watcher = fs.watch(this.inbox, () => this._soon());
    this._watcher.on('error', () => {});
    this._touch('app.alive');
    this._hbTimer = setInterval(() => this._touch('app.alive'), this.heartbeatMs);
    this._scan();
  }

  stop() {
    this._watcher?.close();
    clearTimeout(this._soonTimer);
    clearInterval(this._hbTimer);
    try { fs.unlinkSync(path.join(this.root, 'app.alive')); } catch { /* já removido */ }
  }

  _touch(name) {
    try { fs.writeFileSync(path.join(this.root, name), String(Date.now())); } catch { /* sem permissão: ignora */ }
  }

  _soon() {
    clearTimeout(this._soonTimer);
    this._soonTimer = setTimeout(() => this._scan(), 15);
  }

  _scan() {
    let names;
    try { names = fs.readdirSync(this.inbox); } catch { return; }
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const file = path.join(this.inbox, name);
      let msg = null;
      try { msg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* arquivo corrompido */ }
      try { fs.unlinkSync(file); } catch { /* outro scan já pegou */ }
      if (!msg || typeof msg.type !== 'string') continue;
      const sentAt = Number.parseInt(name, 10);
      if (Number.isFinite(sentAt) && Date.now() - sentAt > this.staleMs) continue; // mensagem velha (app estava fechado)
      this.emit('message', msg);
    }
  }

  /** Envia comando para a extensão GNOME. */
  sendToShell(msg) {
    fs.mkdirSync(this.shell, { recursive: true, mode: 0o700 });
    const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tmp = path.join(this.shell, `${base}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(msg), { mode: 0o600 });
    fs.renameSync(tmp, path.join(this.shell, `${base}.json`));
  }

  /** A extensão GNOME está viva? (batimento nos últimos 15 s) */
  bridgeAlive(maxAgeMs = 15_000) {
    try { return Date.now() - fs.statSync(path.join(this.root, 'shell.alive')).mtimeMs < maxAgeMs; } catch { return false; }
  }
}

module.exports = { Mailbox };
