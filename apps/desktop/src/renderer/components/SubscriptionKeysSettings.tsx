// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionKeysSettings.tsx — 余量凭证设置面板
import { useEffect, useState } from 'react';
import { Button, Card, Chip, Description, Input, Label, Switch, TextField } from '@heroui/react';
import { StatusBanner } from '@/components/StatusBanner';
import { validateArkAccessKeyIdForSave } from '../../shared/ark-credentials';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';
import { useSubscriptionPrefs } from '../lib/useSubscriptionPrefs';

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

/** 火山引擎 IAM 访问密钥控制台（官方 URL）。 */
const ARK_IAM_CONSOLE_URL = 'https://console.volcengine.com/iam/keymanage/';

function SourceChip({ source, masked }: { source: string; masked: string | null }) {
  if (source === 'env') {
    return (
      <Chip color="accent" size="sm" variant="soft">
        <Chip.Label>{`环境变量${masked ? ` ${masked}` : ''}`}</Chip.Label>
      </Chip>
    );
  }
  if (source === 'stored') {
    return (
      <Chip color="success" size="sm" variant="soft">
        <Chip.Label>{`已保存${masked ? ` ${masked}` : ''}`}</Chip.Label>
      </Chip>
    );
  }
  return (
    <Chip size="sm" variant="soft">
      <Chip.Label>未配置</Chip.Label>
    </Chip>
  );
}

interface ArkProbeState {
  state: 'idle' | 'checking' | 'ok' | 'fail';
  message: string;
}

/** 标题栏右侧的启用开关（与 ProjectUsagePanel 同一 Switch 写法）。 */
function EnableSwitch({
  isSelected,
  onChange,
  label,
}: {
  isSelected: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Switch
      className="shrink-0"
      isSelected={isSelected}
      size="sm"
      onChange={onChange}
    >
      <Switch.Content className="gap-1.5 text-xs font-normal text-muted">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}

export function SubscriptionKeysSettings() {
  const subscriptionPrefs = useSubscriptionPrefs();
  const [minimaxKey, setMinimaxKey] = useState('');
  const [arkAk, setArkAk] = useState('');
  const [arkSk, setArkSk] = useState('');
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [savingPlan, setSavingPlan] = useState<'minimax' | 'ark' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arkFieldError, setArkFieldError] = useState<string | null>(null);
  const [clearingPlan, setClearingPlan] = useState<string | null>(null);
  const [arkProbe, setArkProbe] = useState<ArkProbeState>({ state: 'idle', message: '' });
  /** Cursor 无密钥输入：开启后只读探测一次本机登录态，用于「已开启但没登录」内联提示。 */
  const [cursorSignIn, setCursorSignIn] = useState<'unknown' | 'present' | 'missing'>('unknown');

  const onTogglePref = (key: 'cursor' | 'minimax' | 'ark', enabled: boolean) => {
    // 旧 preload 中间态缺该 IPC 时静默失败（main 重启后即一致）。
    window.tud.setSubscriptionPrefs?.({ [key]: enabled }).catch(() => {});
  };

  useEffect(() => {
    window.tud.getSubscriptionKeysStatus().then((r) => {
      if (r.success && r.data) setStatuses(r.data);
    });
  }, []);

  // Cursor 开关开启时探测本机登录态（只读本地 state.vscdb；有登录态时 main 顺带完成一次配额拉取）。
  useEffect(() => {
    if (!subscriptionPrefs.cursor) {
      setCursorSignIn('unknown');
      return;
    }
    let cancelled = false;
    void window.tud.getCursorSubscription()
      .then((snapshot) => {
        if (cancelled) return;
        setCursorSignIn(
          snapshot.status === 'not-installed' || snapshot.status === 'not-signed-in'
            ? 'missing'
            : 'present',
        );
      })
      .catch(() => {
        if (!cancelled) setCursorSignIn('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [subscriptionPrefs.cursor]);

  /** 凭据保存/清除后通知同窗口订阅卡强刷；pet.html 由 main 的 prefs 广播驱动重轮询。 */
  const dispatchSubscriptionRefresh = () => {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_EVENT));
  };

  const probeArkCredentials = async () => {
    setArkProbe({ state: 'checking', message: '' });
    try {
      const snapshot = await window.tud.getArkSubscription({ forceRefresh: true });
      if (snapshot.status === 'ready') {
        setArkProbe({ state: 'ok', message: '验证通过：密钥可正常查询余量，返回用量页即可查看订阅卡片。' });
      } else {
        setArkProbe({
          state: 'fail',
          message:
            snapshot.message ??
            (snapshot.status === 'not-configured'
              ? '未检测到凭证，请先保存。'
              : '验证失败，请确认密钥正确且具备套餐余量查询权限。'),
        });
      }
    } catch (e) {
      setArkProbe({
        state: 'fail',
        message: e instanceof Error ? e.message : '验证失败，请稍后重试。',
      });
    }
  };

  const onSaveMiniMax = () => {
    setSavingPlan('minimax');
    setError(null);
    const mmKey = minimaxKey.trim();
    if (!mmKey) {
      setSavingPlan(null);
      return;
    }
    window.tud
      .saveSubscriptionKeys({ minimax: { apiKey: mmKey, region: 'auto' } })
      .then((r: SaveResult) => {
        setSavingPlan(null);
        if (r.success) {
          if (r.data) setStatuses(r.data);
          setMinimaxKey('');
          dispatchSubscriptionRefresh();
        } else {
          setError(r.message);
        }
      })
      .catch((e: unknown) => {
        setSavingPlan(null);
        setError(e instanceof Error ? e.message : '保存失败');
      });
  };

  const onSaveArk = () => {
    setSavingPlan('ark');
    setError(null);
    setArkFieldError(null);
    const ak = arkAk.trim();
    const sk = arkSk.trim();
    if (!ak && !sk) {
      setSavingPlan(null);
      return;
    }
    const akError = validateArkAccessKeyIdForSave(ak);
    if (akError) {
      setArkFieldError(akError);
      setSavingPlan(null);
      return;
    }
    if (!ak || !sk) {
      setArkFieldError('AccessKey ID 与 Secret AccessKey 需同时填写。');
      setSavingPlan(null);
      return;
    }
    window.tud
      .saveSubscriptionKeys({ ark: { accessKeyId: ak, secretAccessKey: sk, region: 'cn-beijing' } })
      .then((r: SaveResult) => {
        setSavingPlan(null);
        if (r.success) {
          if (r.data) setStatuses(r.data);
          setArkAk('');
          setArkSk('');
          // 保存后做一次只读探针，让鉴权失败在本面板可见（不改订阅卡片）
          void probeArkCredentials();
          dispatchSubscriptionRefresh();
        } else {
          // 主进程侧 AKLT 校验失败等
          setArkFieldError(r.message);
        }
      })
      .catch((e: unknown) => {
        setSavingPlan(null);
        setError(e instanceof Error ? e.message : '保存失败');
      });
  };

  const onClear = (plan: 'minimax' | 'ark') => {
    setClearingPlan(plan);
    setError(null);
    window.tud
      .clearSubscriptionKeys(plan)
      .then((r: SaveResult) => {
        setClearingPlan(null);
        if (r.success && r.data) {
          setStatuses(r.data);
          dispatchSubscriptionRefresh();
        } else setError(r.message);
      })
      .catch((e: unknown) => {
        setClearingPlan(null);
        setError(e instanceof Error ? e.message : '清除失败');
      });
  };

  const mmStatus = statuses.find((s) => s.plan === 'minimax');
  const arkStatus = statuses.find((s) => s.plan === 'ark');
  const mmIsEnv = mmStatus?.source === 'env';
  const arkIsEnv = arkStatus?.source === 'env';

  const openArkConsole = () => {
    void window.tud.openExternal(ARK_IAM_CONSOLE_URL);
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <StatusBanner tone="error" title={error} />}
      <p className="text-sm text-muted">
        Cursor / MiniMax Code / 火山引擎三家套餐余量默认不采集，请用各家卡片上的开关手动启用；关闭后完全不拉取（仪表板卡片、宠物气泡与告警均不出现该家）。密钥仅加密存储在本机（系统安全存储），仅用于向各服务官方接口查询余量。
      </p>

      <Card className="rounded-xl shadow-none" variant="tertiary">
        <Card.Header>
          <div className="flex w-full items-center justify-between gap-4">
            <Card.Title>Cursor</Card.Title>
            <EnableSwitch
              isSelected={subscriptionPrefs.cursor}
              label={subscriptionPrefs.cursor ? '已启用' : '启用'}
              onChange={(checked) => onTogglePref('cursor', checked)}
            />
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            读取本机已登录的 Cursor 客户端配额，无需填写密钥。
          </p>
          {subscriptionPrefs.cursor && cursorSignIn === 'missing' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              已开启，但未检测到本机 Cursor 登录态；请先登录 Cursor 客户端，仪表板卡片随后自动出现。
            </p>
          )}
          {subscriptionPrefs.cursor && cursorSignIn === 'present' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              已开启：正在读取本机已登录的 Cursor 客户端。
            </p>
          )}
        </Card.Content>
      </Card>

      <Card className="rounded-xl shadow-none" variant="tertiary">
        <Card.Content className="flex flex-col gap-1.5 text-xs text-muted">
          <p className="text-sm font-medium text-foreground">火山引擎凭证获取指引</p>
          <p>
            余量查询使用火山引擎
            <strong className="text-foreground">访问控制（IAM）访问密钥</strong>
            ，不是推理 API Key（ark- 开头的密钥不可用）。请在火山引擎控制台「访问控制 → 访问密钥」创建
            AKLT 开头的 AccessKey ID / Secret AccessKey，并确保该密钥可查询套餐余量。
          </p>
          <p>
            <a
              className="text-accent underline"
              href={ARK_IAM_CONSOLE_URL}
              rel="noreferrer"
              target="_blank"
              onClick={(e) => {
                e.preventDefault();
                openArkConsole();
              }}
            >
              打开火山引擎控制台「访问控制 → 访问密钥」
            </a>
          </p>
        </Card.Content>
      </Card>

      <Card className="rounded-xl shadow-none" variant="tertiary">
        <Card.Header>
          <div className="flex w-full items-center justify-between gap-4">
            <Card.Title>MiniMax Code</Card.Title>
            <div className="flex items-center gap-3">
              <SourceChip source={mmStatus?.source ?? 'none'} masked={mmStatus?.masked ?? null} />
              <EnableSwitch
                isSelected={subscriptionPrefs.minimax}
                label={subscriptionPrefs.minimax ? '已启用' : '启用'}
                onChange={(checked) => onTogglePref('minimax', checked)}
              />
            </div>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {subscriptionPrefs.minimax && (mmStatus?.source ?? 'none') === 'none' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              已开启，请填写并保存凭据（也可通过环境变量或本机 MiniMax Code 登录态提供）。
            </p>
          )}
          {mmIsEnv && (
            <p className="text-xs text-muted">
              当前由环境变量提供（优先级更高）。清除环境变量 MINIMAX_API_KEY / MINIMAX_CODING_KEY
              后才可在界面修改。
            </p>
          )}
          <TextField fullWidth isDisabled={mmIsEnv} name="minimax-key" type="password">
            <Label>API Key</Label>
            <Input
              autoComplete="off"
              placeholder={
                mmIsEnv ? '环境变量已提供' : mmStatus?.masked ? `已保存 ${mmStatus.masked}，输入新值覆盖` : 'sk-cp-xxx'
              }
              type="password"
              value={minimaxKey}
              onChange={(e) => setMinimaxKey(e.target.value)}
            />
            <Description>
              密钥仅加密存储在本机（系统安全存储），仅用于查询 MiniMax Code 套餐余量。
            </Description>
          </TextField>
          <div className="flex gap-2">
            <Button
              isDisabled={savingPlan !== null || mmIsEnv || !minimaxKey.trim()}
              size="sm"
              variant="primary"
              onPress={onSaveMiniMax}
            >
              保存
            </Button>
            {!mmIsEnv && mmStatus?.source === 'stored' && (
              <Button
                isDisabled={clearingPlan === 'minimax'}
                size="sm"
                variant="danger"
                onPress={() => onClear('minimax')}
              >
                清除
              </Button>
            )}
          </div>
        </Card.Content>
      </Card>

      <Card className="rounded-xl shadow-none" variant="tertiary">
        <Card.Header>
          <div className="flex w-full items-center justify-between gap-4">
            <Card.Title>火山引擎 Ark 余量</Card.Title>
            <div className="flex items-center gap-3">
              <SourceChip source={arkStatus?.source ?? 'none'} masked={arkStatus?.masked ?? null} />
              <EnableSwitch
                isSelected={subscriptionPrefs.ark}
                label={subscriptionPrefs.ark ? '已启用' : '启用'}
                onChange={(checked) => onTogglePref('ark', checked)}
              />
            </div>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {subscriptionPrefs.ark && (arkStatus?.source ?? 'none') === 'none' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              已开启，请填写并保存凭据（也可通过 VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY 环境变量提供）。
            </p>
          )}
          {arkIsEnv && (
            <p className="text-xs text-muted">
              当前由环境变量提供（优先级更高）。清除环境变量 VOLC_ACCESS_KEY_ID /
              VOLC_SECRET_ACCESS_KEY 后才可在界面修改。
            </p>
          )}
          <TextField fullWidth isDisabled={arkIsEnv} isInvalid={Boolean(arkFieldError)} name="ark-ak">
            <Label>AccessKey ID</Label>
            <Input
              autoComplete="off"
              placeholder={
                arkIsEnv ? '环境变量已提供' : arkStatus?.masked ? `已保存 ${arkStatus.masked}，输入新值覆盖` : 'AKLT...'
              }
              value={arkAk}
              onChange={(e) => {
                setArkAk(e.target.value);
                if (arkFieldError) setArkFieldError(null);
              }}
            />
          </TextField>
          <TextField className="mt-1" fullWidth isDisabled={arkIsEnv} name="ark-sk" type="password">
            <Label>Secret AccessKey</Label>
            <Input
              autoComplete="off"
              placeholder={arkIsEnv ? '环境变量已提供' : arkStatus?.source === 'stored' ? '已保存，输入新值覆盖' : 'Secret AccessKey'}
              type="password"
              value={arkSk}
              onChange={(e) => setArkSk(e.target.value)}
            />
          </TextField>
          {arkFieldError && <p className="text-xs text-red-600 dark:text-red-400">{arkFieldError}</p>}
          {arkProbe.state === 'checking' && (
            <p className="text-xs text-muted">正在向火山引擎验证密钥…</p>
          )}
          {arkProbe.state === 'ok' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">{arkProbe.message}</p>
          )}
          {arkProbe.state === 'fail' && (
            <p className="text-xs text-red-600 dark:text-red-400">{`验证失败：${arkProbe.message}`}</p>
          )}
          <div className="flex gap-2">
            <Button
              isDisabled={savingPlan !== null || arkIsEnv || (!arkAk.trim() && !arkSk.trim())}
              size="sm"
              variant="primary"
              onPress={onSaveArk}
            >
              保存
            </Button>
            {!arkIsEnv && arkStatus?.source === 'stored' && (
              <>
                <Button
                  isDisabled={clearingPlan === 'ark' || arkProbe.state === 'checking'}
                  size="sm"
                  variant="secondary"
                  onPress={() => void probeArkCredentials()}
                >
                  验证连接
                </Button>
                <Button
                  isDisabled={clearingPlan === 'ark'}
                  size="sm"
                  variant="danger"
                  onPress={() => onClear('ark')}
                >
                  清除
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted">
            密钥仅加密存储在本机（系统安全存储），仅用于向火山引擎官方接口查询余量。地域默认
            cn-beijing；也可用环境变量 VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY /
            VOLC_REGION 配置。
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}
