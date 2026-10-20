import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar, TabView } from 'react-native-tab-view';

import { AppBackground, useBackgroundUri } from '@/components/AppBackground';
import { MiniPlayer } from '@/components/MiniPlayer';
import { SortSheet, type SortTab } from '@/components/SortSheet';
import { IconButton } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useT, type StringKey } from '@/i18n';
import { AlbumsTab } from '@/screens/AlbumsTab';
import { ArtistsTab } from '@/screens/ArtistsTab';
import { FoldersTab } from '@/screens/FoldersTab';
import { PlaylistsTab } from '@/screens/PlaylistsTab';
import { SongsTab } from '@/screens/SongsTab';
import { VideosTab } from '@/screens/VideosTab';
import { useSettings } from '@/store/settings';
import { useUi, type HomeTab } from '@/store/ui';
import { space, useColors } from '@/theme';

const ROUTES: { key: HomeTab; title: StringKey }[] = [
  { key: 'songs', title: 'library.tab.songs' },
  { key: 'playlists', title: 'library.tab.playlists' },
  { key: 'folders', title: 'library.tab.folders' },
  { key: 'albums', title: 'library.tab.albums' },
  { key: 'artists', title: 'library.tab.artists' },
  { key: 'videos', title: 'library.tab.videos' },
];

/** Aba → "Ordenar por" correspondente (Playlists não tem). */
const SORT_TAB: Record<string, SortTab | undefined> = {
  songs: 'songs',
  folders: 'folders',
  albums: 'albums',
  artists: 'artists',
  videos: 'videos',
};

/** Tela principal (fragment_main_motion do Lark): cabeçalho, abas no topo e mini player. */
export default function MainScreen() {
  const tr = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  // A aba fica no store: quando um download termina, o app abre Músicas ou Vídeo sozinho.
  const homeTab = useUi((s) => s.homeTab);
  const index = Math.max(0, ROUTES.findIndex((r) => r.key === homeTab));
  const setIndex = (next: number) => useUi.getState().setHomeTab(ROUTES[next]?.key ?? 'songs');
  const [sortOpen, setSortOpen] = useState(false);
  const photo = !!useBackgroundUri();
  const bar = photo ? 'transparent' : colors.surface;
  const albumView = useSettings((s) => s.albumView);
  const videoView = useSettings((s) => s.videoView);
  const routeKey = ROUTES[index].key;
  const sortTab = SORT_TAB[routeKey];
  const view = routeKey === 'albums' ? albumView : routeKey === 'videos' ? videoView : undefined;
  const toggleView = () => {
    const next = view === 'grid' ? 'list' : 'grid';
    useSettings.getState().set(routeKey === 'albums' ? { albumView: next } : { videoView: next });
  };

  const routes = ROUTES.map((r) => ({ key: r.key, title: tr(r.title) }));

  const renderScene = ({ route }: { route: { key: string } }) => {
    switch (route.key) {
      case 'songs':
        return <SongsTab onSort={() => setSortOpen(true)} />;
      case 'playlists':
        return <PlaylistsTab />;
      case 'folders':
        return <FoldersTab />;
      case 'albums':
        return <AlbumsTab />;
      case 'artists':
        return <ArtistsTab />;
      default:
        return <VideosTab />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <View style={[styles.head, { paddingTop: insets.top + space.sm, backgroundColor: bar }]}>
        <Image source={require('@/assets/images/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text variant="title" style={styles.brand} accessibilityRole="header" numberOfLines={1}>
          Player Downloader
        </Text>
        <IconButton icon="settings" label={tr('common.settings')} onPress={() => router.push('/settings')} />
        {view && (
          <IconButton
            icon={view === 'grid' ? 'view_list' : 'grid_view'}
            label={view === 'grid' ? tr('library.viewList') : tr('library.viewGrid')}
            onPress={toggleView}
          />
        )}
        {sortTab && <IconButton icon="sort" label={tr('common.sort')} onPress={() => setSortOpen(true)} />}
        <IconButton icon="download" label={tr('tools.dl.title')} onPress={() => router.push('/downloads')} />
        <IconButton icon="search" label={tr('common.search')} onPress={() => router.push('/search')} />
      </View>
      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={setIndex}
        initialLayout={{ width: layout.width }}
        lazy
        renderTabBar={(props) => (
          <TabBar
            {...props}
            scrollEnabled
            activeColor={colors.text}
            inactiveColor={colors.textMuted}
            style={{ backgroundColor: bar, elevation: 0, shadowOpacity: 0 }}
            tabStyle={{ width: 'auto', paddingHorizontal: space.md, minHeight: 44 }}
            indicatorStyle={{ backgroundColor: colors.primary, height: 3, borderRadius: 2 }}
            contentContainerStyle={{ paddingHorizontal: space.sm }}
            options={Object.fromEntries(
              ROUTES.map((r) => [r.key, { labelStyle: { fontSize: 15, fontWeight: '600', textTransform: 'none' } }])
            )}
          />
        )}
        style={{ backgroundColor: photo ? 'transparent' : colors.background }}
      />
      <MiniPlayer />
      {sortTab && <SortSheet tab={sortTab} visible={sortOpen} onClose={() => setSortOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs, paddingBottom: space.xs },
  logo: { width: 30, height: 30, borderRadius: 8 },
  brand: { flex: 1, marginLeft: space.sm, letterSpacing: 0.2 },
});
