import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Cores do rótulo do disco no logo Vinil. */
export const LABEL_COLOR = '#FFF3EA';
const MARK_COLOR = '#E8572A';
const PLAY = 'M50.8 47.8 L61 54 L50.8 60.2 Z';

/** Tocar/pausar no estilo do rótulo do logo Vinil: bolinha creme com o triângulo (ou as duas barras) em laranja. */
export function LabelPlayIcon({ playing, size }: { playing: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="40.5 40.5 27 27">
      <Circle cx={54} cy={54} r={13.5} fill={LABEL_COLOR} />
      {playing ? (
        <>
          <Rect x={49} y={48} width={3.2} height={12} rx={1.2} fill={MARK_COLOR} />
          <Rect x={55.8} y={48} width={3.2} height={12} rx={1.2} fill={MARK_COLOR} />
        </>
      ) : (
        <Path d={PLAY} fill={MARK_COLOR} stroke={MARK_COLOR} strokeWidth={2.2} strokeLinejoin="round" />
      )}
    </Svg>
  );
}
