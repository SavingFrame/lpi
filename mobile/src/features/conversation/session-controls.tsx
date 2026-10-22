import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BridgeCommand } from '../../../../src/shared/commands';
import type {
  ModelOption,
  SessionControls,
  ThinkingLevel,
} from '../../../../src/shared/session-controls';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';

function modelKey(model: ModelOption) {
  return JSON.stringify([model.provider, model.id]);
}

const thinkingColors: Record<ThinkingLevel, string> = {
  off: colors.muted,
  minimal: '#a3b8c2',
  low: '#86c7a3',
  medium: '#93c5fd',
  high: '#c4b5fd',
  xhigh: '#f0abfc',
  max: '#fca5a5',
};

export function MobileSessionControls({
  controls,
  messages,
  enabled,
  onOpen,
}: {
  controls: SessionControls;
  messages: MobileMessages;
  enabled: boolean;
  onOpen: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  const available = enabled && messages.commands.available();
  useEffect(() => {
    void messages.commands.initialize();
  }, [messages]);
  useEffect(() => {
    if (open) {
      onOpen(true);
      return () => onOpen(false);
    }
  }, [open, onOpen]);

  const { model, availableModels, scopedModels, thinkingLevel, availableThinkingLevels } = controls;
  const terms = query.toLowerCase().trim().split(/\s+/);
  const matches = availableModels.filter((option) => {
    const text = `${option.provider} ${option.id} ${option.name}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const scoped = new Set(scopedModels.map(modelKey));
  const sections = [
    { title: 'Pi scoped models', data: matches.filter((item) => scoped.has(modelKey(item))) },
    {
      title: scoped.size ? 'Other models' : 'Available models',
      data: matches.filter((item) => !scoped.has(modelKey(item))),
    },
  ].filter((section) => section.data.length > 0);

  function select(value: BridgeCommand) {
    if (available) {
      void messages.commands.submit(value);
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model and thinking settings: ${model ? `${model.provider} / ${model.name}` : 'no model'}, thinking ${thinkingLevel ?? 'unavailable'}`}
        accessibilityState={{ disabled: !available, expanded: open }}
        disabled={!available}
        style={[styles.pill, !available && styles.disabled]}
        onPress={() => {
          Keyboard.dismiss();
          setQuery('');
          setOpen(true);
        }}
      >
        <Text numberOfLines={1} style={styles.modelName}>
          {model?.name ?? 'Select model'}
        </Text>
        <Text
          style={[
            styles.level,
            { color: thinkingLevel ? thinkingColors[thinkingLevel] : colors.muted },
          ]}
        >
          {thinkingLevel ?? 'N/A'}
        </Text>
        <Text style={styles.detail}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close model and thinking settings"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Model & thinking</Text>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => setOpen(false)}
              >
                <Text style={styles.action}>Done</Text>
              </Pressable>
            </View>
            <Text style={styles.currentModel}>
              {model ? `${model.provider} / ${model.name}` : 'No model selected'}
            </Text>
            <Text style={styles.heading}>Thinking level</Text>
            <View style={styles.levels}>
              {availableThinkingLevels.map((level) => (
                <Pressable
                  key={level}
                  accessibilityRole="radio"
                  accessibilityLabel={`Thinking ${level}`}
                  accessibilityState={{
                    checked: level === thinkingLevel,
                    disabled: !available || !model,
                  }}
                  disabled={!available || !model}
                  style={[
                    styles.levelOption,
                    level === thinkingLevel && styles.selected,
                    (!available || !model) && styles.disabled,
                  ]}
                  onPress={() => {
                    if (level !== thinkingLevel) {
                      select({ type: 'set_thinking_level', level });
                    }
                  }}
                >
                  <Text style={[styles.level, { color: thinkingColors[level] }]}>{level}</Text>
                </Pressable>
              ))}
              {!availableThinkingLevels.length && (
                <Text style={styles.detail}>Unavailable for this model.</Text>
              )}
            </View>
            {command.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {command.error.message}
              </Text>
            )}
            {command.uncertain ? (
              <Text style={styles.notice}>
                Outcome unknown. Close and review the conversation before making more changes.
              </Text>
            ) : command.pending ? (
              <Text style={styles.notice}>Applying change…</Text>
            ) : !available ? (
              <Text style={styles.notice}>
                Changes require a connected, idle session with no queued messages or dialogs.
              </Text>
            ) : null}
            <TextInput
              accessibilityLabel="Search models"
              placeholder="Search name, provider, or model ID"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              style={styles.search}
            />
            <SectionList
              style={styles.list}
              sections={sections}
              keyExtractor={modelKey}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={<Text style={styles.hint}>No matching models.</Text>}
              renderSectionHeader={({ section }) => (
                <Text style={styles.hint}>{section.title}</Text>
              )}
              renderItem={({ item }) => {
                const selected = model !== null && modelKey(model) === modelKey(item);
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: !available }}
                    disabled={!available}
                    style={[
                      styles.option,
                      selected && styles.selected,
                      !available && styles.disabled,
                    ]}
                    onPress={() => {
                      if (!selected) {
                        select({ type: 'set_model', provider: item.provider, modelId: item.id });
                      }
                    }}
                  >
                    <Text style={styles.label}>{item.name}</Text>
                    <Text style={styles.detail}>
                      {item.provider} / {item.id}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 12,
    backgroundColor: colors.selected,
  },
  modelName: { flexShrink: 1, color: colors.text, fontSize: 13 },
  level: { fontSize: 13, fontWeight: '500' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  action: { color: colors.accent, fontSize: 14 },
  disabled: { opacity: 0.45 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000080' },
  sheet: {
    height: '80%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  currentModel: { color: colors.muted, paddingHorizontal: 16, paddingBottom: 12, fontSize: 13 },
  heading: { color: colors.text, fontSize: 14, fontWeight: '600', paddingHorizontal: 16 },
  search: {
    color: colors.text,
    fontSize: 16,
    padding: 12,
    margin: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  hint: { color: colors.muted, padding: 12, backgroundColor: colors.panel },
  levels: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  levelOption: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12 },
  list: { flex: 1 },
  option: { minHeight: 48, padding: 12, gap: 4, borderRadius: 8 },
  selected: { backgroundColor: colors.selected },
  label: { color: colors.text, fontSize: 16 },
  detail: { color: colors.muted, fontSize: 12 },
  error: { color: colors.error, paddingHorizontal: 16, fontSize: 13 },
  notice: { color: colors.blocked, paddingHorizontal: 16, fontSize: 13 },
});
