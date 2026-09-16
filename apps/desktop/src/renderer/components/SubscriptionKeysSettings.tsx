// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionKeysSettings.tsx — Quota credentials settings panel
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Label, Select, SelectItem, Tabs, TextField } from '@heroui/react';
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
  const [minimaxRegion, setMinimaxRegion] = useState('auto');
  const [arkAk, setArkAk] = useState('');
  const [arkSk, setArkSk] = useState('');
  const [arkRegion, setArkRegion] = useState('cn-beijing');
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingPlan, setClearingPlan] = useState<string | null>(null);

  useEffect(() => {
    window.tud.getSubscriptionKeysStatus().then((r) => {
      if (r.success && r.data) {
        setStatuses(r.data);
        const mm = r.data.find((s: KeyStatus) => s.plan === 'minimax');
        const ak = r.data.find((s: KeyStatus) => s.plan === 'ark');
        if (mm) setMinimaxRegion(mm.region ?? 'auto');
        if (ak) setArkRegion(ak.region ?? 'cn-beijing');
      }
    });
  }, []);

  const onSave = () => {
    setSaving(true);
    setError(null);
    const keys: Parameters<typeof window.tud.saveSubscriptionKeys>[0] = {};
    const mmKey = minimaxKey.trim();
    if (mmKey)
      keys.minimax = {
        apiKey: mmKey,
        region: minimaxRegion as 'auto' | 'global' | 'mainland',
      };
    const ak = arkAk.trim();
    const sk = arkSk.trim();
    if (ak && sk) keys.ark = { accessKeyId: ak, secretAccessKey: sk, region: arkRegion };
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

      {/* MiniMax */}
      <div className="rounded-medium border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">MiniMax Code</span>
          <SourceBadge source={mmStatus?.source ?? 'none'} masked={mmStatus?.masked ?? null} />
        </div>
        {mmIsEnv && (
          <Alert
            className="mb-2"
            description="Using environment variable. Clear env to enable editing."
            title="EnvVar"
            variant="flat"
          />
        )}
        <TextField
          fullWidth
          isDisabled={mmIsEnv}
          label="API Key"
          type="password"
          value={minimaxKey}
          onValueChange={setMinimaxKey}
        >
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
        <div className="mt-2">
          <Select
            isDisabled={mmIsEnv}
            label="Region"
            selectedKeys={new Set([minimaxRegion])}
            onSelectionChange={(keys) => setMinimaxRegion(Array.from(keys)[0])}
          >
            <SelectItem key="auto">Auto detect</SelectItem>
            <SelectItem key="global">Global (api.minimax.io)</SelectItem>
            <SelectItem key="mainland">Mainland (api.minimaxi.com)</SelectItem>
          </Select>
        </div>
        <div className="mt-2 flex gap-2">
          <Button color="primary" isLoading={saving} size="sm" onPress={onSave}>
            Save
          </Button>
          {!mmIsEnv && mmStatus?.source === 'stored' && (
            <Button
              color="danger"
              isLoading={clearingPlan === 'minimax'}
              size="sm"
              variant="flat"
              onPress={() => onClear('minimax')}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Ark */}
      <div className="rounded-medium border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Volcengine Ark</span>
          <SourceBadge source={arkStatus?.source ?? 'none'} masked={arkStatus?.masked ?? null} />
        </div>
        {arkIsEnv && (
          <Alert
            className="mb-2"
            description="Using environment variable. Clear env to enable editing."
            title="EnvVar"
            variant="flat"
          />
        )}
        <TextField
          fullWidth
          isDisabled={arkIsEnv}
          label="Access Key ID"
          value={arkAk}
          onValueChange={setArkAk}
        >
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
        <TextField
          className="mt-2"
          fullWidth
          isDisabled={arkIsEnv}
          label="Secret Access Key"
          type="password"
          value={arkSk}
          onValueChange={setArkSk}
        >
          <Label>Secret Access Key</Label>
          <Input
            autoComplete="off"
            placeholder="SAVED"
            type="password"
            value={arkSk}
            onChange={(e) => setArkSk(e.target.value)}
          />
        </TextField>
        <div className="mt-2">
          <Select
            isDisabled={arkIsEnv}
            label="Region"
            selectedKeys={new Set([arkRegion])}
            onSelectionChange={(keys) => setArkRegion(Array.from(keys)[0])}
          >
            <SelectItem key="cn-beijing">cn-beijing</SelectItem>
            <SelectItem key="cn-shanghai">cn-shanghai</SelectItem>
          </Select>
        </div>
        <div className="mt-2 flex gap-2">
          <Button color="primary" isLoading={saving} size="sm" onPress={onSave}>
            Save
          </Button>
          {!arkIsEnv && arkStatus?.source === 'stored' && (
            <Button
              color="danger"
              isLoading={clearingPlan === 'ark'}
              size="sm"
              variant="flat"
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
