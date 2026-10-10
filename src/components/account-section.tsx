// Shop tab section for the cloud: the owner signs in with a code sent to
// their email (their products are backed up and other phones can join), staff
// join with the shop's 6-digit code, and the owner decides what each staff
// member may see and do.

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { confirmAction, notify } from '@/components/notify';
import { Button, Card, Chip, Field, SectionTitle } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import {
  getSyncState,
  joinAsStaff,
  listTeam,
  removeMember,
  sendOwnerCode,
  setPermissions,
  signOut,
  subscribeSyncState,
  syncNow,
  verifyOwnerCode,
  type SyncState,
  type TeamMember,
} from '@/data/cloud';
import { useAccount } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function useSyncState() {
  const [state, setState] = useState<SyncState>(getSyncState());
  useEffect(() => subscribeSyncState(setState), []);
  return state;
}

function syncText(s: SyncState): string {
  if (s.status === 'syncing') return 'Syncing…';
  if (s.status === 'removed') return 'The owner removed you from this shop.';
  const last = s.lastSynced
    ? `Last synced at ${s.lastSynced.getHours()}:${String(s.lastSynced.getMinutes()).padStart(2, '0')}.`
    : 'Not synced yet.';
  return s.status === 'offline' ? `No internet. Changes are kept on this phone. ${last}` : last;
}

export function AccountSection() {
  const theme = useTheme();
  const db = useSQLiteContext();
  const { account } = useAccount();
  const sync = useSyncState();
  const [mode, setMode] = useState<'owner' | 'staff'>('owner');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);

  const isOwner = account.membership?.role === 'owner';
  const loadTeam = useCallback(async () => {
    if (!isOwner) return;
    try {
      setTeam(await listTeam(db));
    } catch {
      // Offline: the list stays as it was.
    }
  }, [db, isOwner]);
  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      notify('Could not finish', message(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter your email address');
      await sendOwnerCode(email);
      setCodeSent(true);
    });

  const verify = () =>
    run(async () => {
      const { restored } = await verifyOwnerCode(db, email, code, name);
      setCode('');
      setCodeSent(false);
      notify(restored ? 'Your shop is back on this phone' : 'Your shop is now backed up');
    });

  const join = () =>
    run(async () => {
      if (!/^\d{6}$/.test(code.trim())) throw new Error('The shop code has 6 digits');
      if (!name.trim()) throw new Error('Enter your name');
      await joinAsStaff(db, code, name);
      setCode('');
    });

  const leave = () =>
    confirmAction(
      'Sign out?',
      isOwner
        ? 'Your products stay on this phone and in the cloud.'
        : "The shop's products and sales will be removed from this phone.",
      'Sign out',
      () => run(() => signOut(db)),
    );

  const toggle = (m: TeamMember, key: 'can_see_cost' | 'can_delete') =>
    run(async () => {
      await setPermissions(db, m.user_id, { [key]: !m[key] });
      await loadTeam();
    });

  const remove = (m: TeamMember) =>
    confirmAction(`Remove ${m.name || 'this person'}?`, 'They will no longer see the shop.', 'Remove', () =>
      run(async () => {
        await removeMember(db, m.user_id);
        await loadTeam();
      }),
    );

  const muted = [Type.body, { color: theme.textSecondary }];

  if (account.store && account.membership) {
    const m = account.membership;
    const staff = team.filter((t) => t.role === 'staff');
    return (
      <View style={styles.section}>
        <SectionTitle>Cloud backup and staff</SectionTitle>
        <Card>
          <Text style={[Type.bodyStrong, { color: theme.text }]}>
            Signed in as {m.name || (isOwner ? 'owner' : 'staff')} ({isOwner ? 'owner' : 'staff'})
          </Text>
          <Text style={muted}>{syncText(sync)}</Text>
          {isOwner ? (
            <View style={[styles.codeBox, { backgroundColor: theme.accentSoft }]}>
              <Text style={[Type.caption, { color: theme.accent }]}>Staff join with this shop code</Text>
              <Text style={[styles.code, { color: theme.accent }]}>{account.store.code}</Text>
            </View>
          ) : null}
          <View style={styles.buttons}>
            <Button style={styles.flex} title="Sync now" kind="secondary" disabled={busy} onPress={() => syncNow(db).then(loadTeam)} />
            <Button style={styles.flex} title="Sign out" kind="secondary" disabled={busy} onPress={leave} />
          </View>
        </Card>

        {isOwner ? (
          <>
            <SectionTitle>Team</SectionTitle>
            {staff.length === 0 ? (
              <Card>
                <Text style={muted}>No staff yet. Share the shop code above with them.</Text>
              </Card>
            ) : null}
            {staff.map((t) => (
              <Card key={t.user_id}>
                <Text style={[Type.bodyStrong, { color: theme.text }]}>{t.name || 'Staff'}</Text>
                <View style={styles.chips}>
                  <Chip label="Sees cost price" selected={t.can_see_cost} onPress={() => toggle(t, 'can_see_cost')} />
                  <Chip label="Can delete products" selected={t.can_delete} onPress={() => toggle(t, 'can_delete')} />
                </View>
                <Button title="Remove" kind="danger" disabled={busy} onPress={() => remove(t)} />
              </Card>
            ))}
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionTitle>Cloud backup and staff</SectionTitle>
      <Card>
        <Text style={muted}>
          Sign in to back up your products and sales, and to let staff use the app on their own phones.
        </Text>
        <View style={styles.chips}>
          <Chip label="I am the owner" selected={mode === 'owner'} onPress={() => setMode('owner')} />
          <Chip label="I am staff" selected={mode === 'staff'} onPress={() => setMode('staff')} />
        </View>
        {mode === 'owner' ? (
          <>
            <View style={styles.row}>
              <Field label="Your name" value={name} onChangeText={setName} placeholder="Ramesh" />
            </View>
            <View style={styles.row}>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="ramesh@gmail.com"
              />
            </View>
            {codeSent ? (
              <>
                <View style={styles.row}>
                  <Field label="Code from the email" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" />
                </View>
                <Button title="Sign in" disabled={busy} onPress={verify} />
                <Button title="Send the code again" kind="ghost" disabled={busy} onPress={sendCode} />
              </>
            ) : (
              <Button title="Email me a sign-in code" icon={{ ios: 'envelope.fill', md: 'mail' }} disabled={busy} onPress={sendCode} />
            )}
          </>
        ) : (
          <>
            <View style={styles.row}>
              <Field label="Your name" value={name} onChangeText={setName} placeholder="Suresh" />
            </View>
            <View style={styles.row}>
              <Field label="Shop code (ask the owner)" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" />
            </View>
            <Text style={[Type.caption, { color: theme.textSecondary }]}>
              Joining replaces anything on this phone with the shop's products.
            </Text>
            <Button title="Join the shop" disabled={busy} onPress={join} />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: Spacing.three },
  row: { flexDirection: 'row' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  codeBox: { padding: Spacing.three, borderRadius: Radius.md, gap: Spacing.one },
  code: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: 6 },
});
