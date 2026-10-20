/// <reference types="node" />
// Confere os dicionários de idioma (sem React Native). Rodar com: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { common } from '../src/i18n/parts/common.ts';
import { ios } from '../src/i18n/parts/ios.ts';
import { library } from '../src/i18n/parts/library.ts';
import { player } from '../src/i18n/parts/player.ts';
import { settings } from '../src/i18n/parts/settings.ts';
import { tools } from '../src/i18n/parts/tools.ts';

const parts = { common, library, player, settings, ios, tools } as Record<string, { pt: Record<string, string>; en: Record<string, string>; es: Record<string, string> }>;
const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('idiomas', () => {
  for (const [name, part] of Object.entries(parts)) {
    it(`${name}: mesmas chaves, com o prefixo certo, em pt/en/es`, () => {
      const keys = Object.keys(part.pt).sort();
      assert.deepEqual(Object.keys(part.en).sort(), keys);
      assert.deepEqual(Object.keys(part.es).sort(), keys);
      for (const key of keys) assert.ok(key.startsWith(`${name}.`), `${key} deveria começar com "${name}."`);
    });

    it(`${name}: nenhum texto vazio e as mesmas variáveis {x}`, () => {
      for (const key of Object.keys(part.pt)) {
        for (const lang of ['pt', 'en', 'es'] as const) {
          assert.ok(part[lang][key]?.trim(), `${lang} ${key} está vazio`);
        }
        assert.deepEqual(vars(part.en[key]), vars(part.pt[key]), `en ${key}: variáveis diferentes`);
        assert.deepEqual(vars(part.es[key]), vars(part.pt[key]), `es ${key}: variáveis diferentes`);
      }
    });

    it(`${name}: plurais completos (.one e .many com {n})`, () => {
      for (const key of Object.keys(part.pt)) {
        const m = /^(.*)\.(one|many)$/.exec(key);
        if (!m) continue;
        const other = `${m[1]}.${m[2] === 'one' ? 'many' : 'one'}`;
        assert.ok(other in part.pt, `${key} sem o par ${other}`);
        assert.ok(vars(part.pt[key]).includes('n'), `${key} precisa de {n}`);
      }
    });
  }

  it('não há chave repetida entre as partes', () => {
    const seen = new Map<string, string>();
    for (const [name, part] of Object.entries(parts)) {
      for (const key of Object.keys(part.pt)) {
        assert.ok(!seen.has(key), `${key} aparece em ${seen.get(key)} e ${name}`);
        seen.set(key, name);
      }
    }
  });
});
