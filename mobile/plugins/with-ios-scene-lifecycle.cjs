const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

// SDK 57 includes ExpoAppSceneDelegate, but its bundled template still starts React Native
// in AppDelegate. Let Expo's scene delegate create the window and forward lifecycle/deep links.
module.exports = function withIosSceneLifecycle(config) {
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('Pim scene lifecycle requires the Expo Swift AppDelegate.');
    }
    let contents = mod.modResults.contents;
    const oldDeclaration = 'class AppDelegate: ExpoAppDelegate {';
    const declaration = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';
    const startup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
    if (contents.includes(oldDeclaration) && contents.includes(startup)) {
      contents = contents.replace(oldDeclaration, declaration).replace(startup, '');
    } else if (!contents.includes(declaration) || contents.includes('factory.startReactNative(')) {
      throw new Error('Expo AppDelegate template changed. Review the Pim scene lifecycle plugin.');
    }
    mod.modResults.contents = contents;
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return mod;
  });
};
