import { Stack, useLocalSearchParams } from 'expo-router';

import { GoalDetail } from '@/features/goals/GoalDetail';

export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
      />
      <GoalDetail id={String(id)} />
    </>
  );
}
