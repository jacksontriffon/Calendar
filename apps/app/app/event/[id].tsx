import { useLocalSearchParams } from 'expo-router';

import { Placeholder } from '@/components/Placeholder';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Placeholder
      spec="EV 01-05"
      title={`Event ${id}`}
      description="Event sheet: title, time, category, repeat, visibility row and picker, trash-icon delete."
      todos={[
        'Edit form bound to the local store',
        'Visibility row (Private / Public) and target picker',
        'Read-only variant for someone else’s event, with Copy and Remove',
      ]}
    />
  );
}
