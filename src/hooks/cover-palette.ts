import { useEffect, useMemo, useState } from 'react';

import { useArtwork } from '@/hooks/artwork';
import { coverPalette, type CoverPalette } from '@/lib/cover-colors';
import type { Track } from '@/lib/library';
import { HAS_NATIVE } from '@/lib/platform';
import RitmoCore from '@/modules/ritmo-core';
import { useSettings } from '@/store/settings';
import { useColors, useIsDark } from '@/theme';

/** Cor predominante por imagem (o nativo lê a capa uma vez só). */
const dominants = new Map<string, string | null>();

/**
 * Cores do player tiradas da capa da música que está tocando (Ajustes › Tema › Cores da capa).
 * null enquanto carrega, sem capa ou com o ajuste desligado: o player usa as cores do tema.
 */
export function useCoverPalette(track: (Pick<Track, 'albumId' | 'uri'> & { cover?: string }) | undefined): CoverPalette | null {
  const enabled = useSettings((s) => s.coverColors);
  const isDark = useIsDark();
  const background = useColors().playerBackground;
  const fetched = useArtwork(enabled && !track?.cover ? track : undefined, 'large');
  const uri = enabled ? (track?.cover ?? fetched ?? null) : null;
  const [loaded, setLoaded] = useState<{ uri: string; hex: string | null } | null>(null);

  useEffect(() => {
    if (!uri || !HAS_NATIVE || dominants.has(uri)) return;
    let alive = true;
    RitmoCore.artworkColor(uri)
      .catch(() => null)
      .then((result) => {
        if (result?.dominant) dominants.set(uri, result.dominant);
        if (alive) setLoaded({ uri, hex: result?.dominant ?? null });
      });
    return () => {
      alive = false;
    };
  }, [uri]);

  const hex = !uri ? null : dominants.has(uri) ? dominants.get(uri) ?? null : loaded?.uri === uri ? loaded.hex : null;
  return useMemo(() => (hex ? coverPalette(hex, isDark, background) : null), [hex, isDark, background]);
}
