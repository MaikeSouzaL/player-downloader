import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { BrandIcon } from '@/components/BrandIcon';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useT } from '@/i18n';
import { BRAND_SITES, brandForUrl } from '@/lib/brands';
import { useGrabHistory } from '@/store/grabHistory';
import { useUi } from '@/store/ui';
import { radius, space, useColors } from '@/theme';

// A tipagem do pacote usa `P = undefined` (props viram `never`): o genérico explícito resolve.
type Web = WebView<object>;

/** Endereço, domínio solto ("youtube.com") ou pesquisa. */
export function toUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

/** Só páginas web: links que abririam outros apps (intent://, youtube://, market://) ficam dentro do navegador. */
const allowed = (url: string) => /^(https?|about|data|blob):/i.test(url);

/**
 * Navegador interno: abre o site, a pessoa acha o vídeo e toca em "Baixar" — o link da página
 * vai para a tela de escolher vídeo/áudio e qualidade.
 */
export default function BrowserScreen() {
  const tr = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string }>();
  const start = typeof params.url === 'string' ? (toUrl(params.url) ?? '') : '';
  const recents = useGrabHistory((s) => s.recents);
  const web = useRef<Web>(null);

  const [target, setTarget] = useState(start);
  const [current, setCurrent] = useState(start);
  const [input, setInput] = useState(start);
  const [editing, setEditing] = useState(false);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Abrir de novo o mesmo endereço (ex.: o atalho do YouTube depois de navegar) recria o WebView.
  const [visit, setVisit] = useState(0);

  const open = (value: string) => {
    const next = toUrl(value);
    if (!next) return;
    setVisit((n) => n + 1);
    setTarget(next);
    setCurrent(next);
    setInput(next);
    setFailed(false);
    setEditing(false);
  };

  const goHome = () => {
    setTarget('');
    setCurrent('');
    setInput('');
    setFailed(false);
    setNav({ back: false, forward: false });
  };

  // Android: o botão voltar volta dentro do site; na primeira página, volta para o início.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (nav.back) {
          web.current?.goBack();
          return true;
        }
        if (target) {
          goHome();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [nav.back, target])
  );

  const onNavigation = (state: WebViewNavigation) => {
    setNav({ back: state.canGoBack, forward: state.canGoForward });
    setCurrent(state.url);
    if (!editing) setInput(state.url);
  };

  const download = () => {
    if (!/^https?:\/\//i.test(current)) {
      useUi.getState().showToast(tr('tools.browser.notVideo'));
      return;
    }
    router.push({ pathname: '/grab', params: { url: current } });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.top, { paddingTop: insets.top + space.xs, backgroundColor: colors.surface }]}>
        <IconButton icon="arrow_back" label={tr('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onSubmitEditing={() => open(input)}
          placeholder={tr('tools.browser.placeholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
          style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
        />
        {target ? (
          loading ? (
            <IconButton icon="close" label={tr('common.cancel')} onPress={() => web.current?.stopLoading()} />
          ) : (
            <IconButton icon="refresh" label={tr('tools.browser.reload')} onPress={() => web.current?.reload()} />
          )
        ) : null}
      </View>
      {loading && progress < 1 && (
        <View style={[styles.progress, { backgroundColor: colors.surfaceAlt }]}>
          <View style={[styles.progressFill, { width: `${Math.max(5, progress * 100)}%`, backgroundColor: colors.primary }]} />
        </View>
      )}

      {target ? (
        <View style={{ flex: 1 }}>
          <WebView<object>
            key={visit}
            ref={web}
            source={{ uri: target }}
            onNavigationStateChange={onNavigation}
            onLoadStart={() => {
              setLoading(true);
              setFailed(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onLoadProgress={({ nativeEvent }: { nativeEvent: { progress: number } }) => setProgress(nativeEvent.progress)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            onShouldStartLoadWithRequest={(request: { url: string }) => allowed(request.url)}
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            style={{ flex: 1, backgroundColor: colors.background }}
          />
          {failed && (
            <View style={[styles.failed, { backgroundColor: colors.background }]}>
              <Icon name="error" size={40} color={colors.danger} />
              <Text muted>{tr('tools.browser.error')}</Text>
              <Button label={tr('common.retry')} icon="refresh" variant="tonal" onPress={() => web.current?.reload()} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.home}>
          <View style={styles.sites}>
            {BRAND_SITES.map((site) => (
              <Pressable
                key={site.brand}
                onPress={() => open(site.url)}
                accessibilityRole="button"
                accessibilityLabel={site.name}
                style={({ pressed }) => [styles.site, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={[styles.logo, { backgroundColor: site.color, borderColor: colors.border }]}>
                  <BrandIcon brand={site.brand} size={28} />
                </View>
                <Text variant="caption" numberOfLines={1}>
                  {site.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {recents.length > 0 && (
            <View style={{ gap: space.xs }}>
              <Text variant="label" muted>
                {tr('tools.grab.recent')}
              </Text>
              {recents.slice(0, 5).map((item) => {
                const site = brandForUrl(item.url);
                return (
                <Pressable key={item.url} onPress={() => open(item.url)} accessibilityRole="button" style={styles.recent}>
                  {site ? (
                    <View style={[styles.smallLogo, { backgroundColor: site.color }]}>
                      <BrandIcon brand={site.brand} size={14} />
                    </View>
                  ) : (
                    <Icon name="link" size={18} color={colors.textMuted} />
                  )}
                  <Text numberOfLines={1} style={{ flex: 1 }}>
                    {item.title}
                  </Text>
                </Pressable>
                );
              })}
            </View>
          )}
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            {tr('tools.browser.hint')}
          </Text>
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.xs, backgroundColor: colors.surface }]}>
        <IconButton icon="arrow_back" label={tr('tools.browser.back')} onPress={() => web.current?.goBack()} disabled={!nav.back} />
        <IconButton icon="arrow_forward" label={tr('tools.browser.forward')} onPress={() => web.current?.goForward()} disabled={!nav.forward} />
        <IconButton icon="home" label={tr('tools.browser.home')} onPress={goHome} />
        <View style={{ flex: 1 }} />
        <Button label={tr('tools.browser.download')} icon="download" onPress={download} disabled={!target} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs, paddingBottom: space.xs },
  input: { flex: 1, height: 40, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 14 },
  progress: { height: 2 },
  progressFill: { height: 2 },
  failed: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  home: { flex: 1, padding: space.lg, gap: space.xl },
  sites: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.lg },
  site: { width: '30%', alignItems: 'center', gap: space.xs },
  // Borda fina: logos pretos (TikTok, X) não somem no tema escuro.
  logo: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  smallLogo: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.xs },
});
