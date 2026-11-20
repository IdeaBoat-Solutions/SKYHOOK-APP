import { useEffect, useState } from 'react';

/** Minimal history router: push a path and notify listeners via popstate. */
export function navigate(path: string, { replace = false } = {}): void {
  if (window.location.pathname !== path) {
    if (replace) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return path;
}
