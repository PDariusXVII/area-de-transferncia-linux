'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBounds, PANEL_W, PANEL_H, PAD, WIN_W, WIN_H } = require('../src/window');

const wa = { x: 0, y: 0, width: 1920, height: 1040 }; // 1080p com barra de 40px embaixo

test('tamanho da janela = painel do protótipo + folga da sombra', () => {
  assert.equal(PANEL_W, 380);
  assert.equal(PANEL_H, 580);
  assert.equal(WIN_W, 380 + 2 * PAD);
  assert.equal(WIN_H, 580 + 2 * PAD);
});

test('canto inferior direito: painel a `margin` das bordas da área útil', () => {
  const b = computeBounds({ workArea: wa, margin: 12 });
  assert.equal(b.x + PAD + PANEL_W, 1920 - 12);
  assert.equal(b.y + PAD + PANEL_H, 1040 - 12);
  assert.equal(b.width, WIN_W);
  assert.equal(b.height, WIN_H);
});

test('respeita monitor secundário com origem deslocada', () => {
  const b = computeBounds({ workArea: { x: 1920, y: 0, width: 1280, height: 720 }, margin: 12 });
  assert.equal(b.x + PAD + PANEL_W, 1920 + 1280 - 12);
  assert.equal(b.y + PAD + PANEL_H, 720 - 12);
});

test('modo cursor: perto do ponteiro, sem sair da tela', () => {
  const near = computeBounds({ workArea: wa, cursor: { x: 500, y: 300 }, mode: 'cursor', margin: 12 });
  assert.equal(near.x + PAD, 508);
  assert.equal(near.y + PAD, 308);
  const corner = computeBounds({ workArea: wa, cursor: { x: 1915, y: 1035 }, mode: 'cursor', margin: 12 });
  assert.equal(corner.x + PAD + PANEL_W, 1920 - 12);   // empurrado para dentro
  assert.equal(corner.y + PAD + PANEL_H, 1040 - 12);
});

test('modo cursor sem coordenadas cai no canto inferior direito', () => {
  assert.deepEqual(computeBounds({ workArea: wa, cursor: null, mode: 'cursor' }), computeBounds({ workArea: wa }));
});
