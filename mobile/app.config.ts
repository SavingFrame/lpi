import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'lpi',
  slug: 'lpi-mobile',
  scheme: 'lpi',
  version: '0.1.0',
  icon: '../assets/brand/lpi-app-icon.png',
  backgroundColor: '#24333c',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  platforms: ['ios', 'android'],
  plugins: [
    'expo-router',
    './plugins/with-ios-scene-lifecycle.cjs',
    [
      'expo-image-picker',
      {
        photosPermission: 'Choose screenshots and photos to attach to Pi messages.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  ios: {
    bundleIdentifier: 'dev.lpi.mobile',
    supportsTablet: false,
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Connect to your lpi relay on your trusted local network.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: 'dev.lpi.mobile',
    adaptiveIcon: {
      foregroundImage: '../assets/brand/lpi-adaptive-foreground.png',
      monochromeImage: '../assets/brand/lpi-monochrome.png',
      backgroundColor: '#24333c',
    },
  },
};

export default config;
