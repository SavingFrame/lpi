import { ArrowDown, ArrowUp, X } from 'lucide-react-native';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../theme/colors';

export function ChatSearch({
  query,
  onQuery,
  count,
  selected,
  onMove,
  onClose,
  error,
}: {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  selected: number;
  onMove: (direction: number) => void;
  onClose: () => void;
  error: boolean;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          autoFocus
          accessibilityLabel="Search messages and replies"
          placeholder="Search messages and replies…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={onQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          submitBehavior="submit"
          onSubmitEditing={() => onMove(1)}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chat search"
          style={styles.button}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        >
          <X size={21} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {error
            ? 'Could not reach match. Try again.'
            : !query
              ? 'Enter text to search'
              : count
                ? `${selected + 1} of ${count}`
                : 'No matches'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous match"
          accessibilityState={{ disabled: !count }}
          disabled={!count}
          style={styles.button}
          onPress={() => onMove(-1)}
        >
          <ArrowUp size={21} color={count ? colors.text : colors.border} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next match"
          accessibilityState={{ disabled: !count }}
          disabled={!count}
          style={styles.button}
          onPress={() => onMove(1)}
        >
          <ArrowDown size={21} color={count ? colors.text : colors.border} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, padding: 10 },
  count: { flex: 1, color: colors.muted, fontSize: 12, paddingLeft: 10 },
  button: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
});
