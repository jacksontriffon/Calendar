import { Placeholder } from '@/components/Placeholder';

export default function SettingsScreen() {
  return (
    <Placeholder
      spec="CA 5 / OA 4-6"
      title="Settings"
      description="Account, Calendars, region and sun, typeface, Claude parsing, History."
      todos={[
        'Account (sign out, delete account)',
        'Calendars: My calendar, Google accounts, On this phone, Hidden events',
        'Add nested routes (settings/calendars, ...) as screens land',
      ]}
    />
  );
}
