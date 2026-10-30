import { ComposerStack } from '../composer/ComposerStack';

/**
 * The bottom composer bar. The note composer, thinking pill and question sheet live in
 * `features/composer`; this keeps the calendar's import stable. `focusToken` is the deep-link hook
 * (`aicalendar://compose` -> `/?compose=1`): the input is focused when it changes.
 */
export function ComposerSlot({ hint, focusToken }: { hint?: string; focusToken?: string }) {
  return <ComposerStack hint={hint} focusToken={focusToken} />;
}
