/// <reference types="node" />
// Testes da lógica pura (sem React Native). Rodar com: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { folderName, formatBytes, formatDuration, formatLongDuration, normalize, prettyPath } from '../src/lib/format.ts';
import { buildIndex, filterTracks, searchTracks, shuffled, sortTracks, type Track } from '../src/lib/library.ts';
import { activeLine, parseLyrics } from '../src/lib/lrc.ts';
import { neighborIndices } from '../src/lib/queue.ts';

const track = (over: Partial<Track>): Track => ({
  id: '1',
  uri: 'content://media/external/audio/media/1',
  title: 'Música',
  fileName: 'musica.mp3',
  artist: 'Artista',
  artistId: '10',
  album: 'Álbum',
  albumId: '100',
  duration: 180_000,
  path: '/storage/emulated/0/Music/musica.mp3',
  folder: '/storage/emulated/0/Music',
  size: 4_000_000,
  dateAdded: 1_700_000_000_000,
  track: 1,
  year: 2020,
  mime: 'audio/mpeg',
  isMusic: true,
  ...over,
});

describe('format', () => {
  it('formata durações', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(65_000), '1:05');
    assert.equal(formatDuration(3_725_000), '1:02:05');
    assert.equal(formatLongDuration(48 * 60_000), '48 min');
    assert.equal(formatLongDuration(135 * 60_000), '2 h 15 min');
  });
  it('formata tamanhos e caminhos', () => {
    assert.equal(formatBytes(4_000_000), '3,8 MB');
    assert.equal(folderName('/storage/emulated/0/Music/Rock/'), 'Rock');
    assert.equal(prettyPath('/storage/emulated/0/Download'), 'Armazenamento interno/Download');
    assert.equal(prettyPath('/storage/1A2B-3C4D/Music', { internal: 'Internal storage', card: (n) => `SD card ${n}` }), 'SD card 1A2B-3C4D/Music');
    assert.equal(normalize('Ação Çéu'), 'acao ceu');
  });
});

describe('LRC', () => {
  it('lê tempos, múltiplos tempos por linha e offset', () => {
    const lyrics = parseLyrics('[ti:Teste]\n[offset:500]\n[00:01.00][00:10.50]Refrão\n[00:05.2]Verso\n');
    assert.equal(lyrics.synced, true);
    assert.deepEqual(
      lyrics.lines.map((l) => [l.time, l.text]),
      [
        [500, 'Refrão'],
        [4700, 'Verso'],
        [10000, 'Refrão'],
      ]
    );
  });
  it('trata texto simples como letra não sincronizada', () => {
    const lyrics = parseLyrics('\nPrimeira\n\nSegunda\n');
    assert.equal(lyrics.synced, false);
    assert.deepEqual(lyrics.lines.map((l) => l.text), ['Primeira', '', 'Segunda']);
  });
  it('acha a linha ativa', () => {
    const { lines } = parseLyrics('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
    assert.equal(activeLine(lines, 500), -1);
    assert.equal(activeLine(lines, 1000), 0);
    assert.equal(activeLine(lines, 2500), 1);
    assert.equal(activeLine(lines, 99_000), 2);
  });
});

describe('biblioteca', () => {
  const tracks = [
    track({ id: '1', title: 'Bravo', artist: 'Zeca', album: 'A', albumId: 'a', track: 2, dateAdded: 3, duration: 200_000 }),
    track({ id: '2', title: 'alfa', artist: 'Ana', album: 'A', albumId: 'a', track: 1, dateAdded: 1, duration: 90_000 }),
    track({ id: '3', title: 'Charlie', artist: null, album: null, albumId: 'b', dateAdded: 2, duration: 10_000, folder: '/x/WhatsApp' }),
    track({ id: '4', title: 'Delta', artist: 'ana', albumId: 'c', dateAdded: 4, duration: 60_000 }),
  ];

  it('filtra por duração, pasta e músicas ocultas', () => {
    const ids = (list: Track[]) => list.map((t) => t.id);
    assert.deepEqual(ids(filterTracks(tracks, { minDurationMs: 30_000, hiddenFolders: [], hiddenTracks: [] })), ['1', '2', '4']);
    assert.deepEqual(ids(filterTracks(tracks, { minDurationMs: 0, hiddenFolders: ['/x/WhatsApp'], hiddenTracks: ['4'] })), ['1', '2']);
  });

  it('ordena com direção', () => {
    assert.deepEqual(sortTracks(tracks, 'title').map((t) => t.id), ['2', '1', '3', '4']);
    assert.deepEqual(sortTracks(tracks, 'recent').map((t) => t.id), ['4', '1', '3', '2']);
    assert.deepEqual(sortTracks(tracks, 'recent', true).map((t) => t.id), ['2', '3', '1', '4']);
    assert.deepEqual(sortTracks(tracks, 'duration').map((t) => t.id), ['1', '2', '4', '3']);
  });

  it('agrupa álbuns, artistas (sem diferenciar maiúsculas) e pastas', () => {
    const index = buildIndex(tracks);
    const albumA = index.albumById.get('a')!;
    assert.deepEqual(albumA.tracks.map((t) => t.id), ['2', '1']);
    assert.equal(albumA.artist, 'Vários artistas');
    const ana = index.artists.find((a) => a.id === 'ana')!;
    assert.equal(ana.tracks.length, 2);
    assert.equal(index.artists[index.artists.length - 1].name, 'Artista desconhecido');
    assert.equal(index.folders.length, 2);
  });

  it('busca por título, artista e álbum, sem acento', () => {
    const index = buildIndex(tracks);
    assert.deepEqual(searchTracks(index, 'ALFA').map((t) => t.id), ['2']);
    assert.deepEqual(searchTracks(index, 'ana').map((t) => t.id).sort(), ['2', '4']);
    assert.deepEqual(searchTracks(index, ''), []);
  });

  it('embaralha mantendo a primeira', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffled([1, 2, 3, 4, 5], 3, random);
    assert.equal(out[0], 3);
    assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  });
});

import { mergeValidated } from '../src/lib/merge.ts';

describe('dados salvos', () => {
  const defaults = { theme: 'system', minDurationSec: 30, hiddenTracks: [] as string[], equalizer: { enabled: false }, set: () => {} };

  it('aceita campos válidos e ignora os corrompidos', () => {
    const merged = mergeValidated({ theme: 'dark', minDurationSec: 'trinta', hiddenTracks: { x: 1 }, equalizer: null, extra: 1 }, defaults);
    assert.equal(merged.theme, 'dark');
    assert.equal(merged.minDurationSec, 30);
    assert.deepEqual(merged.hiddenTracks, []);
    assert.deepEqual(merged.equalizer, { enabled: false });
    assert.equal('extra' in merged, false);
    assert.equal(typeof merged.set, 'function');
  });

  it('volta aos padrões se o salvo não for um objeto', () => {
    assert.equal(mergeValidated(null, defaults), defaults);
    assert.equal(mergeValidated('lixo', defaults), defaults);
    assert.equal(mergeValidated([1, 2], defaults), defaults);
  });
});

describe('desempenho', () => {
  it('indexa e busca 10 mil músicas rápido', () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      track({ id: String(i), title: `Faixa ${i} ${i % 7 === 0 ? 'Saudade' : 'Canção'}`, artist: `Artista ${i % 300}`, albumId: String(i % 900), album: `Álbum ${i % 900}` })
    );
    const started = performance.now();
    const index = buildIndex(many);
    const hits = searchTracks(index, 'saudade artista 3');
    sortTracks(many, 'title');
    const elapsed = performance.now() - started;
    assert.ok(index.albums.length === 900 && index.artists.length === 300);
    assert.ok(hits.length > 0);
    assert.ok(elapsed < 3000, `levou ${Math.round(elapsed)} ms`);
  });
});

import { matchesQuery, searchGroups } from '../src/lib/library.ts';

describe('busca em seções', () => {
  const tracks = [
    track({ id: '1', title: 'Garota de Ipanema', artist: 'Tom Jobim', album: 'Getz/Gilberto', albumId: 'g', folder: '/m/Bossa' }),
    track({ id: '2', title: 'Águas de Março', artist: 'Elis & Tom', album: 'Elis & Tom', albumId: 'e', folder: '/m/Bossa' }),
    track({ id: '3', title: 'Construção', artist: 'Chico Buarque', album: 'Construção', albumId: 'c', folder: '/m/MPB' }),
  ];
  it('casa palavras sem acento', () => {
    assert.equal(matchesQuery('Águas de Março', 'aguas marco'), true);
    assert.equal(matchesQuery('Águas de Março', 'agua chuva'), false);
    assert.equal(matchesQuery('qualquer', '   '), false);
  });
  it('agrupa músicas, artistas, álbuns e pastas', () => {
    const groups = searchGroups(buildIndex(tracks), 'tom');
    assert.deepEqual(groups.tracks.map((t) => t.id).sort(), ['1', '2']);
    assert.deepEqual(groups.artists.map((a) => a.name).sort(), ['Elis & Tom', 'Tom Jobim']);
    assert.deepEqual(groups.albums.map((a) => a.name).sort(), ['Elis & Tom', 'Getz/Gilberto']);
    assert.deepEqual(searchGroups(buildIndex(tracks), 'bossa').folders.map((f) => f.name), ['Bossa']);
    assert.deepEqual(searchGroups(buildIndex(tracks), '').tracks, []);
  });
});

import { sortAlbums, sortArtists, sortFolders } from '../src/lib/library.ts';

describe('ordenação das abas', () => {
  const tracks = [
    track({ id: '1', album: 'Zebra', albumId: 'z', artist: 'Ana', year: 1990, folder: '/m/b' }),
    track({ id: '2', album: 'Abelha', albumId: 'a', artist: 'Bia', year: 2020, folder: '/m/a' }),
    track({ id: '3', album: 'Abelha', albumId: 'a', artist: 'Bia', year: 2020, folder: '/m/a' }),
  ];
  const index = buildIndex(tracks);
  it('álbuns por nome, ano e quantidade', () => {
    assert.deepEqual(sortAlbums(index.albums, { key: 'name', desc: false }).map((a) => a.name), ['Abelha', 'Zebra']);
    assert.deepEqual(sortAlbums(index.albums, { key: 'name', desc: true }).map((a) => a.name), ['Zebra', 'Abelha']);
    assert.deepEqual(sortAlbums(index.albums, { key: 'year', desc: false }).map((a) => a.year), [2020, 1990]);
    assert.deepEqual(sortAlbums(index.albums, { key: 'count', desc: false }).map((a) => a.id), ['a', 'z']);
  });
  it('artistas e pastas por quantidade', () => {
    assert.deepEqual(sortArtists(index.artists, { key: 'count', desc: false }).map((a) => a.name), ['Bia', 'Ana']);
    assert.deepEqual(sortFolders(index.folders, { key: 'count', desc: false }).map((f) => f.name), ['a', 'b']);
    assert.deepEqual(sortFolders(index.folders, { key: 'name', desc: true }).map((f) => f.name), ['b', 'a']);
  });
});

describe('fila: anterior e próxima', () => {
  it('segue a ordem natural sem dar a volta', () => {
    assert.deepEqual(neighborIndices([], 3, 0, false), { previous: null, next: 1 });
    assert.deepEqual(neighborIndices([], 3, 2, false), { previous: 1, next: null });
  });
  it('dá a volta com repetir tudo', () => {
    assert.deepEqual(neighborIndices([0, 1, 2], 3, 2, true), { previous: 1, next: 0 });
    assert.deepEqual(neighborIndices([0, 1, 2], 3, 0, true), { previous: 2, next: 1 });
  });
  it('usa a ordem do aleatório', () => {
    assert.deepEqual(neighborIndices([2, 0, 3, 1], 4, 0, false), { previous: 2, next: 3 });
  });
  it('ignora ordem desatualizada e casos sem vizinhos', () => {
    assert.deepEqual(neighborIndices([1, 0], 3, 1, false), { previous: 0, next: 2 });
    assert.deepEqual(neighborIndices([0], 1, 0, true), { previous: null, next: null });
    assert.deepEqual(neighborIndices([], 0, -1, false), { previous: null, next: null });
    assert.deepEqual(neighborIndices([], 3, 7, false), { previous: null, next: null });
  });
});
