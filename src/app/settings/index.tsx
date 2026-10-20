import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import RitmoCore from '@/modules/ritmo-core';
import { LANG_NAMES, useT, type Lang, type LangPreference } from '@/i18n';
import { ListItem } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { formatLongDuration } from '@/lib/format';
import { importFiles } from '@/lib/import-files';
import { IS_IOS } from '@/lib/platform';
import { dayKey, useCollections } from '@/store/collections';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { ACCENTS, radius, space, useColors } from '@/theme';

const LANGUAGES: Lang[] = ['pt', 'en', 'es'];

function Group({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[styles.group, { backgroundColor: colors.surface }]}>{children}</View>;
}

/** Escolha do idioma do app: o do aparelho ou um dos três. */
function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tr = useT();
  const colors = useColors();
  const language = useSettings((s) => s.language);
  const choose = (next: LangPreference) => {
    useSettings.getState().set({ language: next });
    onClose();
  };
  const check = <Icon name="check" color={colors.primary} />;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="heading" style={styles.sheetTitle}>
        {tr('settings.language')}
      </Text>
      <ListItem title={tr('settings.languageSystem')} onPress={() => choose('system')} right={language === 'system' ? check : undefined} />
      {LANGUAGES.map((lang) => (
        <ListItem key={lang} title={LANG_NAMES[lang]} onPress={() => choose(lang)} right={language === lang ? check : undefined} />
      ))}
    </Sheet>
  );
}

/** Ajustes, na mesma ordem dos grupos do fragment_settings do Lark. */
export default function SettingsScreen() {
  const tr = useT();
  const colors = useColors();
  const accent = useSettings((s) => s.accent);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const hiddenCount = useSettings((s) => s.hiddenTracks.length + s.hiddenFolders.length);
  const today = useCollections((s) => s.playTime[dayKey()] ?? 0);
  const sleep = usePlayer((s) => s.sleep);
  const scanning = useLibrary((s) => s.scanning);
  const trackCount = useLibrary((s) => s.tracks.length);
  const [pickingLanguage, setPickingLanguage] = useState(false);
  const chevron = <Icon name="chevron_right" size={22} color={colors.textWeak} />;
  const themeLabel = `${tr(ACCENTS[accent].nameKey)} · ${tr(`settings.mode.${theme}`)}`;
  const languageLabel = language === 'system' ? `${tr('settings.languageSystem')} · ${LANG_NAMES[tr.lang]}` : LANG_NAMES[language];

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Group>
        <ListItem
          icon="schedule"
          title={tr('settings.playTime')}
          subtitle={tr('settings.todayValue', { time: formatLongDuration(today) })}
          onPress={() => router.push('/settings/play-time')}
          right={chevron}
        />
        <ListItem icon="palette" title={tr('settings.theme')} subtitle={themeLabel} onPress={() => router.push('/settings/theme')} right={chevron} />
        <ListItem icon="language" title={tr('settings.language')} subtitle={languageLabel} onPress={() => setPickingLanguage(true)} right={chevron} />
        <ListItem
          icon="bedtime"
          title={tr('settings.timer')}
          subtitle={
            sleep?.active
              ? sleep.endOfTrack
                ? tr('settings.timerEndOfTrack')
                : tr('settings.timerRemaining', { n: Math.ceil(sleep.remainingMs / 60000) })
              : tr('settings.timerOff')
          }
          onPress={() => router.push('/sleep-timer')}
          right={chevron}
        />
      </Group>

      {IS_IOS && <IosLibraryGroup />}

      <Group>
        {RitmoCore.supportsTrash() && (
          <ListItem icon="delete" title={tr('settings.trash')} subtitle={tr('settings.trashSub')} onPress={() => router.push('/settings/trash')} right={chevron} />
        )}
        <ListItem
          icon="visibility_off"
          title={tr('settings.hidden')}
          subtitle={hiddenCount ? tr.n('common.items', hiddenCount) : undefined}
          onPress={() => router.push('/settings/hidden')}
          right={chevron}
        />
        <ListItem icon="download" title={tr('tools.dl.title')} subtitle={tr('tools.dl.subtitle')} onPress={() => router.push('/downloads')} right={chevron} />
        <ListItem
          icon="cloud_download"
          title={tr('tools.grab.server')}
          subtitle={tr('tools.grab.serverSub')}
          onPress={() => router.push('/settings/grab')}
          right={chevron}
        />
        <ListItem icon="lock" title={tr('tools.vault.title')} subtitle={tr('tools.vault.subtitle')} onPress={() => router.push('/vault')} right={chevron} />
        <ListItem icon="settings_backup_restore" title={tr('settings.backup')} subtitle={tr('settings.backupSub')} onPress={() => router.push('/settings/backup')} right={chevron} />
        <ListItem icon="tune" title={tr('settings.playback')} onPress={() => router.push('/settings/playback')} right={chevron} />
        <ListItem icon="equalizer" title={tr('settings.equalizer')} onPress={() => router.push('/equalizer')} right={chevron} />
        <ListItem
          icon="refresh"
          title={tr('settings.scan')}
          subtitle={scanning ? tr('settings.scanning') : tr.n('settings.inLibrary', trackCount)}
          onPress={() => useLibrary.getState().scan()}
        />
      </Group>

      <Group>
        <ListItem icon="bug_report" title={tr('settings.errors')} subtitle={tr('settings.errorsSub')} onPress={() => router.push('/settings/errors')} right={chevron} />
        <ListItem icon="info" title={tr('settings.about')} subtitle={`Player Downloader ${Constants.expoConfig?.version ?? ''}`} />
        <View style={styles.about}>
          <Text variant="caption" muted>
            {tr('settings.aboutText')}
          </Text>
        </View>
      </Group>

      <LanguageSheet visible={pickingLanguage} onClose={() => setPickingLanguage(false)} />
    </ScrollView>
  );
}

/** iPhone: de onde vêm as músicas (pasta do app e app Música). */
function IosLibraryGroup() {
  const tr = useT();
  const colors = useColors();
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(() => RitmoCore.mediaLibraryStatus?.() ?? 'undetermined');

  const runImport = async () => {
    setImporting(true);
    try {
      await importFiles();
    } finally {
      setImporting(false);
    }
  };

  const askMusicApp = async () => {
    if (status !== 'undetermined') return;
    const next = (await RitmoCore.requestMediaLibraryAccess?.()) ?? status;
    setStatus(next);
    if (next === 'granted') await useLibrary.getState().scan();
  };

  return (
    <Group>
      <ListItem
        icon="upload_file"
        title={importing ? tr('ios.importing') : tr('ios.import')}
        subtitle={tr('ios.importSub')}
        onPress={importing ? undefined : runImport}
        right={<Icon name="chevron_right" size={22} color={colors.textWeak} />}
      />
      <ListItem
        icon="library_music"
        title={tr('ios.musicApp')}
        subtitle={status === 'granted' ? tr('ios.musicAppGranted') : status === 'undetermined' ? tr('ios.musicAppAsk') : tr('ios.musicAppDenied')}
        onPress={status === 'undetermined' ? askMusicApp : undefined}
      />
      <View style={styles.about}>
        <Text variant="caption" muted>
          {tr('ios.filesHint')}
        </Text>
      </View>
    </Group>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  about: { paddingHorizontal: space.lg, paddingBottom: space.lg, marginTop: -space.sm },
  sheetTitle: { paddingHorizontal: space.lg, paddingBottom: space.sm },
});
