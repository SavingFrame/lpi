---
name: ios-macos
description: Test Pim's mobile app on the already-prepared SSH Mac. Use the bundled Bash helper to sync source, reuse Metro, open Expo Go on the current simulator, capture screenshots, and inspect logs.
---

# Test Pim on the Mac

The Mac is already prepared. Use the [Bash helper](scripts/ios-mac.sh), not a provisioning
workflow. From the Pim repository root:

```sh
bash .pi/skills/ios-macos/scripts/ios-mac.sh run
bash .pi/skills/ios-macos/scripts/ios-mac.sh screenshot
bash .pi/skills/ios-macos/scripts/ios-mac.sh logs
```

- `run` = `sync` + `start` + `open`. Those commands also work separately; `status` inspects
  Metro and booted devices. No npm dependency installation happens automatically.
- `start` reuses the correct Metro and refuses an unrelated server. It prints the tmux
  attach command. Preserve the running server unless a restart is requested.
- `open` discovers the sole booted simulator, installs matching cached Expo Go if needed,
  and focuses Xcode 27 Device Hub. Ask the user to tap **Open** if iOS requests it.
- `screenshot [local.png]` copies a simulator screenshot locally and prints its path.
  Inspect it with the read tool. `logs` captures the last 80 Metro lines.

## Mobile development handoff

After mobile changes, sync the latest source to the prepared Mac before asking the user
to check on their phone or simulator. Local edits do not reach the Mac's Metro automatically:

```sh
bash .pi/skills/ios-macos/scripts/ios-mac.sh sync
```

Reuse the running Metro so connected phones receive Fast Refresh. Use `start` if Metro
is stopped; use `run` only when simulator startup is also wanted. Report successful sync
before handing testing back to the user. Sync does not establish device validation.
If dependencies changed, syncing alone is insufficient; update remote dependencies
explicitly before testing, following the boundaries below.

## Existing setup

SSH: `user@192.168.100.209`. Checkout: `/Users/user/Projects/pim-mobile-test.VdZTqa`.
Private Node 22, npm config, Expo home/cache are under `.tools/` there. Metro uses port
8081, socket `/tmp/claude-tmux-sockets/pim-mobile.sock`, session `pim-mobile-metro`.
Working device: iPhone 17 on iOS 27.0; always rediscover its UDID.

Overrides: `PIM_IOS_SSH`, `PIM_IOS_DIR`, `PIM_IOS_HOST`, `PIM_IOS_DEVICE`. Set the last to
a current UDID when multiple devices are booted or explicitly selecting a shutdown device.
Only `open` boots an explicitly selected shutdown device.

## Boundaries and troubleshooting

- Sync allowlists source, excludes environment/generated files, and never deletes remote
  files. Review new source for secrets. If manifests change, update remote dependencies
  explicitly with the existing private Node/npm setup and `npm ci --ignore-scripts`.
- Do not erase devices, install global tooling, change accounts, stop unrelated servers,
  launch Pi, or make paid model calls. Keep all development servers on the trusted LAN.
- Xcode 27 uses Device Hub, not `Simulator.app`. Do not reinstall Xcode for this rename.
- If Home/Settings also ignore clicks, investigate the simulator before changing app code.
  A fresh iOS 27 device fixed input that failed on the old iOS 17 device; restarting Device
  Hub alone did not. Preserve devices unless deletion is requested.
- A screenshot proves rendering, not interaction or relay networking. Report startup,
  interaction, HTTP/WebSocket, background recovery, custom builds, and device checks separately.

Helper validation: `bash -n .pi/skills/ios-macos/scripts/ios-mac.sh`.
Node on the Mac is used only for JSON parsing.
