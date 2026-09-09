'use client';

import { useEffect, useState } from 'react';

/** Reads a media query without breaking server rendering. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const usePhone = () => useMediaQuery('(max-width: 619px)');
