/// <reference types="node" />
// Testes da Fase 3 (letra online, M3U e backup). Rodar com: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBackup, mergeCollections, parseBackup, remapIds, type TrackRef } from '../src/lib/backup.ts';
import { cleanTitle, findLyrics, rankMatches, type LrclibRecord } from '../src/lib/lrclib.ts';
import { cleanPath, matchEntries, parseM3U, writeM3U } from '../src/lib/m3u.ts';

const rec = (over: Partial<LrclibRecord>): LrclibRecord => ({
  id: 1,
  trackName: 'Garota de Ipanema',
  artistName: 'Tom Jobim',
  albumName: 'Getz/Gilberto',
  duration: 320,
  instrumental: false,
  plainLyrics: 'Olha que coisa mais linda',
  syncedLyrics: '[00:12.00]Olha que coisa mais linda',
  ...over,
});

describe('LRCLIB', () => {
  it('limpa títulos de arquivo e de vídeo', () => {
    assert.equal(cleanTitle('03 - Garota de Ipanema (Official Video).mp3'), 'Garota de Ipanema');
    assert.equal(cleanTitle('Evidências [Lyrics] feat. Fulano'), 'Evidências');
    assert.equal(cleanTitle('Aquarela (ao vivo)'), 'Aquarela (ao vivo)');
  });

  it('prefere título/artista iguais, duração próxima e letra sincronizada', () => {
    const ranked = rankMatches(
      [rec({ id: 1, syncedLyrics: null }), rec({ id: 2 }), rec({ id: 3, trackName: 'Outra música', duration: 410 }), rec({ id: 4, duration: 900 }), { lixo: true }],
      { title: 'Garota de Ipanema', artist: 'Tom Jobim', durationMs: 321_000 }
    );
    assert.deepEqual(
      ranked.map((m) => m.id),
      [2, 1]
    );
    assert.equal(ranked[0].synced, true);
    assert.match(ranked[0].text, /^\[00:12/);
  });

  it('busca exata e depois a ampla; 404 não é erro', async () => {
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      if (url.includes('/get?')) return { ok: false, status: 404, json: async () => null };
      return { ok: true, status: 200, json: async () => [rec({ id: 9 })] };
    };
    const found = await findLyrics({ title: 'Garota de Ipanema', artist: 'Tom Jobim', durationMs: 320_000 }, fake);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/api\/get\?track_name=Garota\+de\+Ipanema&artist_name=Tom\+Jobim&duration=320/);
    assert.deepEqual(
      found.map((m) => m.id),
      [9]
    );
  });

  it('sem artista conhecido busca só pelo título', async () => {
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    };
    await findLyrics({ title: 'Aquarela', artist: 'Artista desconhecido', durationMs: 200_000 }, fake);
    assert.deepEqual(calls, ['https://lrclib.net/api/search?q=Aquarela']);
  });

  it('erro de rede vira mensagem amigável', async () => {
    const fake = async () => {
      throw new TypeError('Network request failed');
    };
    await assert.rejects(findLyrics({ title: 'X', artist: 'Y', durationMs: 1000 }, fake), /Sem conexão/);
  });
});

const lib = [
  { id: '1', path: '/storage/emulated/0/Music/Rock/a.mp3', fileName: 'a.mp3', title: 'Alfa', artist: 'Banda', duration: 200_000 },
  { id: '2', path: '/storage/emulated/0/Music/Pop/b.mp3', fileName: 'b.mp3', title: 'Beta', artist: 'Cantora', duration: 180_000 },
  { id: '3', path: '/storage/emulated/0/Download/b.mp3', fileName: 'b.mp3', title: 'Beta (demo)', artist: null, duration: 90_000 },
];

describe('M3U', () => {
  it('lê #EXTINF, #PLAYLIST e caminhos de vários formatos', () => {
    const { name, entries } = parseM3U(
      '﻿#EXTM3U\r\n#PLAYLIST:Viagem\r\n#EXTINF:200,Banda - Alfa\r\nfile:///storage/emulated/0/Music/Rock/a.mp3\r\n\r\nMusic\\Pop\\b.mp3\n#EXTINF:-1,Sem Artista\nC%C3%A9u.mp3\n'
    );
    assert.equal(name, 'Viagem');
    assert.deepEqual(entries[0], { path: '/storage/emulated/0/Music/Rock/a.mp3', title: 'Alfa', artist: 'Banda', durationSec: 200 });
    assert.equal(entries[1].path, 'Music/Pop/b.mp3');
    assert.equal(entries[1].title, null);
    assert.deepEqual(entries[2], { path: 'Céu.mp3', title: 'Sem Artista', artist: null, durationSec: null });
    assert.equal(cleanPath('a//b\\c.mp3'), 'a/b/c.mp3');
  });

  it('liga por caminho, pasta + arquivo e título; nome repetido não chuta', () => {
    const { matched, missing } = matchEntries(
      [
        { path: '/sdcard/Music/Rock/a.mp3', title: null, artist: null, durationSec: null },
        { path: 'Pop/b.mp3', title: null, artist: null, durationSec: null },
        { path: 'b.mp3', title: null, artist: null, durationSec: null },
        { path: 'outro.mp3', title: 'Alfa', artist: 'Banda', durationSec: null },
        { path: 'nada.mp3', title: 'Nada', artist: null, durationSec: null },
      ],
      lib
    );
    assert.deepEqual(
      matched.map((t) => t.id),
      ['1', '2', '1']
    );
    assert.deepEqual(
      missing.map((e) => e.path),
      ['b.mp3', 'nada.mp3']
    );
  });

  it('exporta e lê de volta', () => {
    const text = writeM3U('Minha\nLista', lib);
    assert.ok(text.startsWith('#EXTM3U\n#PLAYLIST:Minha Lista\n#EXTINF:200,Banda - Alfa\n/storage/emulated/0/Music/Rock/a.mp3\n'));
    const back = parseM3U(text);
    assert.equal(back.entries.length, 3);
    assert.deepEqual(
      matchEntries(back.entries, lib).matched.map((t) => t.id),
      ['1', '2', '3']
    );
  });
});

describe('backup', () => {
  const library = lib.map(({ id, path, title, artist, duration }) => ({ id, path, title, artist, duration }));
  const backup = createBackup({
    appVersion: '1.2.0',
    settings: { theme: 'dark', onboarded: true, hiddenFolders: ['/x'], grabServer: '192.168.0.10:8787', grabKey: 'segredo', reportErrors: true, set: () => {} },
    playlists: [{ name: 'Viagem', trackIds: ['1', '2'], createdAt: 5 }],
    liked: ['2'],
    recent: ['1'],
    plays: { '1': 3 },
    playTime: { '2026-10-19': 60_000 },
    edits: { '1': { title: 'Alfa!', cover: 'file:///covers/1.jpg' } },
    lyrics: { '2': '[00:01.00]oi' },
    library,
    now: new Date('2026-10-20T12:00:00Z'),
  });

  it('guarda só o que é portátil e as referências das músicas usadas', () => {
    assert.deepEqual(backup.settings, { theme: 'dark' });
    assert.deepEqual(Object.keys(backup.tracks).sort(), ['1', '2']);
    assert.deepEqual(backup.edits, { '1': { title: 'Alfa!' } });
    assert.equal(backup.createdAt, '2026-10-20T12:00:00.000Z');
  });

  it('valida o arquivo', () => {
    assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
    assert.throws(() => parseBackup('{nope'), /JSON corrompido/);
    assert.throws(() => parseBackup('{"format":"outro"}'), /não é um backup do Ritmo/);
    assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 99 })), /versão mais nova/);
    const dirty = parseBackup(JSON.stringify({ ...backup, liked: ['2', 7, null], plays: { '1': -4, '2': 'x', '3': 2 } }));
    assert.deepEqual(dirty.liked, ['2']);
    assert.deepEqual(dirty.plays, { '3': 2 });
  });

  it('reencontra músicas com IDs novos em outro aparelho', () => {
    const refs: Record<string, TrackRef> = {
      '1': { path: '/storage/emulated/0/Music/Rock/a.mp3', title: 'Alfa', artist: 'Banda', duration: 200_000 },
      '50': { path: '/storage/emulated/0/Music/Pop/b.mp3', title: 'Beta', artist: 'Cantora', duration: 180_000 },
      '60': { path: '/sdcard/Antigo/b.mp3', title: 'Beta', artist: 'Cantora', duration: 181_000 },
      '70': { path: null, title: 'Beta (demo)', artist: null, duration: 90_500 },
      '80': { path: '/x/sumiu.mp3', title: 'Sumiu', artist: null, duration: 1000 },
    };
    const ids = remapIds(refs, library);
    assert.equal(ids.get('1'), '1');
    assert.equal(ids.get('50'), '2');
    assert.equal(ids.get('60'), '2');
    assert.equal(ids.get('70'), '3');
    assert.equal(ids.has('80'), false);
  });

  it('na dúvida não chuta: nome de arquivo repetido com duração parecida fica como não encontrado', () => {
    const twins = [
      { id: '10', path: '/storage/emulated/0/Music/A/01.mp3', title: 'Abertura', artist: 'Banda A', duration: 200_000 },
      { id: '11', path: '/storage/emulated/0/Music/B/01.mp3', title: 'Intro', artist: 'Banda B', duration: 201_000 },
    ];
    const ids = remapIds({ '99': { path: '/sdcard/Velho/01.mp3', title: 'Outra', artist: null, duration: 200_500 } }, twins);
    assert.equal(ids.has('99'), false);
    // Mesmo ID mas outra música (ID reaproveitado pelo MediaStore): não liga.
    const reused = remapIds({ '10': { path: '/storage/emulated/0/Old/x.mp3', title: 'X', artist: null, duration: 1 } }, twins);
    assert.equal(reused.has('10'), false);
  });

  it('mescla sem apagar nada do que já existe', () => {
    const current = {
      playlists: [{ id: 'p1', name: 'viagem', trackIds: ['3'], createdAt: 1, updatedAt: 1 }],
      liked: ['3'],
      recent: ['3'],
      plays: { '1': 5 },
      playTime: { '2026-10-19': 10_000, '2026-10-20': 1 },
    };
    const ids = remapIds(backup.tracks, library);
    let n = 0;
    const merged = mergeCollections(current, parseBackup(JSON.stringify(backup)), ids, () => `new${++n}`, 99);
    assert.deepEqual(merged.playlists, [{ id: 'p1', name: 'viagem', trackIds: ['3', '1', '2'], createdAt: 1, updatedAt: 99 }]);
    assert.deepEqual(merged.liked, ['3', '2']);
    assert.deepEqual(merged.recent, ['3', '1']);
    assert.deepEqual(merged.plays, { '1': 5 });
    assert.deepEqual(merged.playTime, { '2026-10-19': 60_000, '2026-10-20': 1 });
    assert.deepEqual(merged.stats, { playlists: 0, tracks: 2, missing: 0 });
  });
});
