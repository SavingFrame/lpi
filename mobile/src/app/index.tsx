import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { MobileApp } from '../mobile-app';

export default function Index() {
  const { session } = useLocalSearchParams<{ session?: string | string[] }>();
  const router = useRouter();
  const consumeSessionLink = useCallback(() => router.setParams({ session: undefined }), [router]);
  return <MobileApp sessionLink={session} onSessionLinkConsumed={consumeSessionLink} />;
}
