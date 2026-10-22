import {
  launchImageLibraryAsync,
  UIImagePickerPreferredAssetRepresentationMode,
} from 'expo-image-picker';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DraftController } from '../../../../src/client/drafts';
import { MAX_IMAGES } from '../../../../src/shared/attachments';
import { pickedImages } from '../../lib/attachments';
import { colors } from '../../theme/colors';

export function AttachmentPicker({
  draft,
  disabled,
  onBusy,
  input,
  children,
}: {
  draft: DraftController;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  input: ReactNode;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getState);
  const [busy, setBusy] = useState(false);
  const picking = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function pick() {
    if (disabled || picking.current) {
      return;
    }
    picking.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES - draft.getState().draft.images.length,
        base64: true,
        quality: 1,
        preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!mounted.current || result.canceled) {
        return;
      }
      draft.update((current) => ({
        ...current,
        images: pickedImages(result.assets, current.images),
      }));
    } catch (error) {
      if (mounted.current) {
        Alert.alert(
          'Could not attach images',
          error instanceof Error ? error.message : 'Try selecting the images again.',
        );
      }
    } finally {
      picking.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <View style={styles.container}>
      {state.draft.images.length > 0 && (
        <ScrollView
          horizontal
          style={styles.previewStrip}
          contentContainerStyle={styles.previews}
          keyboardShouldPersistTaps="always"
        >
          {state.draft.images.map((image, index) => (
            <View key={String(index)} style={styles.preview}>
              <Image
                accessibilityLabel={`Attachment ${index + 1}`}
                source={{ uri: `data:${image.mimeType};base64,${image.data}` }}
                style={styles.image}
                resizeMode="cover"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove attachment ${index + 1}`}
                disabled={disabled || busy}
                onPress={() =>
                  draft.update((current) => ({
                    ...current,
                    images: current.images.filter((_, position) => position !== index),
                  }))
                }
                style={styles.remove}
              >
                <Text style={styles.cross}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.composer}>
        {input}
        <View style={styles.inputRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach images"
            accessibilityHint="Choose up to four images. Unsent images are kept only until the app restarts."
            disabled={disabled || busy || state.draft.images.length >= MAX_IMAGES}
            onPress={() => void pick()}
            style={[
              styles.add,
              (disabled || busy || state.draft.images.length >= MAX_IMAGES) && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.plus}>+</Text>
            )}
          </Pressable>
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  composer: { backgroundColor: colors.panel, borderRadius: 24, padding: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { color: colors.accent, fontSize: 30, lineHeight: 34 },
  disabled: { opacity: 0.35 },
  previewStrip: { flexGrow: 0, height: 88 },
  previews: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  preview: { width: 80, height: 80 },
  image: { width: 80, height: 80, borderRadius: 8 },
  remove: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    padding: 4,
  },
  cross: {
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 10,
    width: 20,
    height: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
});
