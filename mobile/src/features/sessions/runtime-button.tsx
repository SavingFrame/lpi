import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../../theme/colors';

export function RuntimeButton({
  label,
  hint,
  pending,
  disabled,
  color,
  onPress,
  icon = 'power',
}: {
  label: string;
  hint: string;
  pending: boolean;
  disabled: boolean;
  color: string;
  onPress: () => void;
  icon?: 'power' | 'archive' | 'restore';
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
      ) : icon !== 'power' ? (
        <View accessible={false} style={styles.archiveIcon}>
          <View style={[styles.archiveLid, { borderColor: color }]} />
          <View style={[styles.archiveBox, { borderColor: color }]}>
            {icon === 'restore' ? (
              <View style={styles.restoreArrow}>
                <View style={[styles.arrowHead, { borderColor: color }]} />
                <View style={[styles.arrowStem, { backgroundColor: color }]} />
              </View>
            ) : (
              <View style={[styles.archiveHandle, { backgroundColor: color }]} />
            )}
          </View>
        </View>
      ) : (
        <View accessible={false} style={[styles.powerIcon, { borderColor: color }]}>
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
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 8,
  },
  powerStem: {
    position: 'absolute',
    top: -4,
    left: 4,
    width: 5,
    height: 9,
    borderColor: colors.background,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  archiveIcon: { width: 16, height: 16, alignItems: 'center' },
  archiveLid: { width: 16, height: 5, borderWidth: 1.5, borderRadius: 1 },
  archiveBox: {
    width: 13,
    height: 10,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    alignItems: 'center',
  },
  archiveHandle: { width: 5, height: 1.5, marginTop: 3 },
  restoreArrow: { alignItems: 'center', marginTop: 2 },
  arrowHead: {
    width: 5,
    height: 5,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    transform: [{ rotate: '45deg' }],
  },
  arrowStem: { position: 'absolute', top: 1, width: 1.5, height: 6 },
  disabled: { opacity: 0.4 },
});
