import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { Card, EmptyState, Screen } from '../../src/components/ui';
import { useAuth, canAdmin } from '../../src/store/auth';

/**
 * Sales Reports (design §7) — the dashboards are populated by FEAT-006. This
 * placeholder keeps the screen + guard in place so the route exists and is
 * gated by canAdmin('pos_reports') like the other POS screens.
 */
export default function AdminPosReports() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const allowed = canAdmin(user, 'pos_reports');

  useEffect(() => {
    if (ready && !allowed) router.replace({ pathname: '/login', params: { next: '/admin/pos-reports' } } as never);
  }, [ready, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <Screen header={<StoreHeader back title="Sales Reports" />}><Card><Text> </Text></Card></Screen>;

  return (
    <Screen header={<StoreHeader back title="📈 Sales Reports" />}>
      <EmptyState icon="📈" title="Sales Reports — coming soon" text="Daily, weekly and monthly sales, payment-method summaries, best-sellers and low-stock reports will appear here." />
    </Screen>
  );
}
