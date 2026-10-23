import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Input, Text, YStack } from 'tamagui';
import { BrandIcon } from '../../components/brand-icon';
import { colors } from '../../theme/colors';

export function ConnectionForm({
  initialValue,
  onConnect,
}: {
  initialValue: string;
  onConnect: (server: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConnect(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
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
          onChangeText={setValue}
          placeholder="http://192.168.1.20:3141"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
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
        <Button height={48} disabled={pending || !value.trim()} onPress={() => void connect()}>
          {pending ? 'Saving server…' : 'Connect'}
        </Button>
        <Text color={colors.muted} fontSize={13}>
          lpi trusts everyone who can reach it. Keep the relay private. HTTP support depends on
          native transport policy; HTTPS is preferred.
        </Text>
      </YStack>
    </KeyboardAvoidingView>
  );
}
