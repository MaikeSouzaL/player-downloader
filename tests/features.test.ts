/// <reference types="node" />
// Testes dos recursos da 1.5 (cores da capa, audiolivro, retrospectiva, podcasts, grades). Rodar com: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLong, LONG_TRACK_MS, resumePosition, trimSpots } from '../src/lib/audiobook.ts';
import { contrast, coverPalette, parseHex, rgbaOf, toHex } from '../src/lib/cover-colors.ts';
import { folderName, prettyPath } from '../src/lib/format.ts';
import { gridColumns } from '../src/lib/layout.ts';
import { buildRecap, keepRecentMonths, monthKey, shiftMonth } from '../src/lib/recap.ts';
import { decodeEntities, newEpisodes, parseDuration, parseFeed } from '../src/lib/rss.ts';

describe('cores da capa', () => {
  it('converte hex e rgba', () => {
    assert.deepEqual(parseHex('#2596FF'), { r: 37, g: 150, b: 255 });
    assert.equal(parseHex('azul'), null);
    assert.equal(toHex({ r: 37, g: 150, b: 255 }), '#2596FF');
    assert.equal(rgbaOf('#0A0A0A', 0.9), 'rgba(10,10,10,0.9)');
  });

  it('destaque com contraste legível no escuro e no claro', () => {
    for (const [dominant, isDark, bg] of [
      ['#DC1E28', true, '#0A0A0A'],
      ['#1E3C8C', true, '#000000'],
      ['#F2C94C', false, '#FFFFFF'],
      ['#11998E', false, '#FFFFFF'],
    ] as const) {
      const p = coverPalette(dominant, isDark, bg)!;
      assert.ok(p.accent, dominant);
      assert.ok(contrast(parseHex(p.accent!)!, parseHex(bg)!) >= 3, `${dominant}: contraste ${contrast(parseHex(p.accent!)!, parseHex(bg)!)}`);
      assert.ok(contrast(parseHex(p.accent!)!, parseHex(p.onAccent)!) >= 3, `${dominant}: ícone sobre o destaque`);
      assert.match(p.tint, /^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
    }
  });

  it('capa acinzentada mantém o destaque do tema', () => {
    const p = coverPalette('#808080', true, '#0A0A0A')!;
    assert.equal(p.accent, null);
    assert.equal(coverPalette('xyz', true, '#000000'), null);
  });
});

describe('lembrar onde parou', () => {
  const hour = 60 * 60_000;
  it('só arquivos de 20 minutos ou mais', () => {
    assert.equal(isLong(LONG_TRACK_MS), true);
    assert.equal(isLong(LONG_TRACK_MS - 1), false);
  });

  it('continua do meio; começo, fim e arquivo diferente começam de novo', () => {
    assert.equal(resumePosition({ position: 25 * 60_000, duration: hour, at: 1 }, hour), 25 * 60_000);
    assert.equal(resumePosition({ position: 10_000, duration: hour, at: 1 }, hour), null);
    assert.equal(resumePosition({ position: hour - 20_000, duration: hour, at: 1 }, hour), null);
    assert.equal(resumePosition({ position: 25 * 60_000, duration: 2 * hour, at: 1 }, hour), null);
    assert.equal(resumePosition(undefined, hour), null);
    assert.equal(resumePosition({ position: 5 * 60_000, duration: 10 * 60_000, at: 1 }, 10 * 60_000), null);
  });

  it('guarda só os mais recentes', () => {
    const spots = { a: { at: 1 }, b: { at: 3 }, c: { at: 2 } };
    assert.deepEqual(Object.keys(trimSpots(spots, 2)).sort(), ['b', 'c']);
    assert.equal(trimSpots(spots, 5), spots);
  });
});

describe('retrospectiva', () => {
  it('navega entre meses e limita o histórico', () => {
    assert.equal(monthKey(new Date(2026, 0, 15)), '2026-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2025-12', 1), '2026-01');
    assert.equal(shiftMonth('2026-10', -14), '2025-08');
    assert.deepEqual(Object.keys(keepRecentMonths({ '2026-01': 1, '2026-03': 1, '2025-12': 1 }, 2)).sort(), ['2026-01', '2026-03']);
  });

  it('soma o mês e ordena músicas e artistas', () => {
    const artists: Record<string, string> = { t1: 'Banda A', t2: 'Banda B', t3: 'Banda A' };
    const recap = buildRecap(
      '2026-10',
      { t1: 5, t2: 3, t3: 4, sumiu: 2 },
      { '2026-10-01': 30 * 60_000, '2026-10-02': 30_000, '2026-09-30': 99 * 60_000 },
      (id) => artists[id] ?? null
    );
    assert.equal(recap.listenedMs, 30 * 60_000 + 30_000);
    assert.equal(recap.days, 1);
    assert.equal(recap.plays, 14);
    assert.deepEqual(recap.topTracks.map((r) => r.id), ['t1', 't3', 't2', 'sumiu']);
    assert.deepEqual(recap.topArtists, [
      { id: 'Banda A', count: 9 },
      { id: 'Banda B', count: 3 },
    ]);
    assert.equal(buildRecap('2026-11', undefined, {}, () => null).plays, 0);
  });
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title><![CDATA[Café &amp; Código]]></title>
  <itunes:author>Equipe Exemplo</itunes:author>
  <itunes:image href="https://exemplo.com/capa.jpg"/>
  <image><url>https://exemplo.com/pequena.jpg</url><title>ignorado</title></image>
  <item>
    <title>Episódio 2 – O retorno</title>
    <guid isPermaLink="false">ep-2</guid>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <description><![CDATA[<p>Conversa sobre <b>apps</b> &#8212; parte 2</p>]]></description>
    <enclosure url="https://cdn.exemplo.com/ep2.mp3?x=1&amp;y=2" length="12345" type="audio/mpeg"/>
  </item>
  <item>
    <title>Só vídeo</title>
    <enclosure url="https://cdn.exemplo.com/ep.mp4" type="video/mp4"/>
  </item>
  <item>
    <title>Episódio 1</title>
    <itunes:duration>754</itunes:duration>
    <enclosure url='https://cdn.exemplo.com/ep1.m4a' length='0'/>
  </item>
</channel>
</rss>`;

describe('podcasts (RSS)', () => {
  it('lê canal, capa e só os episódios com áudio', () => {
    const feed = parseFeed(FEED)!;
    assert.equal(feed.title, 'Café & Código');
    assert.equal(feed.author, 'Equipe Exemplo');
    assert.equal(feed.image, 'https://exemplo.com/capa.jpg');
    assert.equal(feed.episodes.length, 2);
    const [ep2, ep1] = feed.episodes;
    assert.equal(ep2.id, 'ep-2');
    assert.equal(ep2.title, 'Episódio 2 – O retorno');
    assert.equal(ep2.audioUrl, 'https://cdn.exemplo.com/ep2.mp3?x=1&y=2');
    assert.equal(ep2.mime, 'audio/mpeg');
    assert.equal(ep2.size, 12345);
    assert.equal(ep2.durationMs, (3600 + 2 * 60 + 3) * 1000);
    assert.equal(ep2.publishedAt, Date.UTC(2026, 9, 20, 10));
    assert.equal(ep2.description, 'Conversa sobre apps — parte 2');
    // Sem guid e sem tipo: vale o link e a extensão de áudio.
    assert.equal(ep1.id, 'https://cdn.exemplo.com/ep1.m4a');
    assert.equal(ep1.size, -1);
    assert.equal(ep1.durationMs, 754_000);
  });

  it('recusa o que não é feed e acha episódios novos', () => {
    assert.equal(parseFeed('<html><body>oi</body></html>'), null);
    const feed = parseFeed(FEED)!;
    assert.deepEqual(newEpisodes(feed.episodes.slice(1), feed.episodes).map((e) => e.id), ['ep-2']);
  });

  it('durações e entidades', () => {
    assert.equal(parseDuration('45:10'), (45 * 60 + 10) * 1000);
    assert.equal(parseDuration('90.5'), 90_500);
    assert.equal(parseDuration(''), 0);
    assert.equal(parseDuration('abc'), 0);
    assert.equal(decodeEntities('R&amp;B &#x2019;n&#39; &lt;3 &bogus;'), 'R&B ’n\' <3 &bogus;');
  });
});

describe('grades', () => {
  it('mais colunas com a tela larga', () => {
    assert.equal(gridColumns(390), 2);
    assert.equal(gridColumns(700), 3);
    assert.equal(gridColumns(900), 4);
    assert.equal(gridColumns(1200), 5);
  });
});

describe('nome do app nas pastas do iPhone', () => {
  it('a raiz "Ritmo" aparece como Player Downloader; caminhos do Android não mudam', () => {
    assert.equal(folderName('Ritmo'), 'Player Downloader');
    assert.equal(folderName('Ritmo/Rock'), 'Rock');
    assert.equal(prettyPath('Ritmo/Rock'), 'Player Downloader/Rock');
    assert.equal(prettyPath('Ritmos/Samba'), 'Ritmos/Samba');
    assert.equal(folderName('/storage/emulated/0/Music/Ritmo'), 'Ritmo');
  });
});
