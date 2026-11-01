import { useCallback } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { GoalsSheet } from '@/features/goals/GoalsSheet';

/** `aicalendar://goal/{id}` (and widget goal taps): the goals sheet opened on that goal, over whatever is behind it. */
export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return (
    <>
      <Stack.Screen
        options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
      />
      <GoalsSheet onClosed={goBack} initialGoalId={String(id)} testID="goal-sheet" />
    </>
  );
}
