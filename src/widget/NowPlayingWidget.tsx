import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { aspectRatio, buttonStyle, clipShape, containerBackground, font, foregroundStyle, frame, resizable } from '@expo/ui/swift-ui/modifiers';
import type { WidgetEnvironment } from 'expo-widgets';

export type NowPlayingProps = {
  title: string;
  artist: string;
  isPlaying: boolean;
  /** Capa copiada para a pasta compartilhada com o widget (file://), ou null. */
  cover: string | null;
  accent: string;
};

/**
 * Widget da tela inicial do iPhone: capa, música, artista e tocar/pausar (com anterior/próxima no médio).
 * A diretiva 'widget' transforma esta função em código que roda no processo do widget: ela só pode usar
 * as props e os componentes do Expo UI (nada de outras variáveis deste arquivo).
 */
export const NowPlayingWidget = (props: NowPlayingProps, environment: WidgetEnvironment) => {
  'widget';
  const medium = environment.widgetFamily === 'systemMedium';
  const coverSize = medium ? 104 : 58;

  const cover = props.cover ? (
    <Image
      uiImage={props.cover}
      modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ width: coverSize, height: coverSize }), clipShape('roundedRectangle', 12)]}
    />
  ) : (
    <Image systemName="music.note" size={coverSize * 0.42} color={props.accent} modifiers={[frame({ width: coverSize, height: coverSize })]} />
  );

  const playButton = (
    <Button target="toggle" onPress={() => ({ ...props, isPlaying: !props.isPlaying })} modifiers={[buttonStyle('plain')]}>
      <Image systemName={props.isPlaying ? 'pause.circle.fill' : 'play.circle.fill'} size={medium ? 40 : 34} color={props.accent} />
    </Button>
  );

  const texts = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: medium ? 16 : 14, weight: 'semibold' })]}>{props.title}</Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{props.artist}</Text>
    </VStack>
  );

  if (!medium) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[containerBackground({ type: 'hierarchical', style: 'quinary' }, 'widget')]}>
        <HStack>
          {cover}
          <Spacer />
          {playButton}
        </HStack>
        <Spacer />
        {texts}
      </VStack>
    );
  }

  return (
    <HStack spacing={14} modifiers={[containerBackground({ type: 'hierarchical', style: 'quinary' }, 'widget')]}>
      {cover}
      <VStack alignment="leading" spacing={8}>
        {texts}
        <HStack spacing={20}>
          <Button target="previous" onPress={() => props} modifiers={[buttonStyle('plain')]}>
            <Image systemName="backward.end.fill" size={20} />
          </Button>
          {playButton}
          <Button target="next" onPress={() => props} modifiers={[buttonStyle('plain')]}>
            <Image systemName="forward.end.fill" size={20} />
          </Button>
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  );
};
