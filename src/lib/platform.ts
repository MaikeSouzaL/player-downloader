import { Platform } from 'react-native';

export const IS_ANDROID = Platform.OS === 'android';
export const IS_IOS = Platform.OS === 'ios';
/** O módulo nativo (biblioteca, player, capas) só existe no Android e no iOS. */
export const HAS_NATIVE = IS_ANDROID || IS_IOS;
