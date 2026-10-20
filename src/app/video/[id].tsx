import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView, type SubtitleTrack, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { logError } from '@/lib/errorlog';
import { formatDuration } from '@/lib/format';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useUi } from '@/store/ui';
import { useVault } from '@/store/vault';
import { useVideoProgress } from '@/store/video-progress';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SAVE_EVERY_S = 5;

const lock = (landscape: boolean) =>
  ScreenOrientation.lockAsync(landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch((e) =>
    logError('Girar a tela', e)
  );

// O player é um objeto nativo mutável; as alterações ficam fora do componente (regra do React Compiler).
const seek = (p: VideoPlayer, seconds: number) => {
  p.currentTime = seconds;
};
const setRate = (p: VideoPlayer, rate: number) => {
  p.playbackRate = rate;
};
const setSubtitleTrack = (p: VideoPlayer, track: SubtitleTrack | null) => {
  p.subtitleTrack = track;
};

/** Player de vídeo (VideoPlayerActivity do Lark): retoma de onde parou, velocidade e girar a tela. */
export default function VideoScreen() {
  // `uri`/`title` vêm da pasta privada (vídeos que não estão na biblioteca).
  const { id, uri, title } = useLocalSearchParams<{ id: string; uri?: string; title?: string }>();
  // Vídeo da pasta privada: não guarda onde parou e fecha se a pasta trancar.
  const isPrivate = id.startsWith('v:');
  const vaultOpen = useVault((s) => s.unlocked);
  const tr = useT();
  const insets = useSafeAreaInsets();
  const fromLibrary = useLibrary((s) => s.videos.find((v) => v.id === id));
  // A `uri` de fora da biblioteca só vale para a pasta privada aberta (não para qualquer link).
  const video = fromLibrary ?? (uri && isPrivate && vaultOpen ? { id, uri, title: title ?? '', width: 0, height: 0 } : undefined);
  const [resume] = useState(() => useVideoProgress.getState().progress[id]?.position ?? 0);
  const [resumed, setResumed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [landscape, setLandscape] = useState(() => !!video && video.width > video.height);
  // Legendas embutidas (vídeos baixados pelo servidor com legenda).
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  // Posição da legenda ligada (-1 = desligada): faixas podem repetir id e idioma.
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  const subtitle = subtitleIndex >= 0 ? (subtitleTracks[subtitleIndex] ?? null) : null;
  const last = useRef({ position: 0, duration: 0, savedAt: 0 });

  const player = useVideoPlayer(video?.uri ?? null, (p) => {
    p.timeUpdateEventInterval = 1;
    p.play();
  });

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    last.current.duration = duration;
    // As faixas podem já estar prontas antes do evento de mudança.
    setSubtitleTracks(player.availableSubtitleTracks ?? []);
    if (resume > 0 && resume < duration - 10) {
      seek(player, resume);
      setResumed(true);
    }
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const l = last.current;
    l.position = currentTime;
    if (Math.abs(currentTime - l.savedAt) >= SAVE_EVERY_S && l.duration > 0) {
      l.savedAt = currentTime;
      if (!isPrivate) useVideoProgress.getState().save(id, currentTime, l.duration);
    }
  });

  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => setSubtitleTracks(availableSubtitleTracks));
  useEventListener(player, 'subtitleTrackChange', ({ subtitleTrack }) => {
    if (!subtitleTrack) setSubtitleIndex(-1);
  });

  useEventListener(player, 'playToEnd', () => {
    last.current.position = last.current.duration;
    useVideoProgress.getState().clear(id);
  });

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error') logError('Vídeo', error?.message ?? 'Falha ao reproduzir', { id });
  });

  // A música para enquanto o vídeo toca; ao sair, guarda a posição e volta a tela para retrato.
  useEffect(() => {
    if (usePlayer.getState().snapshot?.isPlaying) usePlayer.getState().toggle();
    const progress = last.current;
    return () => {
      if (!id.startsWith('v:') && progress.duration > 0 && progress.position > 0) useVideoProgress.getState().save(id, progress.position, progress.duration);
      lock(false);
    };
  }, [id]);

  useEffect(() => {
    lock(landscape);
  }, [landscape]);

  // A pasta privada trancou (o app saiu da tela): o vídeo dela fecha.
  useEffect(() => {
    if (!isPrivate || vaultOpen) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [isPrivate, vaultOpen]);

  // O aviso "Retomado de…" some sozinho.
  useEffect(() => {
    if (!resumed) return;
    const t = setTimeout(() => setResumed(false), 6000);
    return () => clearTimeout(t);
  }, [resumed]);

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setRate(player, next);
    setSpeed(next);
  };

  /** CC: desligada → cada legenda do vídeo → desligada. */
  const cycleSubtitle = () => {
    const next = subtitleIndex + 1 < subtitleTracks.length ? subtitleIndex + 1 : -1;
    const track = next >= 0 ? subtitleTracks[next] : null;
    setSubtitleTrack(player, track);
    setSubtitleIndex(next);
    useUi.getState().showToast(track ? track.label || track.language : tr('tools.grab.noSubtitles'));
  };

  const restart = () => {
    seek(player, 0);
    player.play();
    setResumed(false);
  };

  return (
    <View style={styles.root}>
      {video && <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls fullscreenOptions={{ enable: false }} />}
      <View style={[styles.top, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right + 8 }]} pointerEvents="box-none">
        <IconButton icon="arrow_back" label={tr('common.back')} color="#fff" onPress={() => router.back()} />
        <Text variant="label" color="#fff" numberOfLines={1} style={{ flex: 1 }}>
          {video?.title ?? tr('player.video.notFound')}
        </Text>
        {video && (
          <>
            <Pressable onPress={cycleSpeed} accessibilityRole="button" accessibilityLabel={tr('player.video.speedLabel', { speed: String(speed) })} style={styles.speed} hitSlop={8}>
              <Text variant="caption" color="#fff">
                {speed}x
              </Text>
            </Pressable>
            {subtitleTracks.length > 0 && (
              <IconButton
                icon={subtitle ? 'closed_caption' : 'closed_caption_disabled'}
                label={`${tr('tools.grab.subtitles')}: ${subtitle ? subtitle.label || subtitle.language : tr('tools.grab.noSubtitles')}`}
                color="#fff"
                onPress={cycleSubtitle}
              />
            )}
            <IconButton
              icon="screen_rotation"
              label={landscape ? tr('player.video.rotatePortrait') : tr('player.video.rotateLandscape')}
              color="#fff"
              onPress={() => setLandscape((v) => !v)}
            />
          </>
        )}
      </View>
      {resumed && (
        <View style={[styles.resume, { bottom: insets.bottom + 96 }]}>
          <Text variant="caption" color="#fff">
            {tr('player.video.resumeFrom', { time: formatDuration(resume * 1000) })}
          </Text>
          <Pressable onPress={restart} accessibilityRole="button" hitSlop={8}>
            <Text variant="caption" color="#8AB4FF" style={{ fontWeight: '700' }}>
              {tr('player.video.fromStart')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)' },
  speed: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  resume: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'rgba(20,20,20,0.9)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
