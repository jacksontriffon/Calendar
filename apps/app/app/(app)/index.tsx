import { Placeholder } from '@/components/Placeholder';

export default function CalendarScreen() {
  return (
    <Placeholder
      title="Calendar"
      description="Day, 3-day, week, month, goal and story views, ported from the prototype."
      todos={[
        'Views with drag/resize, pinch zoom, now line, sun shading',
        'Header with avatar that opens Settings',
        'Bottom composer that sends notes to ai-schedule',
        'Local-first store (Legend-State spike, phase 3)',
      ]}
      links={[
        { label: 'Welcome', href: '/welcome' },
        { label: 'Event (demo)', href: { pathname: '/event/[id]', params: { id: 'demo' } } },
        { label: 'Goal (demo)', href: { pathname: '/goal/[id]', params: { id: 'demo' } } },
        { label: 'Settings', href: '/settings' },
      ]}
    />
  );
}
