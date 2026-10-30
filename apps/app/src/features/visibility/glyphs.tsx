/**
 * Glyphs the Design Spec uses that the shared icon set doesn't have yet (cloud-off, warning, refresh,
 * layers, link, calendar) and the status spinner. Same 24 grid and stroke style as `components/Icon`.
 */
import { useEffect } from 'react';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type GlyphName = 'cloudOff' | 'warning' | 'refresh' | 'layers' | 'link' | 'calendar' | 'plus' | 'checkSolid';

interface Props {
  name: GlyphName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Glyph({ name, size = 16, color = '#f3efe8', strokeWidth = 1.8 }: Props) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'cloudOff' && (
        <>
          <Path d="M7 18a4.5 4.5 0 0 1-.9-8.9M9.2 5.9A6 6 0 0 1 18 10a4 4 0 0 1 1.9 7.5M10 18h6.5" {...p} />
          <Path d="M3.5 3.5l17 17" {...p} />
        </>
      )}
      {name === 'warning' && (
        <>
          <Path d="M12 4 21 19.5H3L12 4Z" {...p} />
          <Path d="M12 10v4.2M12 17h.01" {...p} />
        </>
      )}
      {name === 'refresh' && (
        <>
          <Path d="M20 11.5A8 8 0 0 0 6.1 6.6L4 8.8" {...p} />
          <Path d="M4 4.5v4.3h4.3" {...p} />
          <Path d="M4 12.5a8 8 0 0 0 13.9 4.9L20 15.2" {...p} />
          <Path d="M20 19.5v-4.3h-4.3" {...p} />
        </>
      )}
      {name === 'layers' && (
        <>
          <Path d="m12 3.5 9 4.8-9 4.8-9-4.8 9-4.8Z" {...p} />
          <Path d="m3 12.4 9 4.8 9-4.8" {...p} />
          <Path d="m3 16.6 9 4.8 9-4.8" {...p} />
        </>
      )}
      {name === 'link' && (
        <>
          <Path d="M10 14a4.2 4.2 0 0 0 5.9 0l3-3a4.2 4.2 0 0 0-5.9-5.9l-1 1" {...p} />
          <Path d="M14 10a4.2 4.2 0 0 0-5.9 0l-3 3a4.2 4.2 0 0 0 5.9 5.9l1-1" {...p} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect x="4" y="5.5" width="16" height="14.5" rx="2.6" {...p} />
          <Path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...p} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'checkSolid' && <Path d="M5 12.5 10 17.5 19 7" {...p} />}
    </Svg>
  );
}

/** The accent spinner next to "Pending" and "Loading". */
export function Spinner({ size = 12, color = '#cf7b58' }: { size?: number; color?: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(r);
  }, [r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: r.value + 'deg' }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no">
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.16)" strokeWidth={3} />
        <Path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth={3} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}
