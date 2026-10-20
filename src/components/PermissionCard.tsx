import { Linking } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { useLibrary } from '@/store/library';

/** Pedido de acesso às músicas (item_song_permission do Lark). */
export function PermissionCard({ video }: { video?: boolean }) {
  const tr = useT();
  const request = useLibrary((s) => s.requestPermission);
  return (
    <EmptyState
      icon="folder_open"
      title={video ? tr('library.permission.videosTitle') : tr('library.permission.songsTitle')}
      message={video ? tr('library.permission.videosMessage') : tr('library.permission.songsMessage')}
      action={
        <>
          <Button label={tr('library.permission.allow')} icon="check" onPress={() => request()} />
          <Button label={tr('library.permission.openSettings')} variant="ghost" compact onPress={() => Linking.openSettings()} />
        </>
      }
    />
  );
}
