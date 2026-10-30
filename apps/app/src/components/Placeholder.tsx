import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type Props = {
  /** Screen title, also used as the testID prefix. */
  title: string;
  /** Design Spec code(s) this screen is built from, e.g. "OA 1". */
  spec?: string;
  /** What this screen will become. */
  description: string;
  /** Outstanding work, shown as a list so gaps stay visible. */
  todos: string[];
  /** Navigation links, to click through the route skeleton. */
  links?: { label: string; href: Href }[];
  children?: ReactNode;
};

/**
 * Dark placeholder screen used while the route skeleton is empty.
 * Delete once each screen has its real implementation.
 */
export function Placeholder({ title, spec, description, todos, links, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      {spec ? <Text style={styles.spec}>{spec}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{description}</Text>

      <View style={styles.todos}>
        {todos.map((todo) => (
          <Text key={todo} style={styles.todo}>
            {'TODO  '}
            <Text style={styles.todoText}>{todo}</Text>
          </Text>
        ))}
      </View>

      {children}

      {links?.length ? (
        <View style={styles.links}>
          {links.map((link) => (
            <Link key={link.label} href={link.href} style={styles.link}>
              {link.label}
            </Link>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  spec: { color: colors.accent, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 28, fontWeight: '600' },
  body: { color: colors.textMuted, fontSize: 16, lineHeight: 22 },
  todos: { gap: spacing.sm, marginTop: spacing.sm },
  todo: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  todoText: { color: colors.textMuted, fontWeight: '400', fontSize: 14 },
  links: { gap: spacing.md, marginTop: spacing.lg },
  link: { color: colors.accent, fontSize: 16 },
});
