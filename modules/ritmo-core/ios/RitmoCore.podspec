Pod::Spec.new do |s|
  s.name           = 'RitmoCore'
  s.version        = '1.2.0'
  s.summary        = 'Biblioteca, player, equalizador e CarPlay do Ritmo'
  s.description    = 'Módulo nativo do Ritmo para iOS: arquivos importados e app Música, player com AVAudioEngine, equalizador, timer e CarPlay.'
  s.license        = 'MIT'
  s.author         = 'Ritmo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks     = 'AVFoundation', 'MediaPlayer', 'CarPlay', 'UIKit'
  s.source_files   = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
