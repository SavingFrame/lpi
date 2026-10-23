import { useEffect, useState } from 'react';
import { DEFAULT_DISPLAY_THEME, type DisplayTheme } from '../../src/shared/display';

export function useDisplayTheme(): DisplayTheme {
  const [theme, setTheme] = useState(DEFAULT_DISPLAY_THEME);
  useEffect(() => {
    const update = () => {
      const style = getComputedStyle(document.documentElement);
      const color = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
      const next: DisplayTheme = {
        appearance: style.colorScheme === 'light' ? 'light' : 'dark',
        background: color('--background', DEFAULT_DISPLAY_THEME.background),
        foreground: color('--foreground', DEFAULT_DISPLAY_THEME.foreground),
        muted: color('--muted-foreground', DEFAULT_DISPLAY_THEME.muted),
        card: color('--secondary', DEFAULT_DISPLAY_THEME.card),
        border: color('--border', DEFAULT_DISPLAY_THEME.border),
        accent: color('--visual-accent', DEFAULT_DISPLAY_THEME.accent),
        fontFamily: style.fontFamily || DEFAULT_DISPLAY_THEME.fontFamily,
        fontSize: style.fontSize || DEFAULT_DISPLAY_THEME.fontSize,
        monoFontFamily: DEFAULT_DISPLAY_THEME.monoFontFamily,
      };
      setTheme((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, []);
  return theme;
}
