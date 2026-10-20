import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { TrackEdit } from '@/lib/library';
import { mergeValidated } from '@/lib/merge';
import { persistStorage } from '@/store/storage';

type EditsState = {
  /** Edições por ID da faixa; o arquivo de áudio nunca é alterado. */
  edits: Record<string, TrackEdit>;
  saveEdit: (id: string, edit: TrackEdit) => void;
  clearEdit: (id: string) => void;
  replaceAll: (edits: Record<string, TrackEdit>) => void;
};

const coversDir = () => new Directory(Paths.document, 'covers');

/** Copia a imagem escolhida para a pasta do app (o original da galeria pode sumir). */
export function storeCover(trackId: string, sourceUri: string): string {
  const dir = coversDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `${trackId}-${Date.now()}.jpg`);
  new File(sourceUri).copySync(target);
  return target.uri;
}

function deleteCover(uri: string | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Arquivo já removido: nada a fazer.
  }
}

export const useEdits = create<EditsState>()(
  persist(
    (set, get) => ({
      edits: {},
      saveEdit: (id, edit) => {
        const previous = get().edits[id];
        if (previous?.cover && previous.cover !== edit.cover) deleteCover(previous.cover);
        const clean: TrackEdit = {};
        if (edit.title?.trim()) clean.title = edit.title.trim();
        if (edit.artist?.trim()) clean.artist = edit.artist.trim();
        if (edit.album?.trim()) clean.album = edit.album.trim();
        if (edit.cover) clean.cover = edit.cover;
        const edits = { ...get().edits };
        if (Object.keys(clean).length) edits[id] = clean;
        else delete edits[id];
        set({ edits });
      },
      clearEdit: (id) => {
        deleteCover(get().edits[id]?.cover);
        const edits = { ...get().edits };
        delete edits[id];
        set({ edits });
      },
      replaceAll: (edits) => set({ edits }),
    }),
    { name: 'edits', storage: persistStorage, version: 1, merge: mergeValidated }
  )
);
