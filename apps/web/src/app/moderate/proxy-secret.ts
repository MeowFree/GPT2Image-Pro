// /moderate 代理鉴权的密钥比对（纯逻辑，DB-free，便于单测）。
// 职责：以恒定时间比对收到的 token 与一组已配置密钥，避免计时侧信道。
// 使用方：moderate/route.ts 的 verifyProxySecret。
// 关键依赖：node:crypto（sha256 + timingSafeEqual），与全仓其它鉴权入口
// （jobs、external-api/auth、creem、epay）保持同一恒定时间比对标准。

import { createHash, timingSafeEqual } from "node:crypto";

// 对任意长度输入先 sha256 成定长摘要，再用 timingSafeEqual 比对，
// 避免原生字符串比较"首个不同字符即短路"暴露的计时侧信道。
function timingSafeEqualString(value: string, expected: string): boolean {
  const valueHash = createHash("sha256").update(value).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(valueHash, expectedHash);
}

// 判断 token 是否匹配任一已配置密钥。
// 故意遍历全部候选而不短路：保持比对耗时与"命中哪个候选/是否命中"无关，
// 防止通过响应时间推断密钥。空 token 或空候选集一律不匹配。
export function secretMatchesAny(
  token: string,
  secrets: readonly string[]
): boolean {
  if (!token) return false;

  let matched = false;
  for (const secret of secrets) {
    if (timingSafeEqualString(token, secret)) {
      matched = true;
    }
  }
  return matched;
}
