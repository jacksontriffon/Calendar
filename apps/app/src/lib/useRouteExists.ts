/**
 * "Does this route exist yet?" Several screens this phase links to (Connect
 * Google, phone calendars, calendars settings) are built in later phases.
 * Navigating to a missing route would land on +not-found, so callers check
 * first and treat a missing route as a skip.
 */
import { useSitemap, type SitemapType } from 'expo-router';
import { useMemo } from 'react';

/** `/(app)/settings/index` -> `/settings`; groups and a trailing `index` are dropped. */
export function normalizeRoutePath(path: string): string {
  const segs = path
    .split('?')[0]
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s) && s !== 'index');
  return '/' + segs.join('/');
}

/** All static route paths in a sitemap tree, normalised. */
export function collectRoutePaths(node: SitemapType | null): Set<string> {
  const out = new Set<string>();
  const walk = (n: SitemapType) => {
    if (!n.isInternal && typeof n.href === 'string') out.add(normalizeRoutePath(n.href));
    n.children.forEach(walk);
  };
  if (node) walk(node);
  return out;
}

/** Whether `target` (a static path such as `/settings/calendars/phone`) matches a known route. */
export function hasRoute(paths: ReadonlySet<string>, target: string): boolean {
  return paths.has(normalizeRoutePath(target));
}

export function useRouteExists(): (target: string) => boolean {
  const sitemap = useSitemap();
  const paths = useMemo(() => collectRoutePaths(sitemap), [sitemap]);
  return (target) => hasRoute(paths, target);
}
