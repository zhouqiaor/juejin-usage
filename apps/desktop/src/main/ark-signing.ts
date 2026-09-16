// SPDX-License-Identifier: MIT
// main/ark-signing.ts -- Ark SigV4 signing (Volcengine variant)
import { createHash, createHmac } from 'node:crypto';

export const ARK_HOST = 'open.volcengineapi.com';
export const ARK_API_VERSION = '2024-01-01';
export const ARK_SERVICE = 'ark';
export const ARK_CONTENT_TYPE = 'application/json; charset=utf-8';
export const ARK_SIGNED_HEADERS = 'host;x-date;x-content-sha256;content-type';
export const ARK_ALG_PREFIX = 'HMAC-SHA256';

function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function arkCanonicalQuery(action: string, region: string): string {
  const pairs: Array<[string, string]> = [
    ['Action', action],
    ['Region', region],
    ['Version', ARK_API_VERSION],
  ];
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
}

export interface ArkSignResult {
  authorization: string;
  xDate: string;
  xContentSha256: string;
}

export function signArk(
  ak: string,
  sk: string,
  region: string,
  action: string,
  body: Buffer,
  now: Date = new Date(),
): ArkSignResult {
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const shortDate = xDate.slice(0, 8);
  const xSha = createHash('sha256').update(body).digest('hex');
  const canonicalHeaders = `host:${ARK_HOST}\nx-date:${xDate}\nx-content-sha256:${xSha}\ncontent-type:${ARK_CONTENT_TYPE}\n`;
  const query = arkCanonicalQuery(action, region);
  const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${ARK_SIGNED_HEADERS}\n${xSha}`;
  const scope = `${shortDate}/${region}/${ARK_SERVICE}/request`;
  const sts = `${ARK_ALG_PREFIX}\n${xDate}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const k0 = createHmac('sha256', sk).update(shortDate).digest();
  const k1 = createHmac('sha256', k0).update(region).digest();
  const k2 = createHmac('sha256', k1).update(ARK_SERVICE).digest();
  const kSigning = createHmac('sha256', k2).update('request').digest();
  const sig = createHmac('sha256', kSigning).update(sts).digest('hex');
  const authorization = `${ARK_ALG_PREFIX} Credential=${ak}/${scope}, SignedHeaders=${ARK_SIGNED_HEADERS}, Signature=${sig}`;

  return { authorization, xDate, xContentSha256: xSha };
}