/**
 * Two-letter initials for avatars: "Sam Rivera" -> "SR", "Sam" -> "SA",
 * "sam.rivera@gmail.com" -> "SR". Always upper case, never empty.
 */
export function initials(nameOrEmail: string | null | undefined): string {
  let s = (nameOrEmail ?? '').trim();
  if (s.includes('@')) s = s.split('@')[0].replace(/[._+-]+/g, ' ').trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]];
  if (words.length === 1) return (first.slice(0, 2).join('') || '?').toUpperCase();
  const last = [...words[words.length - 1]];
  return (first[0] + last[0]).toUpperCase();
}
