Pod::Spec.new do |s|
  s.name           = 'RitmoCore'
  s.version        = '1.2.0'
  s.summary        = 'Biblioteca, player, equalizador e CarPlay do Player Downloader'
  s.description    = 'Módulo nativo do Player Downloader para iOS: arquivos importados e app Música, player com AVAudioEngine, equalizador, timer e CarPlay.'
  s.license        = 'MIT'
  s.author         = 'Player Downloader'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks     = 'AVFoundation', 'MediaPlayer', 'CarPlay', 'UIKit'

  # Só o código nativo do módulo. O Python.xcframework e os pacotes em Python/ não
  # podem entrar em source_files: são milhares de headers e arquivos de dados.
  s.source_files   = '*.{h,m,swift}', 'GrabCore/**/*.{h,m,c,swift}'
  s.vendored_frameworks = 'Frameworks/Python.xcframework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_C_LANGUAGE_STANDARD' => 'gnu17',
    # Garante <Python/Python.h> no alvo do pod, além do caminho que o CocoaPods
    # já cria para o XCFramework. O slice certo é escolhido por SDK.
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]' => '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks/Python.xcframework/ios-arm64"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*]' => '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks/Python.xcframework/ios-arm64_x86_64-simulator"'
  }
end
