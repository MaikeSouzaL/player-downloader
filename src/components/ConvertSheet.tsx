import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { audioNameFor } from '@/lib/links';
import RitmoCore from '@/modules/ritmo-core';
import { useLibrary } from '@/store/library';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

/** Qualidades oferecidas (kbps). 0 = original: copia o áudio do vídeo sem perda quando dá. */
export const QUALITIES = [0, 96, 128, 192, 256] as const;

export function QualityPicker({ value, onChange }: { value: number; onChange: (kbps: number) => void }) {
  const tr = useT();
  return (
    <View style={styles.chips}>
      {QUALITIES.map((q) => (
        <Chip key={q} label={q === 0 ? tr('tools.quality.original') : `${q} kbps`} selected={value === q} onPress={() => onChange(q)} />
      ))}
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const colors = useColors();
  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, backgroundColor: colors.primary }]} />
    </View>
  );
}

type Source = { uri: string; name: string };

/**
 * "Converter em áudio": escolhe a qualidade, mostra o progresso e salva a música na biblioteca
 * (Android: Music/Player Downloader; iPhone: Player Downloader › Músicas). Formato AAC/M4A, que toca em qualquer aparelho.
 */
export function ConvertSheet({ source, onClose }: { source: Source | null; onClose: () => void }) {
  const tr = useT();
  const colors = useColors();
  const [quality, setQuality] = useState<number>(0);
  const [job, setJob] = useState<{ id: string; progress: number } | null>(null);

  // Assina uma vez por conversão (não a cada atualização do progresso).
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    const sub = RitmoCore.addListener('onConvertProgress', (e) => {
      if (e.jobId === jobId) setJob((j) => (j && j.id === jobId ? { ...j, progress: e.progress / 100 } : j));
    });
    return () => sub.remove();
  }, [jobId]);

  const start = async () => {
    if (!source) return;
    const id = `c${Date.now()}`;
    setJob({ id, progress: 0 });
    try {
      await RitmoCore.convertToAudio(id, source.uri, audioNameFor(source.name), quality);
      useUi.getState().showToast(tr('tools.convert.done', { name: audioNameFor(source.name) }));
      void useLibrary.getState().scan();
      setJob(null);
      onClose();
    } catch (e) {
      setJob(null);
      if ((e as { code?: string })?.code === 'ERR_CANCELLED') return;
      logError('Converter em áudio', e, { name: source.name });
      useUi.getState().showToast(tr('tools.convert.failed'));
    }
  };

  const cancel = () => {
    if (job) RitmoCore.cancelConversion(job.id);
  };

  return (
    <Sheet visible={!!source} onClose={job ? () => {} : onClose}>
      <View style={styles.body}>
        <Text variant="heading">{tr('tools.convert.title')}</Text>
        <Text variant="caption" muted numberOfLines={2}>
          {source?.name}
        </Text>
        {job ? (
          <>
            <Text>{tr('tools.convert.working', { n: Math.round(job.progress * 100) })}</Text>
            <ProgressBar value={job.progress} />
            <Button label={tr('common.cancel')} variant="ghost" onPress={cancel} style={{ alignSelf: 'flex-end' }} />
          </>
        ) : (
          <>
            <Text variant="label" muted>
              {tr('tools.quality.title')}
            </Text>
            <QualityPicker value={quality} onChange={setQuality} />
            <Text variant="caption" muted>
              {quality === 0 ? tr('tools.quality.originalHint') : tr('tools.quality.hint')}
            </Text>
            <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
              <Text variant="caption" muted>
                {tr('tools.convert.format')}
              </Text>
            </View>
            <View style={styles.buttons}>
              <Button label={tr('common.cancel')} variant="ghost" onPress={onClose} />
              <Button label={tr('tools.convert.start')} icon="music_note" onPress={start} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  note: { borderRadius: radius.md, padding: space.md },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
