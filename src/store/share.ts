import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { logError } from '@/lib/errorlog';
import { extensionOf, mediaTypeOf } from '@/lib/links';
import RitmoCore, { type SharePayload } from '@/modules/ritmo-core';

/**
 * Último link que abriu o app pelo `ritmo://grab?url=…` (extensão do iPhone). Se a extensão também
 * guardou o mesmo link (quando achou que o app não ia abrir), ele não é aberto de novo.
 */
let lastDeepLink: { url: string; at: number } | null = null;

export function noteDeepLink(url: string) {
  lastDeepLink = { url, at: Date.now() };
}

const DUPLICATE_MS = 2 * 60_000;

/** O que chegou pelo "Compartilhar" / "Abrir com" e ainda não foi tratado. */
export const useShare = create<{ pending: SharePayload | null }>()(() => ({ pending: null }));

export function setPendingShare(payload: SharePayload | null) {
  useShare.setState({ pending: payload });
}

/** iPhone: "Abrir com / Copiar para o Ritmo" chega como file://… pelo expo-router. */
export function setPendingFromFileUrl(url: string) {
  const raw = url.split(/[?#]/)[0];
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // "%" solto no nome: usa como veio.
  }
  const name = path.slice(path.lastIndexOf('/') + 1) || 'arquivo';
  const ext = extensionOf(name);
  const media = mediaTypeOf(null, name);
  setPendingShare({
    text: null,
    subject: null,
    items: [{ uri: url, name, size: -1, mime: media ? `${media}/${ext || '*'}` : null }],
  });
}

function openShareScreen() {
  // navigate (e não push): se a tela já estiver aberta, só troca o conteúdo.
  router.navigate('/share');
}

/**
 * Android: lê o que abriu o app (Intent) e escuta os próximos compartilhamentos com o app aberto.
 * iPhone: os arquivos chegam pelo +native-intent e os links pela extensão "Compartilhar", que abre
 * `ritmo://grab?url=…`; quando o iOS não deixa abrir o app, ela guarda o link e ele é lido aqui
 * na abertura e sempre que o app volta para a tela.
 */
export function startShareListener(): () => void {
  if (Platform.OS !== 'android') {
    const check = () => {
      try {
        const saved = RitmoCore.getPendingShare();
        const duplicate = !!saved?.text && !!lastDeepLink && saved.text === lastDeepLink.url && Date.now() - lastDeepLink.at < DUPLICATE_MS;
        if (saved && !duplicate) {
          setPendingShare(saved);
          openShareScreen();
        }
      } catch (e) {
        logError('Compartilhar: link guardado', e);
      }
    };
    if (useShare.getState().pending) openShareScreen();
    else check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }
  try {
    const initial = RitmoCore.getPendingShare();
    if (initial) {
      setPendingShare(initial);
      openShareScreen();
    }
  } catch (e) {
    logError('Compartilhar: início', e);
  }
  const sub = RitmoCore.addListener('onShare', (payload) => {
    setPendingShare(payload);
    openShareScreen();
  });
  return () => sub.remove();
}
