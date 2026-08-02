/**
 * Epay 纯逻辑回归测试。
 *
 * 锁定支付鉴权门闩（签名/验签）、金额防篡改解析（moneyToCents）与
 * metadata 紧凑编解码契约——这些是异步通知发放积分的根本防线，错算或
 * 编解码不对称会直接导致伪造回调白嫖、少收/误拒或发错账户。
 *
 * epay.ts 顶层 import @repo/database 仅为订单读写的 DB 函数所需，被测的纯
 * 函数与之无关，故 mock 掉 @repo/database / @repo/database/schema，使本测试
 * 在 DB-free vitest 下加载模块即可。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/database/schema", () => ({ epayOrder: {} }));

import {
  decodeEpayMetadata,
  type EpayMetadata,
  encodeEpayMetadata,
  moneyToCents,
  signEpayParams,
  verifyEpayParams,
  withEpaySignature,
} from "./epay";

const MERCHANT_KEY = "test-merchant-key";

beforeAll(() => {
  // verifyEpayParams 内部以无 key 形式调用 signEpayParams，会回退读取
  // process.env.EPAY_KEY（及 EPAY_PID/EPAY_API_URL，否则 getEpayConfig 抛错）。
  process.env.EPAY_PID = "test-pid";
  process.env.EPAY_KEY = MERCHANT_KEY;
  process.env.EPAY_API_URL = "https://pay.example.com";
});

describe("signEpayParams / buildSignPayload", () => {
  it("excludes sign / sign_type and empty values, sorts keys lexicographically", () => {
    // 含空值与 sign/sign_type 的入参，签名应与"仅保留非空业务字段"的入参一致，
    // 证明 filterParams 与键排序按约定生效。
    const noisy = signEpayParams(
      {
        money: "10.00",
        out_trade_no: "T1",
        empty: "",
        sign: "stale",
        sign_type: "MD5",
      },
      MERCHANT_KEY
    );
    const clean = signEpayParams(
      { out_trade_no: "T1", money: "10.00" },
      MERCHANT_KEY
    );
    expect(noisy).toBe(clean);
  });

  it("produces a stable 32-char lowercase md5 hex digest", () => {
    const sign = signEpayParams(
      { out_trade_no: "T1", money: "10.00" },
      MERCHANT_KEY
    );
    expect(sign).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes the signature when any signed field is tampered", () => {
    const base = signEpayParams(
      { out_trade_no: "T1", money: "10.00" },
      MERCHANT_KEY
    );
    const tampered = signEpayParams(
      { out_trade_no: "T1", money: "0.01" },
      MERCHANT_KEY
    );
    expect(tampered).not.toBe(base);
  });
});

describe("verifyEpayParams", () => {
  it("accepts a correctly signed payload", () => {
    const signed = withEpaySignature({
      out_trade_no: "T1",
      money: "10.00",
      trade_status: "TRADE_SUCCESS",
    });
    expect(verifyEpayParams(signed).verifyStatus).toBe(true);
  });

  it("is case-insensitive on the hex sign", () => {
    const params = { out_trade_no: "T1", money: "10.00" };
    const upper = { ...params, sign: signEpayParams(params).toUpperCase() };
    expect(verifyEpayParams(upper).verifyStatus).toBe(true);
  });

  it("rejects a tampered money field", () => {
    const signed = withEpaySignature({ out_trade_no: "T1", money: "10.00" });
    const tampered = { ...signed, money: "0.01" };
    expect(verifyEpayParams(tampered).verifyStatus).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    const params = { out_trade_no: "T1", money: "10.00" };
    const truncated = { ...params, sign: signEpayParams(params).slice(0, 16) };
    expect(verifyEpayParams(truncated).verifyStatus).toBe(false);
  });

  it("rejects a missing signature without throwing", () => {
    expect(verifyEpayParams({ out_trade_no: "T1", money: "10.00" }).verifyStatus)
      .toBe(false);
  });

  it("maps gateway fields and forwards param only when present", () => {
    const signed = withEpaySignature({
      type: "alipay",
      trade_no: "G1",
      out_trade_no: "T1",
      name: "credits",
      money: "10.00",
      trade_status: "TRADE_SUCCESS",
    });
    const result = verifyEpayParams(signed);
    expect(result.tradeNo).toBe("G1");
    expect(result.outTradeNo).toBe("T1");
    expect(result.money).toBe("10.00");
    expect(result.tradeStatus).toBe("TRADE_SUCCESS");
    expect(result.param).toBeUndefined();

    const withParam = withEpaySignature({
      out_trade_no: "T1",
      money: "10.00",
      param: "encoded",
    });
    expect(verifyEpayParams(withParam).param).toBe("encoded");
  });
});

describe("moneyToCents", () => {
  it("converts integers and decimals to integer cents", () => {
    expect(moneyToCents("20")).toBe(2000);
    expect(moneyToCents("20.5")).toBe(2050);
    expect(moneyToCents("20.05")).toBe(2005);
    expect(moneyToCents("0")).toBe(0);
  });

  it("accepts numeric inputs by normalizing to two decimals first", () => {
    expect(moneyToCents(20.1)).toBe(2010);
    expect(moneyToCents(20)).toBe(2000);
  });

  it("trims surrounding whitespace on string inputs", () => {
    expect(moneyToCents(" 20 ")).toBe(2000);
  });

  it("returns NaN for malformed / negative / over-precise inputs", () => {
    expect(moneyToCents("20.555")).toBeNaN();
    expect(moneyToCents("-1")).toBeNaN();
    expect(moneyToCents("abc")).toBeNaN();
    expect(moneyToCents("")).toBeNaN();
    expect(moneyToCents("1,000")).toBeNaN();
  });
});

describe("encodeEpayMetadata / decodeEpayMetadata", () => {
  it("round-trips a credit_purchase metadata via compact keys", () => {
    const metadata: EpayMetadata = {
      type: "credit_purchase",
      userId: "user-1",
      outTradeNo: "T1",
      packageId: "pack-1",
      quantity: 3,
      creditPlan: "pro",
    };
    expect(decodeEpayMetadata(encodeEpayMetadata(metadata))).toEqual(metadata);
  });

  it("round-trips a subscription upgrade preserving proration fields", () => {
    const metadata: EpayMetadata = {
      type: "subscription",
      userId: "user-1",
      outTradeNo: "T2",
      priceId: "pro_monthly",
      checkoutMode: "upgrade",
      expectedAmount: 12.34,
      originalAmount: 20,
      prorationCredit: 7.66,
      remainingDays: 12,
      periodDays: 30,
      upgradeFromPriceId: "starter_monthly",
    };
    expect(decodeEpayMetadata(encodeEpayMetadata(metadata))).toEqual(metadata);
  });

  it("round-trips a subscription renewal with the full purchase amount", () => {
    const metadata: EpayMetadata = {
      type: "subscription",
      userId: "user-1",
      outTradeNo: "T-renewal",
      priceId: "pro_monthly",
      checkoutMode: "renewal",
      expectedAmount: 60,
      originalAmount: 60,
    };
    expect(decodeEpayMetadata(encodeEpayMetadata(metadata))).toEqual(metadata);
  });

  it("decodes long-form metadata keys and coerces numeric strings", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        type: "credit_purchase",
        userId: "user-1",
        outTradeNo: "T3",
        quantity: "4",
      }),
      "utf8"
    ).toString("base64url");
    expect(decodeEpayMetadata(encoded)).toMatchObject({
      type: "credit_purchase",
      userId: "user-1",
      outTradeNo: "T3",
      quantity: 4,
    });
  });

  it("drops non-positive quantity and floors fractional quantity", () => {
    const floored = decodeEpayMetadata(
      Buffer.from(
        JSON.stringify({ t: "c", u: "u1", o: "T4", q: 2.9 }),
        "utf8"
      ).toString("base64url")
    );
    expect(floored?.quantity).toBe(2);

    const dropped = decodeEpayMetadata(
      Buffer.from(
        JSON.stringify({ t: "c", u: "u1", o: "T5", q: 0 }),
        "utf8"
      ).toString("base64url")
    );
    expect(dropped?.quantity).toBeUndefined();
  });

  it("returns null for malformed base64 or missing required fields", () => {
    expect(decodeEpayMetadata(undefined)).toBeNull();
    expect(decodeEpayMetadata("@@not-base64@@")).toBeNull();
    expect(
      decodeEpayMetadata(
        Buffer.from(JSON.stringify({ u: "u1", o: "T6" }), "utf8").toString(
          "base64url"
        )
      )
    ).toBeNull();
    expect(
      decodeEpayMetadata(
        Buffer.from(JSON.stringify({ t: "c", o: "T7" }), "utf8").toString(
          "base64url"
        )
      )
    ).toBeNull();
    expect(
      decodeEpayMetadata(
        Buffer.from(JSON.stringify({ t: "c", u: "u1" }), "utf8").toString(
          "base64url"
        )
      )
    ).toBeNull();
  });
});
