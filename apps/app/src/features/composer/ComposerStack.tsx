import { View } from 'react-native';

import { ThinkingPill } from '../ai/ThinkingPill';
import { pickPhrase } from '../ai/phrases';
import { AskSheet } from '../ask/AskSheet';
import { Composer } from './Composer';
import { composer, useComposer } from './instance';

/**
 * Everything that stacks above the bottom edge for the AI flow: the thinking pill, the question
 * sheet and the composer bar. The calendar mounts it in its bottom column (`ComposerSlot`).
 */
export function ComposerStack({ hint, focusToken }: { hint?: string; focusToken?: string }) {
  const c = useComposer();
  return (
    <View pointerEvents="box-none">
      {c.phase === 'thinking' ? <ThinkingPill phrase={pickPhrase(c.query, c.seq)} /> : null}
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
