import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'check' | 'close' | 'trash' | 'lock' | 'globe' | 'chevronLeft' | 'chevronRight' | 'chevronDown'
  | 'plus' | 'pause' | 'play' | 'timer' | 'copy' | 'eye' | 'phone' | 'google' | 'undo' | 'clock' | 'cloud' | 'back';

interface Props { name: IconName; size?: number; color?: string; strokeWidth?: number }

/** Small stroke icons on a 24 grid (lock, globe, check, trash as in the Design Spec glyph set). */
export function Icon({ name, size = 16, color = '#f3efe8', strokeWidth = 1.8 }: Props) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'check' && <Path d="M5 12.5 10 17.5 19 7" {...p} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...p} />}
      {name === 'trash' && (
        <>
          <Path d="M4 7h16" {...p} />
          <Path d="M9 7V4.5h6V7" {...p} />
          <Path d="M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" {...p} />
          <Path d="M10 11v6M14 11v6" {...p} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x="5" y="10.5" width="14" height="10" rx="2.2" {...p} />
          <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...p} />
        </>
      )}
      {name === 'globe' && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5Z" {...p} />
        </>
      )}
      {name === 'chevronLeft' && <Path d="M14.5 5.5 8 12l6.5 6.5" {...p} />}
      {name === 'back' && <Path d="M14.5 5.5 8 12l6.5 6.5" {...p} />}
      {name === 'chevronRight' && <Path d="M9.5 5.5 16 12l-6.5 6.5" {...p} />}
      {name === 'chevronDown' && <Path d="M5.5 9.5 12 16l6.5-6.5" {...p} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'pause' && (
        <>
          <Rect x="6.5" y="5" width="3.6" height="14" rx="1" fill={color} />
          <Rect x="13.9" y="5" width="3.6" height="14" rx="1" fill={color} />
        </>
      )}
      {name === 'play' && <Path d="M8 5.5v13l11-6.5-11-6.5Z" fill={color} />}
      {name === 'timer' && (
        <>
          <Circle cx="12" cy="13.5" r="7" {...p} />
          <Path d="M12 9.5v4l2.5 1.5M9.5 3.5h5" {...p} />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M12 7.5V12l3 2" {...p} />
        </>
      )}
      {name === 'copy' && (
        <>
          <Rect x="8.5" y="8.5" width="11" height="11" rx="2" {...p} />
          <Path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" {...p} />
        </>
      )}
      {name === 'eye' && (
        <>
          <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...p} />
          <Circle cx="12" cy="12" r="2.8" {...p} />
        </>
      )}
      {name === 'phone' && (
        <>
          <Rect x="7" y="3" width="10" height="18" rx="2.5" {...p} />
          <Path d="M10.5 18h3" {...p} />
        </>
      )}
      {name === 'google' && (
        <Path
          d="M20.5 12.2c0-.6-.05-1.1-.15-1.6H12v3.1h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.4ZM12 21c2.4 0 4.5-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21ZM7 13.8a5.4 5.4 0 0 1 0-3.5V8H4a9 9 0 0 0 0 8.1l3-2.3ZM12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7Z"
          fill={color}
        />
      )}
      {name === 'undo' && (
        <>
          <Path d="M9 7 4.5 11.5 9 16" {...p} />
          <Path d="M5 11.5h9a5 5 0 0 1 0 10h-2" {...p} />
        </>
      )}
      {name === 'cloud' && <Path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8H7Z" {...p} />}
    </Svg>
  );
}
