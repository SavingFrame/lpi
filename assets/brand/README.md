# lpi identity

The icon is a squared thread with two endpoints. The wordmark is lowercase **lpi** (local pi).

- Foreground: `#B1D4E5`.
- Background: `#24333C`.
- `lpi-icon.svg` / `.png`: rounded tile for desktop, in-app branding, and browser favicon.
- `lpi-app-icon.svg` / `.png`: opaque square for OS-applied masks and mobile app icons.
- `lpi-adaptive-foreground.svg` / `.png`: transparent Android adaptive foreground.
- `lpi-monochrome.svg` / `.png`: transparent single-colour mark for system surfaces.
- `lpi-icon.ico`: Windows icon with 16, 32, 48, 64, 128, and 256 px frames.

The PNG source assets are 1024 × 1024. SVGs are the editable masters. Regenerate them with
`rsvg-convert -w 1024 -h 1024 <source.svg> -o <destination.png>`. Browser copies live in
`frontend/public/assets/`; their 180, 192, and 512 px PNGs use the square app-icon source.
Expo app-icon and adaptive-icon copies live in `mobile/assets/`. Keep these paths inside
`mobile/` so Expo Go's manifest asset URLs resolve correctly. Update these copies when regenerating
the corresponding brand PNGs. Do not bake rounded corners into the iOS app-icon source.
The platform applies its own mask.

The Electron main process bundles the rounded PNG for window, Dock, and notification icons.
Expo uses the square and adaptive assets. A real packaged macOS/Windows app still needs its
platform packaging configuration; this repository does not provide installers yet.
