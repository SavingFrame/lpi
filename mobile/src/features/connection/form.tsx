import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Button, Input, Text, XStack, YStack } from 'tamagui';
import { MAX_RELAY_PROFILES, type RelayProfileInput } from '../../../../src/shared/desktop';
import { BrandIcon } from '../../components/brand-icon';
import { checkServer } from '../../lib/native';
import { relayOrigin } from '../../lib/server';
import type { MobileDevice } from '../../lib/workspace';
import { colors } from '../../theme/colors';

export function ConnectionForm({
  devices,
  save,
  onSaved,
}: {
  devices: MobileDevice[];
  save: (profiles: RelayProfileInput[]) => Promise<void>;
  onSaved: () => void;
}) {
  const [profiles, setProfiles] = useState(() =>
    devices.map(({ name, origin }) => ({ name, origin })),
  );
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [test, setTest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  async function check() {
    if (attempt.current) {
      return;
    }
    const controller = new AbortController();
    attempt.current = controller;
    setChecking(true);
    setTest(null);
    try {
      await checkServer(relayOrigin(address), controller.signal);
      if (!controller.signal.aborted) {
        setTest('Relay is reachable.');
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setTest(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      attempt.current = null;
      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  }
  async function submit() {
    if (saving.current) {
      return;
    }
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      let next = profiles;
      if (address.trim()) {
        const origin = relayOrigin(address);
        next = [
          ...profiles,
          { origin, name: name.trim() || new URL(origin).hostname.slice(0, 60) },
        ];
      }
      await save(next);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <YStack padding={24} gap={16}>
          <BrandIcon size={44} />
          <Text color={colors.text} fontSize={26} fontWeight="700">
            Relay connections
          </Text>
          {profiles.map((profile) => (
            <YStack key={profile.origin} gap={6}>
              <Input
                accessibilityLabel={`Name for ${profile.origin}`}
                value={profile.name}
                maxLength={60}
                disabled={pending}
                onChangeText={(name) =>
                  setProfiles((current) =>
                    current.map((item) =>
                      item.origin === profile.origin ? { ...item, name } : item,
                    ),
                  )
                }
              />
              <Text color={colors.muted}>{profile.origin}</Text>
              <XStack justifyContent="space-between" alignItems="center">
                <Text color={colors.muted}>
                  {devices.find(({ origin }) => origin === profile.origin)?.status ?? 'Not saved'}
                </Text>
                <Button
                  disabled={pending}
                  accessibilityLabel={`Remove ${profile.name}`}
                  onPress={() =>
                    setProfiles((current) =>
                      current.filter((item) => item.origin !== profile.origin),
                    )
                  }
                >
                  Remove
                </Button>
              </XStack>
            </YStack>
          ))}
          {profiles.length < MAX_RELAY_PROFILES && (
            <YStack gap={8}>
              <Text color={colors.text} fontWeight="700">
                Add a relay
              </Text>
              <Input
                accessibilityLabel="New relay name"
                placeholder="Device name"
                value={name}
                maxLength={60}
                disabled={pending}
                onChangeText={setName}
              />
              <Input
                accessibilityLabel="lpi server URL"
                value={address}
                onChangeText={(value) => {
                  setAddress(value);
                  setTest(null);
                }}
                placeholder="http://192.168.1.20:3141"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={512}
                disabled={pending || checking}
              />
              <Button
                disabled={pending || checking || !address.trim()}
                onPress={() => void check()}
              >
                {checking ? 'Checking relay…' : 'Test connection'}
              </Button>
              {test && (
                <Text color={colors.muted} accessibilityLiveRegion="polite">
                  {test}
                </Text>
              )}
            </YStack>
          )}
          {error && (
            <Text accessibilityRole="alert" color={colors.error}>
              {error}
            </Text>
          )}
          <Button
            disabled={pending || (devices.length === 0 && !address.trim())}
            onPress={() => void submit()}
          >
            {pending ? 'Saving…' : 'Save relays'}
          </Button>
          <Text color={colors.muted} fontSize={13}>
            Offline relays can be saved. lpi has no application authentication. Keep relays on a
            trusted network. HTTP support depends on device policy.
          </Text>
        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
