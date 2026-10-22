import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Pim',
  slug: 'pim-mobile',
  scheme: 'pim',
  version: '0.1.0',
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
    bundleIdentifier: 'dev.pim.mobile',
    supportsTablet: false,
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Connect to your Pim relay on your trusted local network.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: { package: 'dev.pim.mobile' },
};

export default config;
