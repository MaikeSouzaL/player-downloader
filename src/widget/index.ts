/**
 * Widget da tela inicial do iPhone (expo-widgets). No Android o widget é nativo (RitmoWidget.kt) e é
 * atualizado pelo serviço de reprodução, então aqui não há nada a fazer. A versão do iOS fica em index.ios.ts.
 */
export function startWidgetSync(): () => void {
  return () => {};
}
