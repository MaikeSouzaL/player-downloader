/// <reference types="node" />
// Testes das ferramentas (links, PIN). Rodar com: npm test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { audioNameFor, blockedService, classifyLink, extensionOf, extractUrl, fileNameFor, isPageType, mediaTypeOf, playableOnIos } from '../src/lib/links.ts';
import { checkPin, hashPin, isValidPin, lockoutMs, makeSalt, sha256 } from '../src/lib/pin.ts';

describe('links', () => {
  it('recusa streaming e redes sociais', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://m.youtube.com/watch?v=abc',
      'https://music.youtube.com/watch?v=abc',
      'https://www.instagram.com/reel/x/',
      'https://vm.tiktok.com/xyz/',
      'https://open.spotify.com/track/1',
    ]) {
      assert.equal(classifyLink(url).kind, 'blocked', url);
    }
    assert.equal(blockedService('https://youtu.be/abc'), 'YouTube');
    assert.equal(blockedService('https://exemplo.com/youtube.com.mp3'), null);
  });

  it('aceita arquivos de mídia diretos pela extensão ou pelo tipo', () => {
    assert.deepEqual(classifyLink('https://site.com/podcast/ep1.mp3?x=1'), { kind: 'media', media: 'audio' });
    assert.deepEqual(classifyLink('https://site.com/v/clipe.mp4'), { kind: 'media', media: 'video' });
    assert.deepEqual(classifyLink('https://site.com/download?id=3', 'audio/mpeg; charset=binary'), { kind: 'media', media: 'audio' });
    assert.equal(classifyLink('https://site.com/artigo').kind, 'page');
    assert.equal(classifyLink('ftp://site.com/a.mp3').kind, 'invalid');
    assert.equal(classifyLink('não é link').kind, 'invalid');
  });

  it('acha o link no texto compartilhado', () => {
    assert.equal(extractUrl('Ouve isso: https://site.com/a.mp3, é bom!'), 'https://site.com/a.mp3');
    assert.equal(extractUrl('sem link'), null);
    assert.equal(extractUrl(null), null);
    // Parêntese do próprio link fica; o da frase sai.
    assert.equal(extractUrl('veja https://pt.wikipedia.org/wiki/Samba_(música).'), 'https://pt.wikipedia.org/wiki/Samba_(música)');
    assert.equal(extractUrl('(link: https://site.com/a.mp3)'), 'https://site.com/a.mp3');
  });

  it('recusa também os servidores de arquivos dos serviços e o host com ponto final', () => {
    for (const url of [
      'https://rr3---sn-abc.googlevideo.com/videoplayback?mime=audio%2Fmp4',
      'https://scontent.cdninstagram.com/v/t50/video.mp4',
      'https://video.twimg.com/ext_tw_video/1/vid/clip.mp4',
      'https://v.redd.it/abc/DASH_720.mp4',
      'https://cf-media.sndcdn.com/abc.mp3',
      'https://www.youtube.com./watch?v=abc',
    ]) {
      assert.equal(classifyLink(url).kind, 'blocked', url);
    }
  });

  it('nome do servidor não sai da pasta e tipos sem parâmetros', () => {
    assert.equal(fileNameFor('https://site.com/x', 'attachment; filename=".."', 'application/octet-stream'), 'download');
    assert.equal(fileNameFor('https://site.com/x', 'attachment; filename="../../segredo.mp3"'), '_.._segredo.mp3');
    assert.equal(fileNameFor('https://site.com/clipe', null, 'video/webm; codecs="vp9"'), 'clipe.webm');
    assert.equal(extractUrl('[veja https://site.com/a.mp3]…'), 'https://site.com/a.mp3');
    assert.equal(playableOnIos('musica.ogg'), false);
    assert.equal(playableOnIos('musica.m4a'), true);
    assert.equal(isPageType('text/html; charset=utf-8'), true);
    assert.equal(isPageType('audio/mpeg'), false);
  });

  it('página (HTML/texto) não vira download mesmo com extensão de mídia', () => {
    assert.equal(classifyLink('https://site.com/musica.mp3', 'text/html; charset=utf-8').kind, 'page');
    assert.equal(classifyLink('https://site.com/api/a.mp4', 'application/json').kind, 'page');
  });

  it('dá nome ao arquivo baixado', () => {
    assert.equal(fileNameFor('https://site.com/m%C3%BAsica%20boa.mp3'), 'música boa.mp3');
    assert.equal(fileNameFor('https://site.com/get?id=1', 'attachment; filename="Episódio 1.mp3"'), 'Episódio 1.mp3');
    assert.equal(fileNameFor('https://site.com/get?id=1', "attachment; filename*=UTF-8''Epis%C3%B3dio%202.m4a"), 'Episódio 2.m4a');
    assert.equal(fileNameFor('https://site.com/stream', null, 'audio/mpeg'), 'stream.mp3');
    assert.equal(fileNameFor('https://site.com/a/b:c.mp3'), 'b_c.mp3');
    assert.equal(audioNameFor('clipe.final.mp4'), 'clipe.final.m4a');
    assert.equal(extensionOf('https://x.com/a/B.MP3?q=1'), 'mp3');
    assert.equal(mediaTypeOf(null, 'show.webm'), 'video');
    assert.equal(mediaTypeOf('application/pdf', 'x.pdf'), null);
  });
});

describe('PIN', () => {
  it('SHA-256 igual ao do Node (inclusive acentos e textos longos)', () => {
    for (const text of ['', 'abc', 'senha:1234', 'ação çéu 🎵', 'a'.repeat(1000), 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64)]) {
      assert.equal(sha256(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 20)));
    }
  });

  it('confere o PIN com sal e rejeita o errado', () => {
    const salt = makeSalt();
    assert.match(salt, /^[0-9a-f]{32}$/);
    const stored = hashPin('2580', salt);
    assert.equal(checkPin('2580', salt, stored), true);
    assert.equal(checkPin('2581', salt, stored), false);
    assert.notEqual(hashPin('2580', makeSalt()), stored);
  });

  it('valida o formato e espera depois de muitos erros', () => {
    assert.equal(isValidPin('1234'), true);
    assert.equal(isValidPin('123456'), true);
    assert.equal(isValidPin('123'), false);
    assert.equal(isValidPin('12a4'), false);
    assert.equal(lockoutMs(4), 0);
    assert.equal(lockoutMs(5), 30_000);
    assert.equal(lockoutMs(10), 60_000);
    assert.equal(lockoutMs(100), 15 * 60_000);
  });
});
