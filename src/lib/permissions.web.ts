// Só para testar o app no navegador: a biblioteca de exemplo (modules/ritmo-core/src/RitmoCoreModule.web.ts)
// aparece como se o acesso às músicas e vídeos já estivesse liberado.
export async function hasAudioPermission(): Promise<boolean> {
  return true;
}

export async function hasVideoPermission(): Promise<boolean> {
  return true;
}

export async function requestMediaPermissions(): Promise<{ audio: boolean; video: boolean }> {
  return { audio: true, video: true };
}
