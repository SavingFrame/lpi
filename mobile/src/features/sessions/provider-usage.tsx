import { Clock3 } from 'lucide-react-native';
import { useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  resetLabel,
  type UsageController,
  usagePresentation,
} from '../../../../src/client/provider-usage';
import { openAiIconPath } from '../../../../src/shared/provider-icon';
import type { UsageAccount } from '../../../../src/shared/provider-usage';
import { colors } from '../../theme/colors';

const tones = {
  muted: colors.muted,
  normal: colors.text,
  low: colors.blocked,
  critical: colors.error,
  short: colors.running,
  long: colors.accent,
};

function AccountBadge({
  account,
  online,
  now,
}: {
  account: UsageAccount;
  online: boolean;
  now: number;
}) {
  const view = usagePresentation(account, online, now);
  const color = view.tone === 'normal' ? colors.running : tones[view.tone];
  return (
    <View style={styles.badge} accessible={false}>
      <View
        style={styles.gauge}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={44} height={44} viewBox="0 0 48 48">
          {view.rings.map((ring, index) => {
            const radius = index === 0 ? 21 : 16.5;
            const length = 2 * Math.PI * radius;
            return (
              <G key={index === 0 ? 'short' : 'long'} transform="rotate(-90 24 24)">
                <Circle
                  cx={24}
                  cy={24}
                  r={radius}
                  fill="none"
                  stroke={colors.border}
                  strokeWidth={2.5}
                  strokeDasharray={ring.usedPercent === null ? [2, 3] : undefined}
                />
                <Circle
                  cx={24}
                  cy={24}
                  r={radius}
                  fill="none"
                  stroke={tones[ring.tone]}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  opacity={ring.usedPercent ? 1 : 0}
                  strokeDasharray={[(length * (ring.usedPercent ?? 0)) / 100, length]}
                />
              </G>
            );
          })}
          <Path
            d={openAiIconPath}
            transform="translate(14 14) scale(.8333333)"
            fill={colors.muted}
          />
        </Svg>
        {view.outdated && (
          <View style={styles.outdatedIcon}>
            <Clock3 size={13} color={colors.muted} />
          </View>
        )}
      </View>
      <View style={styles.badgeCopy}>
        <Text style={[styles.percent, { color }]}>
          {view.used === null ? '?' : `${Number(view.used.toFixed(1))}%`}
        </Text>
        <Text style={styles.badgeLabel}>{account.label}</Text>
      </View>
    </View>
  );
}

export function ProviderUsagePanel({ controller }: { controller: UsageController }) {
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const now = Date.now();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Provider usage, used allowance. ${state.accounts.map((account) => usagePresentation(account, state.online, now).compact).join('. ')}`}
        accessibilityState={{ expanded: open }}
        style={styles.trigger}
        onPress={() => setOpen(true)}
      >
        {state.accounts.map((account) => (
          <AccountBadge key={account.id} account={account} online={state.online} now={now} />
        ))}
        {!state.accounts.length && (
          <Text style={styles.detail}>{state.loading ? 'Loading…' : 'Unavailable'}</Text>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close usage"
            onPress={() => setOpen(false)}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Provider usage</Text>
              <Pressable
                accessibilityRole="button"
                disabled={state.loading}
                style={styles.button}
                onPress={() => void controller.refresh()}
              >
                <Text style={styles.action}>{state.loading ? 'Updating…' : 'Refresh'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => setOpen(false)}
              >
                <Text style={styles.action}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={styles.detail}>
                Used allowance · outer: short window · inner: weekly
              </Text>
              {state.message && <Text style={styles.detail}>{state.message}</Text>}
              {state.accounts.map((account) => {
                const view = usagePresentation(account, state.online, now);
                const color = tones[view.tone];
                return (
                  <View key={account.id} style={styles.account}>
                    <AccountBadge account={account} online={state.online} now={now} />
                    {view.outdated && <Text style={styles.detail}>Outdated</Text>}
                    {view.windows.map((window) => (
                      <View key={window.label} style={styles.window}>
                        <View style={styles.row}>
                          <Text style={styles.detail}>{window.label} window</Text>
                          <Text style={{ color }}>
                            {Number(window.usedPercent.toFixed(1))}% used
                          </Text>
                        </View>
                        <View
                          accessibilityRole="progressbar"
                          accessibilityLabel={`${account.label} ${window.label} used allowance`}
                          accessibilityValue={{ min: 0, max: 100, now: window.usedPercent }}
                          style={styles.track}
                        >
                          <View
                            style={{
                              width: `${window.usedPercent}%`,
                              height: 5,
                              backgroundColor: color,
                            }}
                          />
                        </View>
                        <Text style={styles.detail}>{resetLabel(window, now)}</Text>
                      </View>
                    ))}
                    {account.message && <Text style={styles.detail}>{account.message}</Text>}
                    <Text style={styles.detail}>
                      {account.fetchedAt
                        ? `Updated ${new Date(account.fetchedAt).toLocaleString()}`
                        : 'No successful update yet'}
                    </Text>
                  </View>
                );
              })}
              <Text style={styles.detail}>
                Read-only Pi credentials. Tokens are never refreshed here.
              </Text>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gauge: { width: 44, height: 44 },
  outdatedIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: colors.panel,
    borderRadius: 8,
  },
  badgeCopy: { gap: 2 },
  percent: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  badgeLabel: { color: colors.muted, fontSize: 11 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12 },
  action: { color: colors.accent, fontSize: 14 },
  button: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000080' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  content: { padding: 16, gap: 12 },
  account: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 },
  window: { gap: 6, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
});
