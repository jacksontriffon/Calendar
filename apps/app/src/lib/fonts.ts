/**
 * The prototype's three typefaces, through expo-font (Google Fonts packages):
 *
 *   serif  Spectral      (the default body face; weights 400 / 500 / 600)
 *   sans   Geist
 *   mono   Geist Mono
 *   (display for the serif setting: Newsreader, used by the calendar title)
 *
 * Fonts are imported one weight at a time so only these files are bundled,
 * not every weight in each package. The static families have no 550 / 590 /
 * 650, so the prototype's in-between weights round to the nearest file.
 */
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader/600SemiBold';
import { Spectral_400Regular } from '@expo-google-fonts/spectral/400Regular';
import { Spectral_500Medium } from '@expo-google-fonts/spectral/500Medium';
import { Spectral_600SemiBold } from '@expo-google-fonts/spectral/600SemiBold';
import { useFonts } from 'expo-font';

export type FontKind = 'serif' | 'sans' | 'mono';
export type FontWeight = 400 | 500 | 600;

const FILES = {
  Spectral_400Regular,
  Spectral_500Medium,
  Spectral_600SemiBold,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  GeistMono_400Regular,
  GeistMono_500Medium,
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
};

/** Loads every face. Returns true once ready; also true if loading failed (system fonts take over). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FILES);
  return loaded || error !== null;
}

const FAMILY: Record<FontKind, Record<FontWeight, string>> = {
  serif: { 400: 'Spectral_400Regular', 500: 'Spectral_500Medium', 600: 'Spectral_600SemiBold' },
  sans: { 400: 'Geist_400Regular', 500: 'Geist_500Medium', 600: 'Geist_600SemiBold' },
  mono: { 400: 'GeistMono_400Regular', 500: 'GeistMono_500Medium', 600: 'GeistMono_500Medium' },
};

const DISPLAY: Record<FontWeight, string> = {
  400: 'Newsreader_400Regular',
  500: 'Newsreader_500Medium',
  600: 'Newsreader_600SemiBold',
};

/** Snap any CSS weight (e.g. 550, 590, 650) to a loaded one. */
export function snapWeight(weight: number): FontWeight {
  return weight >= 575 ? 600 : weight >= 450 ? 500 : 400;
}

/** `fontFamily` string for a face. React Native picks weights by family name, so set `fontWeight` to normal. */
export function fontFamily(kind: FontKind = 'serif', weight: number = 400): string {
  return FAMILY[kind][snapWeight(weight)];
}

/** Display face for large titles: Newsreader with the serif setting, otherwise the chosen face. */
export function displayFamily(kind: FontKind = 'serif', weight: number = 400): string {
  return kind === 'serif' ? DISPLAY[snapWeight(weight)] : fontFamily(kind, weight);
}

/** Narrow the `prefs.font` string to a known face. */
export function asFontKind(v: unknown): FontKind {
  return v === 'sans' || v === 'mono' ? v : 'serif';
}
