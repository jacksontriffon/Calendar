import { StyleSheet } from 'react-native';
import { text, white, type PaceInfo } from '@calendar/core';

import { AppText } from '@/components/AppText';

/** The pace chip: the pace word on a 16% tint of its traffic-light colour (grey when there is no pace). */
export function PacePill({ pace }: { pace: PaceInfo }) {
  return (
    <AppText
      numberOfLines={1}
      style={[styles.pill, pace.color ? { color: pace.color, backgroundColor: pace.color + '29' } : null]}
    >
      {pace.word}
    </AppText>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', fontSize: 11, lineHeight: 15, fontWeight: '600',
    paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, fontVariant: ['tabular-nums'],
    color: text(0.55), backgroundColor: white(0.06),
  },
});
