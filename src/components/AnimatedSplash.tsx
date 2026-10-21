import { useEventListener } from 'expo';
import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet } from 'react-native';

/** Cor da tela do sistema (app.json) e do primeiro quadro do vídeo, então a troca não aparece. */
const ORANGE = '#FD7846';
/** Gravado de palyer/design/video/abertura.html: 1,95 s de animação e mais 2 s parado no logo. */
const VIDEO = require('@/assets/videos/abertura-vinil.mp4');
/** Onde começa o trecho parado do vídeo (quem pede menos movimento vê só ele). */
const HOLD_FROM_S = 1.95;
/** Se o primeiro quadro não aparecer nesse tempo (vídeo não abriu), o app abre. */
const FIRST_FRAME_MS = 2500;
/** Se o vídeo travar no meio, o app abre assim mesmo. */
const MAX_MS = 7000;

// Lido já ao carregar o arquivo, antes de o vídeo começar.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduceMotion = v;
  })
  .catch(() => {});

/** O Android pode recriar a tela com o app já aberto (memória, idioma, fonte): aí a abertura não volta. */
let shown = false;

/** Abertura do app: depois da tela do sistema só laranja, toca o vídeo do logo Vinil e passa para a tela inicial. */
export function AnimatedSplash() {
  const [gone, setGone] = useState(() => shown);
  if (gone) return null;
  return <SplashVideo onDone={() => setGone(true)} />;
}

function SplashVideo({ onDone }: { onDone: () => void }) {
  const pathname = usePathname();
  const [ended, setEnded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // O vídeo só aparece no primeiro quadro; antes disso fica o laranja desta tela, igual ao do sistema.
  const [visible, setVisible] = useState(false);
  const started = useRef(false);
  const [[fade, zoom]] = useState(() => [new Animated.Value(1), new Animated.Value(1)]);
  const player = useVideoPlayer(VIDEO, (p) => {
    p.muted = true;
    p.loop = false;
    // Não para a música de outro app que esteja tocando.
    p.audioMixingMode = 'mixWithOthers';
    // Posição inicial antes do play: só o logo parado.
    if (reduceMotion) p.currentTime = HOLD_FROM_S;
  });
  // "Abrir com" / "Compartilhar" abre a tela por cima já na partida (no iPhone, links caem em /grab):
  // a abertura sai para não ficar por cima dela.
  const leaving = ended || timedOut || pathname === '/share' || pathname === '/grab';

  // Os 2 s parados no logo já estão no fim do vídeo.
  useEventListener(player, 'playToEnd', () => setEnded(true));
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') setEnded(true);
  });

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), MAX_MS);
    // O vídeo pausa sozinho quando o app sai da tela e não volta: aí a abertura já termina.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') setEnded(true);
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setEnded(true), FIRST_FRAME_MS);
    return () => clearTimeout(timer);
  }, [visible]);

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
      setEnded(true);
      return;
    }
    player.play();
  };

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
        style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        // TextureView: no Android, a SurfaceView ignora a transparência da transição.
        surfaceType="textureView"
        useExoShutter={false}
        onFirstFrameRender={() => setVisible(true)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Elevação alta: no Android, sombras de outras telas não passam por cima da abertura.
  root: { backgroundColor: ORANGE, zIndex: 100, elevation: 100 },
});
