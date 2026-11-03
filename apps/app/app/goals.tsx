import { useCallback } from 'react';
import { router, Stack } from 'expo-router';

import { GoalsSheet } from '@/features/goals/GoalsSheet';

/** `aicalendar://goals` (and widget goal taps): the goals sheet on its overview, the progress graph and the goal grid, over whatever is behind it. */
export default function GoalsRoute() {
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return (
    <>
      <Stack.Screen
        options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
      />
      <GoalsSheet onClosed={goBack} testID="goals-route-sheet" />
    </>
  );
}
