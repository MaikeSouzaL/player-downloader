import { logError } from '@/lib/errorlog';
import { HAS_NATIVE } from '@/lib/platform';
import RitmoCore from '@/modules/ritmo-core';
import { useSettings } from '@/store/settings';

type SettingsState = ReturnType<typeof useSettings.getState>;
type Tuning = Pick<SettingsState, 'crossfadeSec' | 'gaplessAlbums' | 'skipSilence' | 'replayGain' | 'replayGainPreamp'>;

const pick = (s: SettingsState): Tuning => ({
  crossfadeSec: s.crossfadeSec,
  gaplessAlbums: s.gaplessAlbums,
  skipSilence: s.skipSilence,
  replayGain: s.replayGain,
  replayGainPreamp: s.replayGainPreamp,
});

const same = (a: Tuning, b: Tuning) => (Object.keys(a) as (keyof Tuning)[]).every((k) => a[k] === b[k]);

function send(t: Tuning) {
  RitmoCore.setPlaybackTuning(Math.round(t.crossfadeSec * 1000), t.gaplessAlbums, t.skipSilence, t.replayGain, t.replayGainPreamp).catch((e) =>
    logError('Ajustes de reprodução', e)
  );
}

/**
 * Manda para o player nativo a transição entre músicas, pular silêncio e o ReplayGain, e manda de novo
 * quando mudam em Ajustes. O nativo guarda: com o app fechado (fone, carro) continua valendo.
 */
export function watchPlaybackTuning(): () => void {
  if (!HAS_NATIVE) return () => {};
  let last = pick(useSettings.getState());
  send(last);
  return useSettings.subscribe((state) => {
    const next = pick(state);
    if (same(next, last)) return;
    last = next;
    send(next);
  });
}
