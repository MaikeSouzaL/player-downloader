import { Text as RNText, type TextProps } from 'react-native';

import { font, useColors } from '@/theme';

export type AppTextProps = TextProps & {
  variant?: keyof typeof font;
  muted?: boolean;
  color?: string;
};

export function Text({ variant = 'body', muted, color, style, ...props }: AppTextProps) {
  const colors = useColors();
  return <RNText {...props} style={[font[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]} />;
}
