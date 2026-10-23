import { useId, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  DEFAULT_DISPLAY_THEME,
  type DisplayArtifact,
  displayContentHeight,
  displayNavigationAllowed,
  MIN_DISPLAY_HEIGHT,
} from '../../../../src/shared/display';
import { displayDocument } from '../../../../src/shared/display-document';
import { colors } from '../../theme/colors';
import { CodeBlock } from './markdown';

const theme = {
  ...DEFAULT_DISPLAY_THEME,
  background: colors.background,
  foreground: colors.text,
  muted: colors.muted,
  card: colors.panel,
  border: colors.border,
  accent: colors.accent,
  fontFamily: '-apple-system, system-ui, sans-serif',
  fontSize: '16px',
};

function Preview({ artifact }: { artifact: DisplayArtifact }) {
  const instance = useId();
  const html = artifact.kind === 'html' ? artifact.html : undefined;
  const id = useMemo(() => `${instance}:${html?.length ?? 0}:${Math.random()}`, [instance, html]);
  const [size, setSize] = useState({ id, height: MIN_DISPLAY_HEIGHT });
  const [ratio, setRatio] = useState(1);
  const source = useMemo(
    () => (html === undefined ? undefined : { html: displayDocument({ html, theme, id }) }),
    [html, id],
  );
  return artifact.kind === 'image' ? (
    <Image
      accessibilityLabel={artifact.summary || artifact.title}
      source={{ uri: `data:${artifact.image.mimeType};base64,${artifact.image.data}` }}
      style={{ width: '100%', aspectRatio: ratio }}
      resizeMode="contain"
      onLoad={({ nativeEvent }) => {
        const { width, height } = nativeEvent.source;
        if (width > 0 && height > 0) {
          setRatio(width / height);
        }
      }}
    />
  ) : (
    <WebView
      accessibilityLabel={`${artifact.title}. ${artifact.summary}`}
      source={source}
      style={[styles.preview, { height: size.id === id ? size.height : MIN_DISPLAY_HEIGHT }]}
      // Static HTML needs '*'. Rejected navigation never opens a system browser.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={({ url }) => displayNavigationAllowed(url)}
      onMessage={({ nativeEvent }) => {
        // This bridge has exactly one presentation-only capability. No commands or links.
        if (nativeEvent.data.length > 256) {
          return;
        }
        try {
          const height = displayContentHeight(JSON.parse(nativeEvent.data), id);
          if (height !== undefined) {
            setSize({ id, height });
          }
        } catch {
          // Ignore malformed or unrelated page messages.
        }
      }}
      scrollEnabled={false}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      onOpenWindow={() => {}}
      incognito
      cacheEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      allowsLinkPreview={false}
      allowsAirPlayForMediaPlayback={false}
      allowsPictureInPictureMediaPlayback={false}
      mediaCapturePermissionGrantType="deny"
      mediaPlaybackRequiresUserAction
      dataDetectorTypes="none"
      webviewDebuggingEnabled={false}
    />
  );
}

export function MobileDisplay({
  artifact,
  onInspect,
}: {
  artifact: DisplayArtifact;
  onInspect: () => void;
}) {
  const [source, setSource] = useState(false);
  const [options, setOptions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.visual} onTouchStart={onInspect}>
      {source && artifact.kind === 'html' ? (
        <ScrollView style={styles.source} nestedScrollEnabled>
          <CodeBlock text={artifact.html} language="html" />
        </ScrollView>
      ) : (
        <Preview artifact={artifact} />
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Expand visual"
          onPress={() => setExpanded(true)}
          style={styles.button}
        >
          <Text style={styles.action}>↗</Text>
        </Pressable>
        {artifact.kind === 'html' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Visual options"
            accessibilityState={{ expanded: options }}
            onPress={() => setOptions(!options)}
            style={styles.button}
          >
            <Text style={styles.action}>⋯</Text>
          </Pressable>
        )}
      </View>
      {options && (
        <View style={styles.menu}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSource(!source);
              setOptions(false);
            }}
            style={styles.menuButton}
          >
            <Text style={styles.menuText}>{source ? 'Preview' : 'Source'}</Text>
          </Pressable>
        </View>
      )}
      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setExpanded(false)}
      >
        <View style={styles.modal}>
          <View style={styles.toolbar}>
            <Text style={styles.title}>{artifact.title}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(false)}
              style={styles.closeButton}
            >
              <Text style={styles.menuText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {expanded && <Preview artifact={artifact} />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  visual: { position: 'relative', marginVertical: 12 },
  actions: { position: 'absolute', right: 0, top: 4, flexDirection: 'row', gap: 4 },
  button: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
  },
  action: { color: colors.muted, fontSize: 20 },
  menu: {
    position: 'absolute',
    right: 0,
    top: 44,
    minWidth: 140,
    backgroundColor: colors.panel,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  menuText: { color: colors.text, fontSize: 13 },
  preview: { width: '100%', backgroundColor: colors.background },
  source: { maxHeight: 500 },
  modal: { flex: 1, backgroundColor: colors.background, paddingBottom: 24 },
  modalContent: { padding: 16 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  title: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
});
