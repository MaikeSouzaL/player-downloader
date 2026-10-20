import { useEffect, useState } from 'react';

import RitmoCore from '@/modules/ritmo-core';
import type { Track } from '@/lib/library';
import { HAS_NATIVE } from '@/lib/platform';

export type ArtSize = 'small' | 'large';
const PX: Record<ArtSize, number> = { small: 200, large: 900 };

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function fetchArtwork(key: string, albumId: string, trackUri: string, size: ArtSize): Promise<string | null> {
  let promise = inflight.get(key);
  if (!promise) {
    promise = RitmoCore.getArtwork(albumId, trackUri, PX[size])
      .catch(() => null)
      .then((uri) => {
        cache.set(key, uri);
        inflight.delete(key);
        return uri;
      });
    inflight.set(key, promise);
  }
  return promise;
}

/**
 * Capa do álbum de uma faixa (cacheada em disco pelo módulo nativo e em memória aqui).
 * `undefined` enquanto carrega, `null` se o álbum não tem capa.
 */
export function useArtwork(track: Pick<Track, 'albumId' | 'uri'> | undefined, size: ArtSize = 'small'): string | null | undefined {
  const key = track ? `${track.albumId}:${size}` : '';
  const [loaded, setLoaded] = useState<{ key: string; uri: string | null } | null>(null);

  useEffect(() => {
    if (!track || !HAS_NATIVE || cache.has(key)) return;
    let alive = true;
    fetchArtwork(key, track.albumId, track.uri, size).then((uri) => {
      if (alive) setLoaded({ key, uri });
    });
    return () => {
      alive = false;
    };
  }, [key, track, size]);

  if (!key) return undefined;
  if (cache.has(key)) return cache.get(key);
  return loaded?.key === key ? loaded.uri : undefined;
}

export function clearArtworkMemory() {
  cache.clear();
}
