import { useEventListener } from 'expo';
import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet } from 'react-native';
import { create } from 'zustand';

import { logError } from '@/lib/errorlog';

/** Cor da tela do sistema (app.json) e do primeiro quadro do vídeo, então a troca não aparece. */
const ORANGE = '#FD7846';
/**
 * Gravado de palyer/design/video/abertura.html: 1,95 s de animação e mais 2 s parado no logo.
 * Toca mesmo com "remover animações" ligado: é o vídeo de abertura que o usuário pediu, não uma transição da interface.
 */
const VIDEO = require('@/assets/videos/abertura-vinil.mp4');
/** Se o vídeo travar, o app abre assim mesmo (o vídeo tem 4 s). */
const MAX_MS = 10000;

/** O Android pode recriar a tela com o app já aberto (memória, idioma, fonte): aí a abertura não volta. */
let shown = false;

const useSplash = create<{ started: boolean }>(() => ({ started: false }));

/**
 * A abertura já está na tela (a do sistema saiu e o vídeo começou). Até aqui o layout raiz desenha só ela,
 * para a tela laranja do sistema sair o quanto antes; o resto do app monta depois, por baixo da animação.
 */
export function markSplashStarted() {
  useSplash.setState({ started: true });
}

export const useSplashStarted = () => useSplash((s) => s.started);

// O player é um objeto nativo mutável; as alterações ficam fora do componente (regra do React Compiler).
const startVideo = (p: VideoPlayer) => p.play();

/** Abertura do app: depois da tela do sistema só laranja, toca o vídeo do logo Vinil e passa para a tela inicial. */
export function AnimatedSplash() {
  const [gone, setGone] = useState(() => shown);
  if (gone) return null;
  return <SplashVideo onDone={() => setGone(true)} />;
}

function SplashVideo({ onDone }: { onDone: () => void }) {
  const pathname = usePathname();
  const [ended, setEnded] = useState(false);
  const started = useRef(false);
  const [[fade, zoom]] = useState(() => [new Animated.Value(1), new Animated.Value(1)]);
  const player = useVideoPlayer(VIDEO, (p) => {
    p.muted = true;
    p.loop = false;
    // Não para a música de outro app que esteja tocando.
    p.audioMixingMode = 'mixWithOthers';
  });
  // "Abrir com" / "Compartilhar" abre a tela por cima já na partida (no iPhone, links caem em /grab):
  // a abertura sai para não ficar por cima dela.
  const leaving = ended || pathname === '/share' || pathname === '/grab';

  // Os 2 s parados no logo já estão no fim do vídeo.
  useEventListener(player, 'playToEnd', () => setEnded(true));
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status !== 'error') return;
    logError('Abertura', error?.message ?? 'O vídeo de abertura não abriu');
    setEnded(true);
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      logError('Abertura', 'O vídeo de abertura não terminou a tempo', { status: player.status, at: player.currentTime });
      setEnded(true);
    }, MAX_MS);
    // O vídeo pausa sozinho quando o app sai da tela e não volta: aí a abertura já termina.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') setEnded(true);
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [player]);

  useEffect(() => {
    if (!leaving) return;
    shown = true;
    // Transição para a tela inicial: o logo some se aproximando.
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(zoom, { toValue: 1.08, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => onDone());
  }, [leaving, fade, zoom, onDone]);

  // Só tira a tela do sistema quando esta já está desenhada por cima, com o mesmo laranja.
  const start = () => {
    if (started.current) return;
    started.current = true;
    SplashScreen.hideAsync().catch(() => {});
    // Um erro pode ter saído antes de os ouvintes acima existirem.
    if (player.status === 'error') {
      logError('Abertura', 'O vídeo de abertura não abriu');
      setEnded(true);
    } else {
      startVideo(player);
    }
    // O vídeo toca no nativo; a montagem pesada das telas (JS) pode começar agora.
    markSplashStarted();
  };

  // O vídeo fica visível desde já: o próprio expo-video só mostra a imagem a partir do primeiro quadro
  // (antes, aparece o laranja desta tela). Nada aqui depende do JS, que fica ocupado carregando o app.
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade, transform: [{ scale: zoom }] }]}
      pointerEvents={leaving ? 'none' : 'auto'}
      onLayout={start}
      accessible
      accessibilityViewIsModal
      accessibilityLabel="Player Downloader">
      {!leaving && <StatusBar style="light" />}
      <VideoView
        player={player}
        // Largura/altura explícitas: na web o <video> ficaria no tamanho do arquivo (1080x1920).
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        // TextureView: no Android, a SurfaceView ignora a transparência da transição.
        surfaceType="textureView"
        useExoShutter={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Elevação alta: no Android, sombras de outras telas não passam por cima da abertura.
  root: { backgroundColor: ORANGE, zIndex: 100, elevation: 100 },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
