import { useLocalSearchParams } from 'expo-router';

import { Placeholder } from '@/components/Placeholder';

export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Placeholder
      title={`Goal ${id}`}
      description="Goal detail: outcome, deadline, hours, daily progress and pacing."
      todos={['Goal maths from packages/core', 'Goal-adjust actions via ai-schedule', 'Sessions list']}
    />
  );
}
