'use strict';
const { EventEmitter } = require('node:events');
const { loadConfig, saveConfig, sanitize } = require('./config');

/**
 * Configurações vivas: `cfg` é UM objeto compartilhado (janela, monitores e store leem dele), então mudar aqui
 * vale na hora, sem reiniciar. Toda alteração passa pelo esquema (src/config.js) e é gravada em config.json.
 */
class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.cfg = loadConfig(dir);
  }

  /** Valida um patch sem aplicar: { clean, errors }. */
  validate(patch) { return sanitize(patch); }

  /** Aplica valores JÁ validados. Retorna só o que de fato mudou. */
  commit(clean) {
    const changed = {};
    for (const [key, value] of Object.entries(clean)) {
      if (this.cfg[key] !== value) { this.cfg[key] = value; changed[key] = value; }
    }
    if (Object.keys(changed).length) {
      saveConfig(this.dir, this.cfg);
      this.emit('changed', changed);
    }
    return changed;
  }
}

module.exports = { Settings };
