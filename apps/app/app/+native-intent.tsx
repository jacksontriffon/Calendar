import { systemPathToAppPath } from '@/lib/deepLinks';

/**
 * Rewrites incoming `aicalendar://` links (cold start and warm) to app routes.
 * The table lives in src/lib/deepLinks.ts (Design Spec, Deep links).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return systemPathToAppPath(path);
  } catch {
    return '/';
  }
}
