export function allowedNavigation(value: string, origin: string, mainFrame: boolean): boolean {
  if (!mainFrame && (value === 'about:blank' || value === 'about:srcdoc')) {
    return true; // The existing opaque-origin visual shell uses a nested srcdoc frame.
  }
  try {
    const url = new URL(value);
    const expected = new URL(origin);
    // Node's URL.origin is "null" for custom schemes. Compare scheme and host explicitly.
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.username ||
      url.password
    ) {
      return false;
    }
    return mainFrame
      ? url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/')
      : url.pathname === '/display';
  } catch {
    return false;
  }
}
