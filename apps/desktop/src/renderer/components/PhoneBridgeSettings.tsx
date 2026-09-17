import { useEffect, useState } from 'react';
import { Button, Checkbox } from '@heroui/react';

/**
 * D4 PC-bridge MVP 设置面板（「手机桥接」Tab）。
 *
 * - 开关：pcBridgeEnable 启动 0.0.0.0:8453 + 生成 128-bit token；关闭即停服。
 * - 展示：配对地址 / token / URL（可复制）+ QR PNG（供后续 PlanPulse 扫码；MVP 手机端手录）。
 * - 安全口径见 tools/quota-app-android/docs/DESIGN-2026-09-17-pcbridge-mvp.md：
 *   明文 HTTP / 无 TTL / 绑全部网卡均为已知 P1 风险，面板上明示，避免用户无感常开。
 */
interface BridgeState {
  enabled: boolean;
  ip: string;
  port: number;
  token: string | null;
  url: string | null;
}

interface PairingInfo {
  ip: string;
  port: number;
  token: string;
  url: string;
  qrDataUrl: string;
}

export function PhoneBridgeSettings() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => {
    void window.tud
      .pcBridgeStatus()
      .then((s) => {
        setState(s);
        if (!s.enabled) setInfo(null);
      })
      .catch(() => {
        // 主进程过旧/IPC 不可用时保持空白态
        setState({ enabled: false, ip: '', port: 8453, token: null, url: null });
      });
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        const i = await window.tud.pcBridgeEnable();
        setInfo(i);
        setState({ enabled: true, ip: i.ip, port: i.port, token: i.token, url: i.url });
      } else {
        const s = await window.tud.pcBridgeDisable();
        setState(s);
        setInfo(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  };

  const enabled = state?.enabled ?? false;
  const pairingUrl = info?.url ?? state?.url ?? null;
  const token = info?.token ?? state?.token ?? null;
  const qr = info?.qrDataUrl ?? null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">局域网手机桥接</div>
          <div className="mt-0.5 text-xs text-default-500">
            开启后，同一 Wi-Fi 下的 PlanPulse 可经 http://{state?.ip || 'IP'}:{state?.port || 8453}
            {' '}只读拉取本机今日 AI 工具用量（v1 契约，不含订阅额度）。
          </div>
        </div>
        <Checkbox
          aria-label="开启手机桥接"
          isSelected={enabled}
          isDisabled={busy}
          onChange={(checked) => void toggle(checked)}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </div>

      {error && <div className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger">{error}</div>}

      {enabled && pairingUrl && token && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-default-200 p-3">
            <div className="text-xs text-default-500">
              配对信息（在手机设置「电脑用量桥接」中录入，或粘贴配对 URL）
            </div>
            <CopyField
              label="地址"
              value={`${state?.ip}:${state?.port}`}
              copied={copied === 'addr'}
              onCopy={() => void copy('addr', `${state?.ip}:${state?.port}`)}
            />
            <CopyField
              label="Token"
              mono
              value={token}
              copied={copied === 'token'}
              onCopy={() => void copy('token', token)}
            />
            <CopyField
              label="配对 URL"
              mono
              value={pairingUrl}
              copied={copied === 'url'}
              onCopy={() => void copy('url', pairingUrl)}
            />
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onPress={() => void toggle(true)}
              isDisabled={busy}
            >
              重新生成 token（旧配对立即失效）
            </Button>
          </div>

          {qr?.startsWith('data:image/') && (
            <div className="flex items-center gap-3 rounded-md border border-default-200 p-3">
              <img src={qr} alt="配对二维码" className="h-32 w-32 shrink-0" />
              <div className="text-xs text-default-500">
                二维码编码完整配对 URL；手机端 MVP 暂不支持相机扫码，可留待后续版本。
              </div>
            </div>
          )}

          <p className="text-xs text-warning">
            安全提示：桥接为明文 HTTP、token 无过期时间且对所有网卡开放。请仅在可信网络开启，用完即关；
            不要把配对 URL 发给他人。
          </p>
        </div>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="mb-0.5 text-xs text-default-500">{label}</div>
      <div className="flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 break-all rounded bg-default-100 px-2 py-1 text-xs ${
            mono ? 'font-mono' : ''
          }`}
        >
          {value}
        </code>
        <Button size="sm" variant="ghost" className="shrink-0" onPress={onCopy}>
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  );
}
