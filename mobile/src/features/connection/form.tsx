import { useEffect, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Input, Text, YStack } from 'tamagui';
import { BrandIcon } from '../../components/brand-icon';
import type { RelayConnection } from '../../lib/connection';
import { colors } from '../../theme/colors';

export function ConnectionForm({
  initialValue,
  connection,
}: {
  initialValue: string;
  connection: RelayConnection;
}) {
  const [value, setValue] = useState(initialValue);
  const { pending, error } = useSyncExternalStore(connection.subscribe, connection.getState);
  useEffect(() => () => connection.cancel(), [connection]);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <YStack flex={1} justifyContent="center" padding={24} gap={20}>
        <BrandIcon size={52} />
        <Text color={colors.accent} fontSize={18} fontWeight="700">
          LPI / MOBILE
        </Text>
        <Text color={colors.text} fontSize={30} fontWeight="700">
          Your sessions, anywhere on your network.
        </Text>
        <Text color={colors.muted}>Connect to your existing relay over LAN or Tailscale.</Text>
        <Input
          accessibilityLabel="lpi server URL"
          value={value}
          onChangeText={(text) => {
            if (!connection.getState().pending) {
              setValue(text);
            }
          }}
          placeholder="http://192.168.1.20:3141"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void connection.connect(value)}
          disabled={pending}
          color={colors.text}
          backgroundColor={colors.panel}
          borderColor={colors.border}
          height={52}
        />
        {error && (
          <Text accessibilityRole="alert" color={colors.error}>
            {error}
          </Text>
        )}
        <Button
          height={48}
          disabled={pending || !value.trim()}
          onPress={() => void connection.connect(value)}
          accessibilityState={{ busy: pending, disabled: pending || !value.trim() }}
        >
          {pending ? 'Checking relay…' : 'Connect'}
        </Button>
        <Text color={colors.muted} fontSize={13}>
          lpi trusts everyone who can reach it. Keep the relay private. HTTP support depends on
          native transport policy; HTTPS is preferred.
        </Text>
      </YStack>
    </KeyboardAvoidingView>
  );
}
