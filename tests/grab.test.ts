/// <reference types="node" />
// Testes da fila de downloads do motor local. Rodar com: npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildStartPayload,
  canonicalUrl,
  chunk,
  decideRetry,
  grabKey,
  isActive,
  isFinished,
  planResume,
  planResumeBatch,
  type GrabTaskLike,
} from '../src/lib/grab-queue-logic.ts';
import { TimeoutError, withTimeout } from '../src/lib/timeout.ts';

const task = (over: Partial<GrabTaskLike> = {}): GrabTaskLike => ({
  id: 'job1',
  status: 'downloading',
  url: 'https://www.youtube.com/watch?v=abc&si=tracking',
  formatId: 'v:137',
  kind: 'video',
  title: 'Vídeo',
  hasAudio: false,
  subtitles: null,
  entryId: '',
  attempts: 0,
  ...over,
});

describe('fila de downloads: links e chaves', () => {
  it('canonicaliza host, rastreio, fragmento, barra final e youtu.be', () => {
    assert.equal(canonicalUrl(' HTTPS://WWW.YouTube.com/watch/?v=abc&si=xyz#t=10 '), 'https://youtube.com/watch?v=abc');
    assert.equal(canonicalUrl('https://youtu.be/abc?si=1'), 'https://youtube.com/watch?v=abc');
    assert.equal(canonicalUrl('https://www.youtube.com/watch?v=abc&list=PL1&index=2&t=30'), 'https://youtube.com/watch?v=abc');
    assert.equal(canonicalUrl('https://m.youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
    assert.equal(canonicalUrl('https://music.youtube.com/watch?v=abc&list=RD1'), 'https://youtube.com/watch?v=abc');
    assert.equal(canonicalUrl('https://example.com/v?b=2&utm_source=x&a=1#frag'), 'https://example.com/v?a=1&b=2');
    assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/');
    assert.equal(canonicalUrl('  não é link  '), 'não é link');
    assert.equal(canonicalUrl(null), '');
  });

  it('deduplica pelo mesmo vídeo/formato e separa entradas, formatos, tipo e legenda', () => {
    const base = grabKey({ url: 'https://www.youtube.com/watch?v=abc&si=x', entryId: '', formatId: 'v:137', kind: 'video', subtitles: null });
    const same = grabKey({ url: 'https://youtube.com/watch/?v=abc#t=1', entryId: '', formatId: 'v:137', kind: 'video', subtitles: null });
    assert.equal(base, same);
    assert.equal(base, grabKey({ url: 'https://youtube.com/watch?v=abc', entryId: '', formatId: 'v:137', kind: 'video', subtitles: null }));

    assert.notEqual(base, grabKey({ url: 'https://youtube.com/watch?v=abc', entryId: 'abc', formatId: 'v:137', kind: 'video', subtitles: null }));
    assert.notEqual(base, grabKey({ url: 'https://youtube.com/watch?v=abc', formatId: 'v:22', kind: 'video', subtitles: null }));
    assert.notEqual(base, grabKey({ url: 'https://youtube.com/watch?v=abc', formatId: 'v:137', kind: 'audio', subtitles: null }));
    assert.notEqual(base, grabKey({ url: 'https://youtube.com/watch?v=abc', formatId: 'v:137', kind: 'video', subtitles: 's:pt' }));
  });

  it('o mesmo vídeo no YouTube Music e no YouTube gera a mesma key', () => {
    const music = grabKey({
      url: 'https://music.youtube.com/watch?v=abc&list=RD1&si=share',
      entryId: '',
      formatId: 'a:mp3:192',
      kind: 'audio',
      subtitles: null,
    });
    const youtube = grabKey({
      url: 'https://www.youtube.com/watch?v=abc',
      entryId: '',
      formatId: 'a:mp3:192',
      kind: 'audio',
      subtitles: null,
    });
    assert.equal(music, youtube);
  });

  it('reiniciar mantém exatamente a mesma key', () => {
    const original = task({ entryId: 'abc', subtitles: 's:pt' });
    const key = grabKey({
      url: original.url,
      entryId: original.entryId,
      formatId: original.formatId,
      kind: original.kind,
      subtitles: original.subtitles,
    });
    const payload = buildStartPayload(original);
    assert.ok(payload);
    assert.equal(
      grabKey({
        url: payload.url,
        entryId: original.entryId,
        formatId: payload.formatId,
        kind: payload.options.kind,
        subtitles: payload.options.subtitles,
      }),
      key
    );
    assert.deepEqual(payload.options, { subtitles: 's:pt', hasAudio: false, title: 'Vídeo', kind: 'video' });
  });
});

describe('fila de downloads: retomada', () => {
  it('retoma somente as tarefas perdidas', () => {
    const plan = planResumeBatch(
      [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', status: 'done' }), task({ id: 'd', status: 'error' })],
      ['b', 'c', 'd']
    );
    assert.deepEqual(plan.restart, [{ id: 'b', attempts: 1 }]);
    assert.deepEqual(plan.keep, ['a', 'c', 'd']);
    assert.deepEqual(plan.fail, []);
  });

  it('não mexe em done, error nem cancelled', () => {
    assert.deepEqual(planResume(task({ status: 'done' })), { action: 'skip' });
    assert.deepEqual(planResume(task({ status: 'error' })), { action: 'skip' });
    assert.deepEqual(planResume(task({ status: 'cancelled' })), { action: 'skip' });
    assert.equal(isActive('done'), false);
    assert.equal(isActive('error'), false);
    assert.equal(isFinished('done'), true);
    assert.equal(isFinished('error'), true);
    assert.equal(isFinished('queued'), false);
  });

  it('sem URL/formato vira erro acionável em vez de reiniciar', () => {
    assert.deepEqual(planResume(task({ url: undefined })), { action: 'fail', reason: 'missing-url' });
    assert.deepEqual(planResume(task({ formatId: undefined })), { action: 'fail', reason: 'missing-url' });
    assert.equal(buildStartPayload(task({ url: undefined })), null);
    assert.equal(buildStartPayload(task({ formatId: '' })), null);
    assert.deepEqual(decideRetry(task({ url: undefined })), { action: 'fail', reason: 'missing-url' });
  });

  it('limita as tentativas automáticas a 3', () => {
    assert.deepEqual(planResume(task({ attempts: 0 })), { action: 'restart', attempts: 1 });
    assert.deepEqual(planResume(task({ attempts: 2 })), { action: 'restart', attempts: 3 });
    assert.deepEqual(planResume(task({ attempts: 3 })), { action: 'fail', reason: 'attempts' });
  });

  it('adota o job que ainda existe e entrega o que já está pronto', () => {
    assert.deepEqual(planResume(task(), { id: 'job1', status: 'downloading' }), {
      action: 'adopt',
      jobId: 'job1',
      jobStatus: 'downloading',
    });
    assert.deepEqual(planResume(task(), { id: 'job2', status: 'ready' }), { action: 'handoff', jobId: 'job2' });
  });

  it('retry consulta o job antes e só reinicia quando ele sumiu/terminou', () => {
    assert.deepEqual(decideRetry(task({ status: 'error' }), { id: 'job1', status: 'converting' }), {
      action: 'adopt',
      jobId: 'job1',
      jobStatus: 'converting',
    });
    assert.deepEqual(decideRetry(task({ status: 'error' }), { id: 'job1', status: 'ready' }), {
      action: 'handoff',
      jobId: 'job1',
    });
    assert.deepEqual(decideRetry(task({ status: 'error' }), { id: 'job1', status: 'error' }), { action: 'restart', attempts: 0 });
    assert.deepEqual(decideRetry(task({ status: 'error' })), { action: 'restart', attempts: 0 });
  });

  it('divide a consulta em lotes', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
    assert.deepEqual(chunk([1, 2], 0), [[1, 2]]);
  });
});

describe('timeout', () => {
  it('rejeita com TimeoutError quando o motor não responde', async () => {
    await assert.rejects(withTimeout(new Promise<never>(() => {}), 5), (error) => error instanceof TimeoutError);
  });

  it('devolve o valor quando chega antes do prazo', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok');
  });
});
