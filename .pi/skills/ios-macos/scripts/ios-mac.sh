#!/bin/bash
set -euo pipefail

MAC=${PIM_IOS_SSH:-user@192.168.100.209}
WORK=${PIM_IOS_DIR:-/Users/user/Projects/pim-mobile-test.VdZTqa}
HOST=${PIM_IOS_HOST:-192.168.100.209}
DEVICE=${PIM_IOS_DEVICE:-}
SOCKET=/tmp/claude-tmux-sockets/pim-mobile.sock
SESSION=pim-mobile-metro

fail() { printf '%s\n' "$*" >&2; exit 1; }

validate_config() {
  [[ $MAC =~ ^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$ ]] || fail 'Expected user@host.'
  [[ $WORK =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'Expected a simple absolute remote path.'
  [[ $HOST =~ ^[a-zA-Z0-9_.-]+$ ]] || fail 'Expected a LAN hostname/IP.'
  [[ -z $DEVICE || $DEVICE =~ ^[a-fA-F0-9-]+$ ]] || fail 'Expected a simulator UDID.'
}

remote() {
  # All interpolated arguments are validated simple paths/identifiers, not shell code.
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$MAC" \
    "/bin/bash -s -- --remote '$1' '$MAC' '$WORK' '$HOST' '$DEVICE' '${2:-}'" < "$SELF"
}

sync_source() {
  remote check
  rsync -az \
    --exclude='node_modules/' --exclude='dist/' --exclude='.expo/' --exclude='.tools/' \
    --exclude='expo-env.d.ts' --exclude='.env' --exclude='.env.*' \
    --include='/package.json' --include='/package-lock.json' \
    --include='/mobile/***' --include='/src/***' \
    --include='/README.md' --include='/PLAN.md' --exclude='*' \
    "$ROOT/" "$MAC:$WORK/"
  printf '%s\n' 'Source synced without deletion. Update remote dependencies explicitly if manifests changed.'
}

metro_ready() {
  local status project
  if lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null; then
    project=$(curl -fsS --max-time 5 -H 'expo-platform: ios' \
      -H 'accept: application/expo+json' http://127.0.0.1:8081/ | node -e '
        const fs = require("node:fs");
        const project = JSON.parse(fs.readFileSync(0, "utf8")).extra?.expoGo?.developer?.projectRoot;
        if (typeof project !== "string") throw Error("Not an Expo project manifest");
        console.log(project);
      ') || fail 'Port 8081 is occupied but not serving the expected Expo project.'
    # -ef compares filesystem identity, including Projects/projects aliases on macOS.
    [[ $project -ef "$WORK/mobile" ]] || fail 'Port 8081 belongs to another project. Leave it running.'
    return 0
  else
    status=$?
    [[ $status == 1 ]] || fail 'Cannot inspect port 8081 with lsof.'
    return 1
  fi
}

select_device() {
  local selection
  selection=$(xcrun simctl list devices available --json | node -e '
    const fs = require("node:fs");
    const id = process.argv[1];
    const devices = Object.values(JSON.parse(fs.readFileSync(0, "utf8")).devices).flat()
      .filter(d => d.isAvailable && (id ? d.udid === id : d.state === "Booted"));
    if (devices.length !== 1) throw Error("Select one booted simulator or set PIM_IOS_DEVICE");
    const d = devices[0];
    console.log([d.udid, d.state, d.name].join("\t"));
  ' "$DEVICE") || fail 'Cannot select exactly one available simulator.'
  IFS=$'\t' read -r UDID STATE NAME <<< "$selection"
}

start_metro() {
  local launch
  if metro_ready; then
    printf '%s\n' 'Reusing existing Pim Metro on port 8081.'
  else
    [[ -d node_modules && -f .tools/npm-user.conf && -f .tools/npm-global.conf ]] || \
      fail 'The prepared Node/npm setup is missing. No provisioning was attempted.'
    if tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
      fail 'Metro session exists but is not healthy. Inspect logs; no server was started.'
    fi
    mkdir -p "${SOCKET%/*}"
    launch="exec env -u EXPO_TOKEN -u CI PATH=$PATH NPM_CONFIG_USERCONFIG=$WORK/.tools/npm-user.conf NPM_CONFIG_GLOBALCONFIG=$WORK/.tools/npm-global.conf __UNSAFE_EXPO_HOME_DIRECTORY=$WORK/.tools/expo-home EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 npm run start --workspace @pim/mobile -- --go --host lan --port 8081"
    tmux -f /dev/null -S "$SOCKET" new-session -d -s "$SESSION" -c "$WORK" \
      "/bin/bash --noprofile --norc -c '$launch'"
    printf '%s\n' 'Started Pim Metro.'
  fi
  printf 'Monitor: ssh -t %s '\''tmux -S %s attach -t %s'\''\n' "$MAC" "$SOCKET" "$SESSION"
}

open_app() {
  local attempt ready=0 installed version='' sdk app
  select_device
  for ((attempt=0; attempt<20; attempt++)); do
    if metro_ready; then ready=1; break; fi
    sleep 1
  done
  [[ $ready == 1 ]] || fail 'Metro is not ready. Run start or inspect logs.'
  if [[ $STATE != Booted ]]; then xcrun simctl boot "$UDID"; fi
  xcrun simctl bootstatus "$UDID" -b
  sdk=$(node -p 'require("./mobile/package.json").dependencies.expo.split(".")[0]')
  if installed=$(xcrun simctl get_app_container "$UDID" host.exp.Exponent app 2>/dev/null); then
    version=$(plutil -extract CFBundleShortVersionString raw -o - "$installed/Info.plist")
  fi
  if [[ ${version%%.*} != "$sdk" ]]; then
    local -a cached_apps
    shopt -s nullglob
    cached_apps=("$WORK/.tools/expo-home/ios-simulator-app-cache/Expo-Go-$sdk."*.tar.app)
    shopt -u nullglob
    [[ ${#cached_apps[@]} == 1 && -d ${cached_apps[0]} ]] || \
      fail 'Expected one matching cached Expo Go. Update the cache explicitly; no download was attempted.'
    app=${cached_apps[0]}
    xcrun simctl install "$UDID" "$app"
  fi
  xcrun simctl openurl "$UDID" "exp://$HOST:8081?__expo_disable_fab=1&__expo_disable_auto_launch=1&__expo_disable_onboarding=1"
  open "devices://device/open?id=$UDID"
  printf 'Launch requested on %s (%s). Tap Open if iOS asks to open Expo Go.\n' "$NAME" "$UDID"
}

remote_command() {
  export PATH="$WORK/.tools/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  cd "$WORK"
  case $1 in
    check) [[ -f mobile/package.json ]] || fail 'Prepared checkout is missing.' ;;
    status)
      node --version
      xcrun simctl list devices booted
      if metro_ready; then printf '%s\n' 'Metro: expected Pim project on port 8081.'
      else printf '%s\n' 'Metro: stopped.'; fi ;;
    start) start_metro ;;
    open) open_app ;;
    logs) tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION:0.0" -S -80 ;;
    screenshot)
      select_device
      [[ $STATE == Booted ]] || fail 'Selected simulator is not booted.'
      local directory
      directory=$(mktemp -d /tmp/pim-ios.XXXXXX)
      xcrun simctl io "$UDID" screenshot "$directory/capture.png"
      printf '%s\n' "$directory/capture.png" ;;
    cleanup)
      [[ $2 =~ ^/tmp/pim-ios\.[a-zA-Z0-9]{6}/capture\.png$ ]] || fail 'Invalid temporary screenshot path.'
      rm "$2"
      rmdir "${2%/*}" ;;
    *) fail 'Unknown remote command.' ;;
  esac
}

main() {
  local command=${1:---help} output=${2:-} shot result=0
  if [[ $command == --remote ]]; then
    [[ $# == 7 ]] || fail 'Invalid remote arguments.'
    MAC=$3 WORK=$4 HOST=$5 DEVICE=$6
    validate_config
    remote_command "$2" "$7"
    return
  fi
  if [[ $command == --help ]]; then
    printf '%s\n' 'Usage: bash .pi/skills/ios-macos/scripts/ios-mac.sh <status|sync|start|open|run|screenshot|logs> [screenshot.png]' \
      'run = sync + start + open. Uses the prepared Mac, without provisioning.' \
      'Overrides: PIM_IOS_SSH, PIM_IOS_DIR, PIM_IOS_HOST, PIM_IOS_DEVICE.'
    return
  fi
  case $command in status|sync|start|open|run|screenshot|logs) ;; *) fail 'Invalid command. Use --help.' ;; esac
  [[ $# -le 2 && ( -z $output || $command == screenshot ) ]] || fail 'Invalid arguments. Use --help.'
  validate_config
  SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ios-mac.sh
  ROOT=$(cd "${SELF%/*}/../../../.." && pwd)
  case $command in
    sync) sync_source ;;
    run) sync_source; remote start; remote open ;;
    screenshot)
      shot=$(remote screenshot)
      [[ $shot =~ ^/tmp/pim-ios\.[a-zA-Z0-9]{6}/capture\.png$ ]] || fail 'Invalid remote screenshot path.'
      if [[ -z $output ]]; then output=$(mktemp -d "${TMPDIR:-/tmp}/pim-ios.XXXXXX")/capture.png; fi
      scp -q -o BatchMode=yes "$MAC:$shot" "$output" || result=$?
      remote cleanup "$shot" || result=$?
      [[ $result == 0 ]] || return "$result"
      printf '%s\n' "$output" ;;
    *) remote "$command" ;;
  esac
}

if [[ ${BASH_SOURCE[0]:-} == "$0" || ${1:-} == --remote ]]; then main "$@"; fi
