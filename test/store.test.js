'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvclip-store-'));
const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(n))]);
const tick = () => new Promise((r) => setTimeout(r, 3));

test('addText ignora vazio e deduplica subindo para o topo', async () => {
  const s = new Store(tmp());
  assert.equal(s.addText('   '), null);
  const a = s.addText('olá');
  await tick();
  s.addText('mundo');
  await tick();
  const again = s.addText('olá');
  assert.equal(a.isNew, true);
  assert.equal(again.isNew, false);
  assert.deepEqual(s.list().map((i) => i.text), ['olá', 'mundo']);
});

test('fixados vêm primeiro e não são expulsos pelo limite', async () => {
  const s = new Store(tmp(), { maxItems: 2 });
  const keep = s.addText('fixado');
  s.togglePin(keep.item.id);
  for (const t of ['a', 'b', 'c', 'd']) { await tick(); s.addText(t); }
  const texts = s.list().map((i) => i.text);
  assert.equal(texts[0], 'fixado');
  assert.equal(texts.length, 3);              // 1 fixado + 2 recentes
  assert.deepEqual(texts.slice(1), ['d', 'c']);
});

test('imagens: grava PNG, deduplica por conteúdo e apaga o arquivo ao remover', () => {
  const dir = tmp();
  const s = new Store(dir);
  const { item } = s.addImage(PNG(1), { width: 10, height: 20 });
  assert.ok(fs.existsSync(path.join(dir, 'images', `${item.id}.png`)));
  assert.equal(s.addImage(PNG(1)).isNew, false);
  assert.equal(s.list().length, 1);
  assert.deepEqual(s.readImage(item), PNG(1));
  s.remove(item.id);
  assert.equal(s.list().length, 0);
  return new Promise((r) => setTimeout(() => { assert.ok(!fs.existsSync(path.join(dir, 'images', `${item.id}.png`))); r(); }, 30));
});

test('persiste em disco e recarrega', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.addText('persistente');
  s.flush();
  const again = new Store(dir);
  assert.deepEqual(again.list().map((i) => i.text), ['persistente']);
});

test('clear mantém fixados por padrão', () => {
  const s = new Store(tmp());
  const p = s.addText('fica');
  s.togglePin(p.item.id);
  s.addText('sai');
  s.clear();
  assert.deepEqual(s.list().map((i) => i.text), ['fica']);
  s.clear({ keepPinned: false });
  assert.equal(s.list().length, 0);
});

test('get/remove/togglePin rejeitam ids inválidos', () => {
  const s = new Store(tmp());
  assert.equal(s.get('../../etc/passwd'), null);
  assert.equal(s.remove('nope'), false);
  assert.equal(s.togglePin(42), null);
});

test('arquivo corrompido não derruba o app', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'history.json'), '{ isto não é json');
  assert.deepEqual(new Store(dir).list(), []);
});
