import { View } from 'react-native';

import { AskSheet } from '../ask/AskSheet';
import { Composer } from './Composer';
import { composer, useComposer } from './instance';

/**
 * The AI flow's question sheet and composer bar. (The thinking pill is rendered by the calendar,
 * above the goal chips.) The calendar mounts it in its bottom column (`ComposerSlot`).
 */
export function ComposerStack({ hint, focusToken }: { hint?: string; focusToken?: string }) {
  const c = useComposer();
  return (
    <View pointerEvents="box-none">
      {c.ask ? (
        <AskSheet
          ask={c.ask}
          onPick={composer.answerAsk}
          onBack={composer.backAsk}
          onSkip={composer.skipAsk}
          onHover={composer.hoverAsk}
          onKey={composer.askKey}
        />
      ) : null}
      <Composer hint={hint} focusToken={focusToken} />
    </View>
  );
}
