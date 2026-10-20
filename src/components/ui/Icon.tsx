import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

import { SF_SYMBOLS } from '@/components/ui/sf-symbols';
import { useColors } from '@/theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];
export type IconName = NonNullable<Extract<SymbolName, { android?: unknown }>['android']>;

/** Ícones nativos: Material Symbols no Android e o SF Symbol equivalente no iPhone. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const colors = useColors();
  return (
    <SymbolView
      name={{ android: name, web: name, ios: SF_SYMBOLS[name] ?? 'circle' }}
      size={size}
      tintColor={color ?? colors.text}
      style={{ width: size, height: size }}
    />
  );
}
