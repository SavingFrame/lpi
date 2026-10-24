import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { TextMatch } from '../../../../src/client/text-search';
import { colors } from '../../theme/colors';

export function HighlightedText({
  text,
  matches,
  active,
  offset = 0,
}: {
  text: string;
  matches: TextMatch[];
  active?: TextMatch;
  offset?: number;
}) {
  let cursor = 0;
  const parts: ReactNode[] = [];
  for (const match of matches) {
    if (match.end <= offset || match.start >= offset + text.length) {
      continue;
    }
    const start = Math.max(0, match.start - offset);
    const end = Math.min(text.length, match.end - offset);
    parts.push(text.slice(cursor, start));
    parts.push(
      <Text
        key={match.start}
        style={[
          styles.match,
          active?.start === match.start && active.end === match.end && styles.active,
        ]}
      >
        {text.slice(start, end)}
      </Text>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

const styles = StyleSheet.create({
  match: { backgroundColor: colors.blocked, color: colors.background },
  active: { backgroundColor: '#fb923c' },
});
