import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import withIosSceneLifecycle from '../plugins/with-ios-scene-lifecycle.cjs';

const require = createRequire(import.meta.url);

test('SDK 57 prebuild adopts Expo scene startup without losing app configuration or links', async () => {
  const template = execFileSync(
    'tar',
    ['-xOf', require.resolve('expo/template.tgz'), 'package/ios/HelloWorld/AppDelegate.swift'],
    { encoding: 'utf8' },
  );
  const config = withIosSceneLifecycle({ name: 'Pim', slug: 'pim-mobile' });
  const applyAppDelegate = (contents) =>
    config.mods.ios.appDelegate({
      modRequest: {},
      modResults: { language: 'swift', contents },
    });
  const migrated = (await applyAppDelegate(template)).modResults.contents;
  assert.match(migrated, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  assert.match(migrated, /reactNativeFactory = factory/);
  assert.doesNotMatch(migrated, /factory.startReactNative\(|UIWindow\(frame:/);
  assert.ok(migrated.includes('// Linking API'));
  assert.ok(migrated.includes('// Universal Links'));
  assert.equal((await applyAppDelegate(migrated)).modResults.contents, migrated);

  const plist = {
    CFBundleIdentifier: 'dev.pim.mobile',
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['pim'] }],
  };
  const result = await config.mods.ios.infoPlist({ modRequest: {}, modResults: { ...plist } });
  const { UIApplicationSceneManifest: manifest, ...preserved } = result.modResults;
  assert.deepEqual(preserved, plist);
  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(
    manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName,
    'EXExpoAppSceneDelegate',
  );
  await assert.rejects(
    applyAppDelegate('class AppDelegate: SomeFutureDelegate {}'),
    /template changed/,
  );
});
