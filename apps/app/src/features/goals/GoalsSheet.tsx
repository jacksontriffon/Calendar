import { Sheet } from '@/components/Sheet';
import { AppText } from '@/components/AppText';

/** Placeholder until the goals list lands. */
export function GoalsSheet({ onClosed }: { onClosed: () => void; onOpenGoal: (id: string) => void }) {
  return (
    <Sheet onClosed={onClosed}>
      <AppText>Goals</AppText>
    </Sheet>
  );
}
