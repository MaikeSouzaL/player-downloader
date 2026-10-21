import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { Appearance, AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/AnimatedSplash';
import { PlaylistPicker } from '@/components/PlaylistPicker';
import { Toast } from '@/components/Toast';
import { TrackMenu } from '@/components/TrackMenu';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { refreshDeviceLang, useT } from '@/i18n';
import { installGlobalErrorLogging, logError } from '@/lib/errorlog';
import RitmoCore from '@/modules/ritmo-core';
import { applyOrientation } from '@/lib/orientation';
import { watchPlaybackTuning } from '@/lib/playback-tuning';
import { watchPodcastDownloads } from '@/lib/podcasts';
import { IS_IOS } from '@/lib/platform';
import { useCollections } from '@/store/collections';
import { useEdits } from '@/store/edits';
import { recheckPermission, useLibrary, watchLibraryChanges } from '@/store/library';
import { setCurrentRoute } from '@/lib/current-route';
import { recoverInterrupted, watchDownloads } from '@/lib/downloads';
import { startErrorReporting } from '@/lib/error-report';
import { watchGrabQueue } from '@/lib/grab-queue';
import { startGrabUpdateWatcher } from '@/lib/grab-updater';
import { syncBrowseData } from '@/store/browse';
import { useDownloads } from '@/store/downloads';
import { useGrabQueue } from '@/store/grabQueue';
import { startShareListener } from '@/store/share';
import { useVault } from '@/store/vault';
import { startWidgetSync } from '@/widget';
import { attachPlayerEvents, restorePlayback } from '@/store/player';
import { useAudiobook } from '@/store/audiobook';
import { useSettings } from '@/store/settings';
import { hydrated } from '@/store/storage';
import { useVideoProgress } from '@/store/video-progress';
import { space, useColors, useIsDark } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// A tela do sistema sai de uma vez: o fade padrão (0,4 s) cobriria o começo do vídeo de abertura.
SplashScreen.setOptions({ duration: 0, fade: false });
installGlobalErrorLogging();

/** Tela de erro no lugar de uma tela branca; o erro vai para o Registro de erros. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const tr = useT();
  const colors = useColors();
  useEffect(() => {
    logError('Tela', error);
  }, [error]);
  return (
    <View style={[styles.error, { backgroundColor: colors.background }]}>
      <Icon name="error" size={48} color={colors.danger} />
      <Text variant="title" style={styles.center}>
        {tr('common.unknownError')}
      </Text>
      <Text muted style={styles.center}>
        {tr('settings.errorBoundaryMsg', { where: `${tr('common.settings')} › ${tr('settings.errors')}` })}
      </Text>
      <Button label={tr('common.retry')} icon="refresh" onPress={retry} />
    </View>
  );
}

/** Permissão → varredura do MediaStore → restaura a última fila. */
function useBootstrap() {
  useEffect(() => {
    const detach = attachPlayerEvents();
    let alive = true;
    let stopBrowseSync: (() => void) | undefined;
    let stopWidgetSync: (() => void) | undefined;
    let stopShare: (() => void) | undefined;
    let stopReports: (() => void) | undefined;
    let stopTuning: (() => void) | undefined;
    let stopPodcasts: (() => void) | undefined;
    let stopGrabUpdates: (() => void) | undefined;
    (async () => {
      let granted = false;
      try {
        await Promise.all([
          hydrated(useSettings),
          hydrated(useCollections),
          hydrated(useEdits),
          hydrated(useVideoProgress),
          hydrated(useDownloads),
          hydrated(useVault),
          hydrated(useAudiobook),
          hydrated(useGrabQueue),
        ]);
        // Crash nativo da última abertura entra no registro local de erros.
        if (alive) stopReports = startErrorReporting();
        // Algo chegou pelo "Compartilhar" / "Abrir com"? Abre já, sem esperar a varredura da biblioteca.
        if (alive) stopShare = startShareListener();
        const library = useLibrary.getState();
        granted = await library.checkPermission();
        if (granted) await library.scan();
      } finally {
        // Aconteça o que acontecer, a tela do sistema sai (normalmente a abertura animada já tirou).
        await SplashScreen.hideAsync().catch(() => {});
      }
      // Primeira abertura: explica as permissões antes de pedir.
      if (alive && !useSettings.getState().onboarded && (!granted || IS_IOS)) router.push('/welcome');
      if (alive) {
        stopBrowseSync = syncBrowseData();
        stopWidgetSync = startWidgetSync();
        // Downloads que ficaram em andamento.
        recoverInterrupted();
        watchDownloads();
        // E o que o motor local ainda estava preparando.
        watchGrabQueue();
        // iOS: procura wheels novas do yt-dlp no PyPI sem atrapalhar a abertura.
        stopGrabUpdates = startGrabUpdateWatcher();
      }
      // Transição, pular silêncio e ReplayGain vão para o player nativo (e de novo quando mudarem).
      if (alive) stopTuning = watchPlaybackTuning();
      if (alive) stopPodcasts = watchPodcastDownloads();
      if (alive) await restorePlayback();
    })().catch((e) => logError('Abertura do app', e));

    const unwatch = watchLibraryChanges();
    const sub = AppState.addEventListener('change', (state) => {
      // A pasta privada tranca quando o app sai da tela.
      if (state === 'background') useVault.getState().lock();
      if (state !== 'active') return;
      recheckPermission().catch((e) => logError('Permissão', e));
      // Idioma "do aparelho" trocado nas configurações do Android: força os textos a se atualizarem.
      if (refreshDeviceLang() && useSettings.getState().language === 'system') useSettings.getState().set({ language: 'system' });
    });
    return () => {
      alive = false;
      detach();
      stopBrowseSync?.();
      stopWidgetSync?.();
      stopShare?.();
      stopReports?.();
      stopTuning?.();
      stopPodcasts?.();
      stopGrabUpdates?.();
      unwatch();
      sub.remove();
    };
  }, []);
}

/** Guarda a tela aberta agora (para o app só mudar de tela sozinho quando faz sentido). */
function RouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    setCurrentRoute(pathname);
  }, [pathname]);
  return null;
}

export default function RootLayout() {
  const tr = useT();
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
  }, [theme]);
  const rotation = useSettings((s) => s.rotation);
  useEffect(() => {
    applyOrientation(rotation);
  }, [rotation]);
  // Balão flutuante (Android): o nativo guarda o ajuste e decide quando aparecer.
  const bubble = useSettings((s) => s.bubble);
  useEffect(() => {
    try {
      RitmoCore.setFloatingBubble?.(bubble);
    } catch (e) {
      logError('Balão flutuante', e);
    }
  }, [bubble]);
  useBootstrap();

  const isDark = useIsDark();
  const colors = useColors();
  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border },
    };
  }, [isDark, colors]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <Stack
              screenOptions={{
                headerShadowVisible: false,
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: { fontSize: 18, fontWeight: '600' },
                contentStyle: { backgroundColor: colors.background },
                animation: 'slide_from_right',
              }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="player" options={{ headerShown: false, animation: 'slide_from_bottom', contentStyle: { backgroundColor: colors.playerBackground } }} />
              <Stack.Screen name="queue" options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="equalizer" options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="sleep-timer" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="search" options={{ headerShown: false }} />
              <Stack.Screen name="select" options={{ headerShown: false }} />
              <Stack.Screen name="album/[id]" options={{ title: '' }} />
              <Stack.Screen name="artist/[id]" options={{ title: '' }} />
              <Stack.Screen name="folder" options={{ title: '' }} />
              <Stack.Screen name="playlist/[id]" options={{ title: '' }} />
              <Stack.Screen name="lyrics-edit/[id]" options={{ title: tr('settings.screen.lyrics') }} />
              <Stack.Screen name="video-folder" options={{ title: '' }} />
              <Stack.Screen name="video/[id]" options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
              <Stack.Screen name="settings/index" options={{ title: tr('common.settings') }} />
              <Stack.Screen name="settings/theme" options={{ title: tr('settings.theme') }} />
              <Stack.Screen name="settings/hidden" options={{ title: tr('settings.hidden') }} />
              <Stack.Screen name="settings/playback" options={{ title: tr('settings.playback') }} />
              <Stack.Screen name="settings/play-time" options={{ title: tr('settings.playTime') }} />
              <Stack.Screen name="settings/errors" options={{ title: tr('settings.errors') }} />
              <Stack.Screen name="settings/trash" options={{ title: tr('settings.trash') }} />
              <Stack.Screen name="settings/backup" options={{ title: tr('settings.backup') }} />
              <Stack.Screen name="settings/grab" options={{ title: tr('settings.grabEngine') }} />
              <Stack.Screen name="share" options={{ title: tr('tools.share.title'), presentation: 'modal' }} />
              <Stack.Screen name="downloads" options={{ title: tr('tools.dl.title') }} />
              <Stack.Screen name="recap" options={{ title: tr('extras.stats.title') }} />
              <Stack.Screen name="podcasts/index" options={{ title: tr('extras.podcast.title') }} />
              <Stack.Screen name="podcasts/[id]" options={{ title: '' }} />
              <Stack.Screen name="grab" options={{ title: tr('tools.grab.title') }} />
              <Stack.Screen name="browser" options={{ headerShown: false }} />

              <Stack.Screen name="vault" options={{ title: tr('tools.vault.title') }} />
              <Stack.Screen name="edit/[id]" options={{ title: tr('settings.screen.editInfo') }} />
              <Stack.Screen name="playlist/arrange" options={{ title: tr('settings.screen.arrange') }} />
              <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'fade' }} />
            </Stack>
            <RouteTracker />
            <TrackMenu />
            <PlaylistPicker />
            <Toast />
            <AnimatedSplash />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  center: { textAlign: 'center' },
});
