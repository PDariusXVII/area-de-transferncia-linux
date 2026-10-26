'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const ID_RE = /^[a-f0-9]{40}$/;
const sha1 = (...parts) => {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

/**
 * Histórico em JSON (history.json) + imagens PNG em images/<id>.png.
 * O contrato (addText, addImage, list, togglePin, remove, clear) é pequeno de propósito: dá para trocar por SQLite sem mexer no resto.
 */
class Store extends EventEmitter {
  constructor(dir, { maxItems = 50 } = {}) {
    super();
    this.dir = dir;
    this.imgDir = path.join(dir, 'images');
    this.file = path.join(dir, 'history.json');
    this.maxItems = maxItems;
    this.items = [];
    this._timer = null;
    fs.mkdirSync(this.imgDir, { recursive: true, mode: 0o700 });
    this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.items)) {
        this.items = data.items.filter((i) => i && ID_RE.test(i.id) && (i.kind === 'text' || i.kind === 'image'));
      }
    } catch { /* primeira execução ou arquivo ilegível: começa vazio */ }
  }

  _scheduleSave() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  /** Grava na hora (chamado também ao sair do app). Escrita atômica: tmp + rename. */
  flush() {
    clearTimeout(this._timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Muda o limite de itens não fixados; se diminuir, apaga os mais antigos já. */
  setMaxItems(n) {
    this.maxItems = n;
    this._evict();
    this._scheduleSave();
    this.emit('changed');
  }

  addText(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    return this._upsert({ kind: 'text', id: sha1('text\0', text), text, bytes: Buffer.byteLength(text) });
  }

  addImage(png, { width = 0, height = 0 } = {}) {
    if (!Buffer.isBuffer(png) || !png.length) return null;
    const id = sha1('image\0', png);
    const file = `${id}.png`;
    const target = path.join(this.imgDir, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, png, { mode: 0o600 });
    return this._upsert({ kind: 'image', id, file, width, height, bytes: png.length });
  }

  /** Conteúdo repetido não duplica: sobe para o topo. */
  _upsert(base) {
    const now = Date.now();
    const existing = this.items.find((i) => i.id === base.id);
    let item = existing;
    let isNew = false;
    if (existing) {
      existing.ts = now;
    } else {
      item = { ...base, ts: now, pinned: false };
      this.items.push(item);
      isNew = true;
      this._evict();
    }
    this._scheduleSave();
    this.emit('changed');
    return { item, isNew };
  }

  _evict() {
    const unpinned = this.items.filter((i) => !i.pinned).sort((a, b) => b.ts - a.ts);
    for (const old of unpinned.slice(this.maxItems)) this._drop(old);
  }

  _drop(item) {
    this.items = this.items.filter((i) => i !== item);
    if (item.kind === 'image') fs.rm(path.join(this.imgDir, item.file), { force: true }, () => {});
  }

  /** Fixados primeiro (como no Windows), depois os mais recentes. */
  list() {
    const newest = (a, b) => b.ts - a.ts;
    return [
      ...this.items.filter((i) => i.pinned).sort(newest),
      ...this.items.filter((i) => !i.pinned).sort(newest),
    ];
  }

  get(id) {
    return typeof id === 'string' && ID_RE.test(id) ? (this.items.find((i) => i.id === id) ?? null) : null;
  }

  togglePin(id) {
    const item = this.get(id);
    if (!item) return null;
    item.pinned = !item.pinned;
    if (!item.pinned) this._evict();
    this._scheduleSave();
    this.emit('changed');
    return item.pinned;
  }

  remove(id) {
    const item = this.get(id);
    if (!item) return false;
    this._drop(item);
    this._scheduleSave();
    this.emit('changed');
    return true;
  }

  clear({ keepPinned = true } = {}) {
    for (const item of [...this.items]) if (!(keepPinned && item.pinned)) this._drop(item);
    this._scheduleSave();
    this.emit('changed');
  }

  imagePath(item) { return path.join(this.imgDir, item.file); }
  readImage(item) { return fs.readFileSync(this.imagePath(item)); }
}

module.exports = { Store, ID_RE };
