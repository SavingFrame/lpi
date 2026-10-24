import { useRef } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

/** iOS scrolls inverted lists to the newest message. Route its status-bar tap through a
 * non-inverted native target, without first jumping the visible transcript to offset zero.
 */
export function StatusBarScrollTarget({ visible, onTop }: { visible: boolean; onTop: () => void }) {
  const target = useRef<ScrollView>(null);
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    <ScrollView
      ref={target}
      style={styles.target}
      contentOffset={{ x: 0, y: 1 }}
      scrollsToTop={visible}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      showsVerticalScrollIndicator={false}
      bounces={false}
      pointerEvents="box-none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onScrollToTop={() => {
        onTop();
        // Re-arm the native target so subsequent status-bar taps are also delivered.
        target.current?.scrollTo({ x: 0, y: 1, animated: false });
      }}
    >
      <View style={styles.content} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  target: { position: 'absolute', width: 1, height: 1 },
  content: { height: 2 },
});
