/**
 * Epay client helpers.
 *
 * Compatible with common 易支付 submit.php integrations. The signing rules
 * mirror new-api's go-epay usage: filter empty values plus sign/sign_type,
 * sort keys, join as query string, append merchant key, then MD5.
 */

import crypto from "node:crypto";
import { getBaseUrl } from "../config/payment";
import {
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "../system-settings";

export const EPAY_TRADE_SUCCESS = "TRADE_SUCCESS";

export type PaymentProvider = "creem" | "epay";
export type EpayBusinessType = "subscription" | "credit_purchase";

export interface EpayMetadata {
  type: EpayBusinessType;
  userId: string;
  outTradeNo: string;
  priceId?: string;
  planId?: string;
  packageId?: string;
  checkoutMode?: "new_subscription" | "upgrade";
  expectedAmount?: number;
  originalAmount?: number;
  prorationCredit?: number;
  remainingDays?: number;
  periodDays?: number;
  upgradeFromPriceId?: string;
}

export interface EpayPurchaseInput {
  outTradeNo: string;
  name: string;
  money: number | string;
  type?: string;
  notifyUrl?: string;
  returnUrl?: string;
  param?: string;
}

export interface EpayPurchaseResult {
  url: string;
  params: Record<string, string>;
}

export interface EpayVerifyResult {
  verifyStatus: boolean;
  type: string;
  tradeNo: string;
  outTradeNo: string;
  name: string;
  money: string;
  tradeStatus: string;
  param?: string;
  raw: Record<string, string>;
}

export function getPaymentProvider(): PaymentProvider {
  const providerValues = [
    process.env.PAYMENT_PROVIDER,
    process.env.NEXT_PUBLIC_PAYMENT_PROVIDER,
  ];

  return providerValues.some(
    (provider) => provider?.trim().toLowerCase() === "epay"
  )
    ? "epay"
    : "creem";
}

export function isEpayPaymentProvider(): boolean {
  return getPaymentProvider() === "epay";
}

export async function getRuntimePaymentProvider(): Promise<PaymentProvider> {
  return getRuntimeSettingSelect(
    "PAYMENT_PROVIDER",
    ["creem", "epay"] as const,
    getPaymentProvider()
  );
}

export async function isRuntimeEpayPaymentProvider(): Promise<boolean> {
  return (await getRuntimePaymentProvider()) === "epay";
}

export function getEpayDefaultPaymentType(): string {
  return (
    process.env.EPAY_DEFAULT_PAYMENT_TYPE ??
    process.env.NEXT_PUBLIC_EPAY_DEFAULT_PAYMENT_TYPE ??
    "alipay"
  ).trim();
}

function getEpayNotifyUrl(): string | undefined {
  const notifyUrl = process.env.EPAY_NOTIFY_URL?.trim();
  return notifyUrl || undefined;
}

function getEpayReturnUrl(baseUrl: string, notifyUrl?: string): string {
  if (notifyUrl) {
    try {
      return new URL("/api/payments/epay/return", notifyUrl).toString();
    } catch {
      // Fall back to the public app URL below.
    }
  }
  return `${baseUrl}/api/payments/epay/return`;
}

function getEpayConfig() {
  const pid = process.env.EPAY_PID?.trim() ?? "";
  const key = process.env.EPAY_KEY?.trim() ?? "";
  const apiUrl = process.env.EPAY_API_URL?.trim() ?? "";

  if (!pid || !key || !apiUrl) {
    throw new Error("EPAY_PID, EPAY_KEY and EPAY_API_URL must be configured");
  }

  return { pid, key, apiUrl };
}

async function getRuntimeEpayConfig() {
  const pid = (await getRuntimeSettingString("EPAY_PID")) ?? "";
  const key = (await getRuntimeSettingString("EPAY_KEY")) ?? "";
  const apiUrl = (await getRuntimeSettingString("EPAY_API_URL")) ?? "";

  if (!pid || !key || !apiUrl) {
    throw new Error("EPAY_PID, EPAY_KEY and EPAY_API_URL must be configured");
  }

  return { pid, key, apiUrl };
}

export function isEpayConfigured(): boolean {
  return Boolean(
    process.env.EPAY_PID?.trim() &&
      process.env.EPAY_KEY?.trim() &&
      process.env.EPAY_API_URL?.trim()
  );
}

export async function isRuntimeEpayConfigured(): Promise<boolean> {
  return Boolean(
    (await getRuntimeSettingString("EPAY_PID")) &&
      (await getRuntimeSettingString("EPAY_KEY")) &&
      (await getRuntimeSettingString("EPAY_API_URL"))
  );
}

function formatMoney(money: number | string): string {
  if (typeof money === "number") {
    return money.toFixed(2);
  }
  return money;
}

function filterParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => key !== "sign" && key !== "sign_type" && value !== ""
    )
  );
}

function buildSignPayload(params: Record<string, string>): string {
  const filtered = filterParams(params);
  return Object.keys(filtered)
    .sort()
    .map((key) => `${key}=${filtered[key]}`)
    .join("&");
}

export function signEpayParams(
  params: Record<string, string>,
  key?: string
): string {
  const merchantKey = key ?? getEpayConfig().key;
  return crypto
    .createHash("md5")
    .update(buildSignPayload(params) + merchantKey)
    .digest("hex");
}

export async function signRuntimeEpayParams(
  params: Record<string, string>
): Promise<string> {
  const { key } = await getRuntimeEpayConfig();
  return crypto
    .createHash("md5")
    .update(buildSignPayload(params) + key)
    .digest("hex");
}

export function withEpaySignature(
  params: Record<string, string>
): Record<string, string> {
  return {
    ...params,
    sign: signEpayParams(params),
    sign_type: "MD5",
  };
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createEpayPurchase(
  input: EpayPurchaseInput
): EpayPurchaseResult {
  const { pid, apiUrl } = getEpayConfig();
  const baseUrl = getBaseUrl();
  const notifyUrl = input.notifyUrl ?? getEpayNotifyUrl();
  const params: Record<string, string> = {
    pid,
    type: input.type || getEpayDefaultPaymentType(),
    out_trade_no: input.outTradeNo,
    notify_url: notifyUrl ?? `${baseUrl}/api/webhooks/epay`,
    return_url: input.returnUrl ?? getEpayReturnUrl(baseUrl, notifyUrl),
    name: input.name,
    money: formatMoney(input.money),
    device: "pc",
    sign_type: "MD5",
  };

  if (input.param) {
    params.param = input.param;
  }

  const signedParams = withEpaySignature(params);
  const submitUrl = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  submitUrl.pathname = `${submitUrl.pathname.replace(/\/+$/, "")}/submit.php`;
  submitUrl.search = new URLSearchParams(signedParams).toString();

  return {
    url: submitUrl.toString(),
    params: signedParams,
  };
}

export async function createRuntimeEpayPurchase(
  input: EpayPurchaseInput
): Promise<EpayPurchaseResult> {
  const { pid, apiUrl } = await getRuntimeEpayConfig();
  const baseUrl = getBaseUrl();
  const notifyUrl =
    input.notifyUrl ??
    (await getRuntimeSettingString("EPAY_NOTIFY_URL")) ??
    `${baseUrl}/api/webhooks/epay`;
  const paymentType =
    input.type ??
    (await getRuntimeSettingString("EPAY_DEFAULT_PAYMENT_TYPE")) ??
    "alipay";
  const params: Record<string, string> = {
    pid,
    type: paymentType,
    out_trade_no: input.outTradeNo,
    notify_url: notifyUrl,
    return_url: input.returnUrl ?? getEpayReturnUrl(baseUrl, notifyUrl),
    name: input.name,
    money: formatMoney(input.money),
    device: "pc",
    sign_type: "MD5",
  };

  if (input.param) {
    params.param = input.param;
  }

  const signedParams = {
    ...params,
    sign: await signRuntimeEpayParams(params),
    sign_type: "MD5",
  };
  const submitUrl = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  submitUrl.pathname = `${submitUrl.pathname.replace(/\/+$/, "")}/submit.php`;
  submitUrl.search = new URLSearchParams(signedParams).toString();

  return {
    url: submitUrl.toString(),
    params: signedParams,
  };
}

export function verifyEpayParams(
  params: Record<string, string>
): EpayVerifyResult {
  const receivedSign = params.sign ?? "";
  const expectedSign = signEpayParams(params);
  const verifyStatus = timingSafeEqualString(
    receivedSign.toLowerCase(),
    expectedSign.toLowerCase()
  );

  const result: EpayVerifyResult = {
    verifyStatus,
    type: params.type ?? "",
    tradeNo: params.trade_no ?? "",
    outTradeNo: params.out_trade_no ?? "",
    name: params.name ?? "",
    money: params.money ?? "",
    tradeStatus: params.trade_status ?? "",
    raw: params,
  };

  if (params.param !== undefined) {
    result.param = params.param;
  }

  return result;
}

export async function verifyRuntimeEpayParams(
  params: Record<string, string>
): Promise<EpayVerifyResult> {
  const receivedSign = params.sign ?? "";
  const expectedSign = await signRuntimeEpayParams(params);
  const verifyStatus = timingSafeEqualString(
    receivedSign.toLowerCase(),
    expectedSign.toLowerCase()
  );

  const result: EpayVerifyResult = {
    verifyStatus,
    type: params.type ?? "",
    tradeNo: params.trade_no ?? "",
    outTradeNo: params.out_trade_no ?? "",
    name: params.name ?? "",
    money: params.money ?? "",
    tradeStatus: params.trade_status ?? "",
    raw: params,
  };

  if (params.param !== undefined) {
    result.param = params.param;
  }

  return result;
}

export async function parseEpayRequestParams(
  req: Request
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};

  if (req.method === "GET") {
    const url = new URL(req.url);
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        params[key] = value;
      } else if (value !== null && value !== undefined) {
        params[key] = String(value);
      }
    }
    return params;
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await req.formData();
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        params[key] = value;
      }
    });
    return params;
  }

  const body = await req.text();
  new URLSearchParams(body).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

export function encodeEpayMetadata(metadata: EpayMetadata): string {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

export function decodeEpayMetadata(param?: string): EpayMetadata | null {
  if (!param) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(param, "base64url").toString("utf8")
    ) as Partial<EpayMetadata>;

    if (
      (parsed.type !== "subscription" && parsed.type !== "credit_purchase") ||
      typeof parsed.userId !== "string" ||
      typeof parsed.outTradeNo !== "string"
    ) {
      return null;
    }

    return {
      type: parsed.type,
      userId: parsed.userId,
      outTradeNo: parsed.outTradeNo,
      ...(typeof parsed.priceId === "string" && { priceId: parsed.priceId }),
      ...(typeof parsed.planId === "string" && { planId: parsed.planId }),
      ...(typeof parsed.packageId === "string" && {
        packageId: parsed.packageId,
      }),
      ...((parsed.checkoutMode === "new_subscription" ||
        parsed.checkoutMode === "upgrade") && {
        checkoutMode: parsed.checkoutMode,
      }),
      ...(typeof parsed.expectedAmount === "number" && {
        expectedAmount: parsed.expectedAmount,
      }),
      ...(typeof parsed.originalAmount === "number" && {
        originalAmount: parsed.originalAmount,
      }),
      ...(typeof parsed.prorationCredit === "number" && {
        prorationCredit: parsed.prorationCredit,
      }),
      ...(typeof parsed.remainingDays === "number" && {
        remainingDays: parsed.remainingDays,
      }),
      ...(typeof parsed.periodDays === "number" && {
        periodDays: parsed.periodDays,
      }),
      ...(typeof parsed.upgradeFromPriceId === "string" && {
        upgradeFromPriceId: parsed.upgradeFromPriceId,
      }),
    };
  } catch {
    return null;
  }
}

export function moneyToCents(value: number | string): number {
  const str = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return Number.NaN;
  }

  const [yuan = "0", cents = ""] = str.split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}
