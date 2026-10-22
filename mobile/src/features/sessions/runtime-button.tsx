import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../../theme/colors';

export function RuntimeButton({
  label,
  hint,
  pending,
  disabled,
  color,
  onPress,
}: {
  label: string;
  hint: string;
  pending: boolean;
  disabled: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy: pending }}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      onPress={onPress}
    >
      {pending ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <View style={[styles.powerIcon, { borderColor: color }]}>
          <View style={[styles.powerStem, { backgroundColor: color }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  powerIcon: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 10,
  },
  powerStem: {
    position: 'absolute',
    top: -5,
    left: 5,
    width: 6,
    height: 12,
    borderColor: colors.background,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  disabled: { opacity: 0.4 },
});
