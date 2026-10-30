import Svg, { Circle } from 'react-native-svg';
import { RING, ringDash } from '@calendar/core';

interface Props {
  /** 0..1 */
  fraction: number;
  color: string;
  size?: number;
  strokeWidth?: number;
  track?: string;
}

/** Goal / timer ring: the shared 18-unit geometry (r 7.5), starting at 12 o'clock. */
export function Ring({ fraction, color, size = 16, strokeWidth = RING.stroke, track = RING.track }: Props) {
  const d = ringDash(fraction);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${RING.viewBox} ${RING.viewBox}`}>
      <Circle cx={RING.cx} cy={RING.cy} r={RING.r} stroke={track} strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={RING.cx}
        cy={RING.cy}
        r={RING.r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={d.dasharray}
        strokeDashoffset={d.dashoffset}
        transform={`rotate(${RING.rotation} ${RING.cx} ${RING.cy})`}
      />
    </Svg>
  );
}
