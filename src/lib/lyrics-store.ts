import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import RitmoCore from '@/modules/ritmo-core';
import type { Track } from '@/lib/library';

export type LyricsSource = 'custom' | 'lrc' | 'embedded';

const dir = () => new Directory(Paths.document, 'lyrics');
const fileFor = (trackId: string) => new File(dir(), `${trackId}.lrc`);

/** Muda a cada letra salva ou removida, para a tela do player recarregar. */
export const useLyricsVersion = create<{ version: number }>()(() => ({ version: 0 }));
const bump = () => useLyricsVersion.setState((s) => ({ version: s.version + 1 }));

const cache = new Map<string, { source: LyricsSource; text: string } | null>();

/** Letra salva pelo usuário > arquivo .lrc ao lado da música > letra embutida no MP3. */
export async function loadLyrics(track: Track): Promise<{ source: LyricsSource; text: string } | null> {
  if (cache.has(track.id)) return cache.get(track.id)!;
  let result: { source: LyricsSource; text: string } | null = null;
  const custom = fileFor(track.id);
  if (custom.exists) {
    result = { source: 'custom', text: await custom.text() };
  } else {
    try {
      result = await RitmoCore.readLyrics(track.path, track.uri);
    } catch {
      result = null;
    }
  }
  cache.set(track.id, result);
  return result;
}

export async function saveLyrics(trackId: string, text: string): Promise<void> {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true });
  const file = fileFor(trackId);
  if (!file.exists) file.create();
  await file.write(text);
  cache.set(trackId, { source: 'custom', text });
  bump();
}

export function deleteLyrics(trackId: string): void {
  const file = fileFor(trackId);
  if (file.exists) file.delete();
  cache.delete(trackId);
  bump();
}
