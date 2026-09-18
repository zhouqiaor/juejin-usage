import { useEffect, useState } from 'react';
import { Button, Checkbox } from '@heroui/react';

/**
 * D4 PC-bridge 设置面板（「手机桥接」Tab）。
 *
 * - 开关：pcBridgeEnable 启动 8453 **HTTPS** server（自签证书 + SPKI pin TOFU）+ 128-bit token；
 *   关闭即停服。
 * - S3：默认仅绑 127.0.0.1（仅本机）。要让同一 Wi-Fi 的手机访问，必须另行勾选
 *   「允许局域网设备访问」——显式同意后才绑 0.0.0.0，面板展示当前绑定状态。
 * - S10：二维码组件缺失时展示显式错误态与手录 URL，绝不显示不可扫的占位。
 * - 安全口径：自签证书指纹即配对凭据（二维码公告），指纹变更手机端会阻断；
 *   token 无 TTL，面板上明示，避免用户无感常开。
 */
interface BridgeState {
  enabled: boolean;
  host: string;
  ip: string;
  port: number;
  token: string | null;
  url: string | null;
  tls?: boolean;
  lan?: boolean;
  spki256?: string | null;
}

interface PairingInfo {
  ip: string;
  host: string;
  port: number;
  token: string;
  url: string;
  tls: boolean;
  lan: boolean;
  spki256: string | null;
  qrDataUrl: string;
  qrError: string | null;
}

/** 指纹展示：AB CD 12 … 分组（与手机端确认页口径一致）。 */
function formatPin(pin: string): string {
  return pin.toUpperCase().match(/.{1,2}/g)?.join(' ') ?? pin;
}

export function PhoneBridgeSettings() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // 局域网访问显式同意开关（默认关）；桥接运行中锁定，避免运行时改绑造成语义歧义
  const [lanConsent, setLanConsent] = useState(false);

  const refresh = () => {
    void window.tud
      .pcBridgeStatus()
      .then((s) => {
        setState(s);
        setLanConsent(s.lan === true);
        if (!s.enabled) setInfo(null);
      })
      .catch(() => {
        // 主进程过旧/IPC 不可用时保持空白态（默认仅回环）
        setState({ enabled: false, host: '127.0.0.1', ip: '', port: 8453, token: null, url: null });
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
        const i = await window.tud.pcBridgeEnable({ lan: lanConsent });
        setInfo(i);
        setState({
          enabled: true,
          host: i.host,
          ip: i.ip,
          port: i.port,
          token: i.token,
          url: i.url,
          tls: i.tls,
          lan: i.lan,
          spki256: i.spki256,
        });
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

  const resetIdentity = async () => {
    setBusy(true);
    setError(null);
    try {
      const i = await window.tud.pcBridgeResetIdentity();
      if (i) {
        setInfo(i);
        setState({
          enabled: true,
          host: i.host,
          ip: i.ip,
          port: i.port,
          token: i.token,
          url: i.url,
          tls: i.tls,
          lan: i.lan,
          spki256: i.spki256,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重置身份失败');
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
  const qrError = info?.qrError ?? null;
  const pin = info?.spki256 ?? state?.spki256 ?? null;
  const lanActive = info?.lan ?? state?.lan ?? false;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">手机桥接（TLS 加密）</div>
          <div className="mt-0.5 text-xs text-default-500">
            开启后，经 https://{state?.ip || 'IP'}:{state?.port || 8453} 只读拉取本机今日 AI
            工具用量（v1 契约，不含订阅额度）。连接经自签证书加密，手机扫描二维码完成指纹信任。
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

      <label className="flex items-start gap-2 rounded-md border border-default-200 p-3 text-xs">
        <Checkbox
          aria-label="允许局域网设备访问"
          isSelected={lanConsent}
          isDisabled={busy || enabled}
          onChange={setLanConsent}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        <span>
          <span className="font-medium">允许同一局域网的手机访问（对所有网卡开放）</span>
          <br />
          <span className="text-default-500">
            不勾选时桥接只绑定 127.0.0.1（仅本机能连）。勾选即表示你确认当前网络可信；
            运行中不可切换，请先关闭桥接。
          </span>
        </span>
      </label>

      {enabled && (
        <div className="text-xs text-default-500">
          当前绑定：
          <code className="ml-1 rounded bg-default-100 px-1.5 py-0.5">
            {lanActive ? '0.0.0.0（局域网开放）' : '127.0.0.1（仅本机）'}
          </code>
        </div>
      )}

      {error && <div className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger">{error}</div>}

      {enabled && pairingUrl && token && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-default-200 p-3">
            <div className="text-xs text-default-500">
              配对信息（在手机设置「电脑用量桥接」扫码，或粘贴配对 URL）
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
              label="配对 URL（https + 证书指纹）"
              mono
              value={pairingUrl}
              copied={copied === 'url'}
              onCopy={() => void copy('url', pairingUrl)}
            />
            {pin && (
              <div className="mt-2">
                <div className="mb-0.5 text-xs text-default-500">证书指纹（SPKI SHA-256）</div>
                <code className="block break-all rounded bg-default-100 px-2 py-1 text-xs font-mono">
                  {formatPin(pin)}
                </code>
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onPress={() => void toggle(true)}
                isDisabled={busy}
              >
                重新生成 token（旧配对立即失效）
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => void resetIdentity()}
                isDisabled={busy}
              >
                重置证书身份
              </Button>
            </div>
          </div>

          {qrError && (
            <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning">
              二维码组件缺失/渲染失败（{qrError}）：请直接复制上方配对 URL，在手机「电脑用量桥接」
              设置中粘贴配对，不要把不可扫的占位当作二维码。
            </div>
          )}
          {qr?.startsWith('data:image/') && (
            <div className="flex items-center gap-3 rounded-md border border-default-200 p-3">
              <img src={qr} alt="配对二维码" className="h-32 w-32 shrink-0" />
              <div className="text-xs text-default-500">
                二维码编码完整 https 配对 URL（含证书指纹）；扫码后手机会要求核对指纹并确认。
              </div>
            </div>
          )}

          <p className="text-xs text-warning">
            安全提示：桥接为自签证书 TLS（指纹即身份凭据），token 无过期时间
            {lanActive ? '，且当前对局域网所有网卡开放' : ''}。请仅在可信网络开启，用完即关；
            不要把配对 URL 或截图发给他人。
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
