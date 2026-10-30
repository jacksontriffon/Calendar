# sync

Data layer between the UI and the outside world (`docs/expo-plan.md` §6).

Planned:

- local-first store (Legend-State v3 + Supabase sync plugin, MMKV on native, IndexedDB on web; phase 3 starts with a spike)
- Supabase sync and realtime
- `device.ts`: phone-calendar bridge via `expo-calendar` (native only; phone events are never uploaded)
- widget snapshot writer and background refresh (`expo-background-task`)

Nothing here is implemented yet. The Supabase client lives in `src/lib/supabase.ts`.
