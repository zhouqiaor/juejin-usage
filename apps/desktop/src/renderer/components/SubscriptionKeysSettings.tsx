// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionKeysSettings.tsx — Quota credentials settings panel
import { useEffect, useState } from 'react';
import { Button, Input, Label, TextField } from '@heroui/react';
import { StatusBanner } from '@/components/StatusBanner';

interface KeyStatus {
  plan: 'minimax' | 'ark';
  source: 'env' | 'stored' | 'none';
  masked: string | null;
  region?: string | null;
}

interface SaveResult {
  success: boolean;
  message: string;
  data?: KeyStatus[];
}

function SourceBadge({ source, masked }: { source: string; masked: string | null }) {
  const label =
    source === 'env' ? 'ENV' : source === 'stored' ? `SAVED ${masked ?? ''}` : 'UNCONFIGURED';
  const cls =
    source === 'env'
      ? 'bg-blue-100 text-blue-800'
      : source === 'stored'
        ? 'bg-green-100 text-green-800'
        : 'bg-gray-100 text-gray-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}

export function SubscriptionKeysSettings() {
  const [minimaxKey, setMinimaxKey] = useState('');
  const [arkAk, setArkAk] = useState('');
  const [arkSk, setArkSk] = useState('');
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingPlan, setClearingPlan] = useState<string | null>(null);

  useEffect(() => {
    window.tud.getSubscriptionKeysStatus().then((r) => {
      if (r.success && r.data) setStatuses(r.data);
    });
  }, []);

  const onSave = () => {
    setSaving(true);
    setError(null);
    const keys: Parameters<typeof window.tud.saveSubscriptionKeys>[0] = {};
    const mmKey = minimaxKey.trim();
    if (mmKey) keys.minimax = { apiKey: mmKey, region: 'auto' };
    const ak = arkAk.trim();
    const sk = arkSk.trim();
    if (ak && sk) keys.ark = { accessKeyId: ak, secretAccessKey: sk, region: 'cn-beijing' };
    window.tud
      .saveSubscriptionKeys(keys)
      .then((r: SaveResult) => {
        setSaving(false);
        if (r.success) {
          if (r.data) setStatuses(r.data);
          setMinimaxKey('');
          setArkAk('');
          setArkSk('');
        } else {
          setError(r.message);
        }
      })
      .catch((e: unknown) => {
        setSaving(false);
        setError(e instanceof Error ? e.message : 'Save failed');
      });
  };

  const onClear = (plan: 'minimax' | 'ark') => {
    setClearingPlan(plan);
    setError(null);
    window.tud
      .clearSubscriptionKeys(plan)
      .then((r: SaveResult) => {
        setClearingPlan(null);
        if (r.success && r.data) setStatuses(r.data);
        else setError(r.message);
      })
      .catch((e: unknown) => {
        setClearingPlan(null);
        setError(e instanceof Error ? e.message : 'Clear failed');
      });
  };

  const mmStatus = statuses.find((s) => s.plan === 'minimax');
  const arkStatus = statuses.find((s) => s.plan === 'ark');
  const mmIsEnv = mmStatus?.source === 'env';
  const arkIsEnv = arkStatus?.source === 'env';

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {error && <StatusBanner tone="error" title={error} />}
      <p className="text-sm text-muted">
        Configure MiniMax Code and Volcengine Ark credentials. Keys are encrypted and stored locally, never sent to any server.
      </p>

      <div className="rounded-medium border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">MiniMax Code</span>
          <SourceBadge source={mmStatus?.source ?? 'none'} masked={mmStatus?.masked ?? null} />
        </div>
        {mmIsEnv && (
          <p className="mb-2 text-xs text-muted">EnvVar priority. Clear env to edit.</p>
        )}
        <TextField fullWidth isDisabled={mmIsEnv} name="minimax-key" type="password">
          <Label>API Key</Label>
          <Input
            autoComplete="off"
            placeholder={
              mmIsEnv ? 'EnvVar' : mmStatus?.masked ? `SAVED ${mmStatus.masked}` : 'sk-cp-xxx'
            }
            type="password"
            value={minimaxKey}
            onChange={(e) => setMinimaxKey(e.target.value)}
          />
        </TextField>
        <div className="mt-2 flex gap-2">
          <Button isDisabled={saving} size="sm" variant="primary" onPress={onSave}>
            Save
          </Button>
          {!mmIsEnv && mmStatus?.source === 'stored' && (
            <Button
              isDisabled={clearingPlan === 'minimax'}
              size="sm"
              variant="danger"
              onPress={() => onClear('minimax')}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-medium border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Volcengine Ark</span>
          <SourceBadge source={arkStatus?.source ?? 'none'} masked={arkStatus?.masked ?? null} />
        </div>
        {arkIsEnv && (
          <p className="mb-2 text-xs text-muted">EnvVar priority. Clear env to edit.</p>
        )}
        <TextField fullWidth isDisabled={arkIsEnv} name="ark-ak">
          <Label>Access Key ID</Label>
          <Input
            autoComplete="off"
            placeholder={
              arkIsEnv ? 'EnvVar' : arkStatus?.masked ? `SAVED ${arkStatus.masked}` : 'AKLT...'
            }
            value={arkAk}
            onChange={(e) => setArkAk(e.target.value)}
          />
        </TextField>
        <TextField className="mt-2" fullWidth isDisabled={arkIsEnv} name="ark-sk" type="password">
          <Label>Secret Access Key</Label>
          <Input
            autoComplete="off"
            placeholder="SAVED"
            type="password"
            value={arkSk}
            onChange={(e) => setArkSk(e.target.value)}
          />
        </TextField>
        <div className="mt-2 flex gap-2">
          <Button isDisabled={saving} size="sm" variant="primary" onPress={onSave}>
            Save
          </Button>
          {!arkIsEnv && arkStatus?.source === 'stored' && (
            <Button
              isDisabled={clearingPlan === 'ark'}
              size="sm"
              variant="danger"
              onPress={() => onClear('ark')}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}