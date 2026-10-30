import { Placeholder } from '@/components/Placeholder';

export default function Welcome() {
  return (
    <Placeholder
      spec="OA 1"
      title="Schedule your day in seconds"
      description="Welcome and sign-in. Sign-in is required: Apple and Google only."
      todos={[
        'One-shot intro animation on a single Reanimated clock (0-9700 ms), respecting reduce-motion',
        'Apple (expo-apple-authentication + signInWithIdToken) and Google sign-in buttons; Google first on Android',
        'Redirect into (app) once a Supabase session exists',
      ]}
      links={[{ label: 'Continue to calendar (dev only)', href: '/' }]}
    />
  );
}
