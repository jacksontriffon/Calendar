import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke icons on a 24 grid (Lucide shapes, MIT), plus the Apple and Google marks. */
const PATHS = {
  check: ['M20 6 9 17l-5-5'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  warning: [
    'M12 9v4',
    'M12 16.5h.01',
    'M10.3 3.9 2.4 17.4A1.9 1.9 0 0 0 4 20.2h16a1.9 1.9 0 0 0 1.6-2.8L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z',
  ],
  cloudOff: [
    'm2 2 20 20',
    'M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193',
    'M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07',
  ],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  clock: ['M12 6v6l4 2'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ],
  tag: [
    'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
  ],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  logOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
} as const;

export type IconName = keyof typeof PATHS | 'phone' | 'calendar' | 'clockFace';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color = '#f3efe8', strokeWidth = 2 }: IconProps) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {name === 'phone' ? (
        <>
          <Rect x={5} y={2} width={14} height={20} rx={2} {...common} />
          <Path d="M12 18h.01" {...common} />
        </>
      ) : name === 'calendar' ? (
        <>
          <Rect x={3} y={4} width={18} height={18} rx={2} {...common} />
          <Path d="M16 2v4M8 2v4M3 10h18" {...common} />
        </>
      ) : name === 'clockFace' ? (
        <>
          <Circle cx={12} cy={12} r={10} {...common} />
          <Path d="M12 6v6l4 2" {...common} />
        </>
      ) : (
        PATHS[name].map((d) => <Path key={d} d={d} {...common} />)
      )}
    </Svg>
  );
}

const APPLE_PATH =
  'M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-167 41s-107-58-157-128C42 790 0 667 0 551c0-187 122-286 241-286 64 0 117 42 157 42 38 0 98-45 171-45 28 0 128 3 194 79zM554 165c30-36 51-85 51-134 0-7-1-14-2-20-48 2-106 32-140 73-27 31-53 80-53 130 0 8 1 15 2 18 3 1 9 2 14 2 44 0 99-29 128-69z';

/** Apple mark. 814 x 1000 viewBox, so width = size * .814. */
export function AppleMark({ size = 22, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size * 0.814} height={size} viewBox="0 0 814 1000" accessibilityElementsHidden>
      <Path d={APPLE_PATH} fill={color} />
    </Svg>
  );
}

/** The four-colour Google "G". */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden>
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}
