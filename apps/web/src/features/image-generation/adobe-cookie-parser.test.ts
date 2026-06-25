import { describe, expect, it } from "vitest";

import { parseAdobeCookieEntries } from "./adobe-cookie-parser";

describe("parseAdobeCookieEntries", () => {
  it("returns empty for blank input", () => {
    expect(parseAdobeCookieEntries("")).toEqual([]);
    expect(parseAdobeCookieEntries("   \n  \n")).toEqual([]);
  });

  it("parses one cookie per line and keeps `;`/`=`/spaces intact", () => {
    const a = "aux_sid=AAA; ims_uid=111; foo=bar";
    const b = "aux_sid=BBB; ims_uid=222";
    expect(parseAdobeCookieEntries(`${a}\n${b}`)).toEqual([
      { cookie: a },
      { cookie: b },
    ]);
  });

  it("skips blank lines and `#` comments", () => {
    const a = "aux_sid=AAA; x=1";
    expect(parseAdobeCookieEntries(`# 第一个账号\n${a}\n\n  # 注释\n`)).toEqual([
      { cookie: a },
    ]);
  });

  it("strips surrounding quotes and trailing commas", () => {
    const a = "aux_sid=AAA; x=1";
    expect(parseAdobeCookieEntries(`"${a}",\n'${a.replace("AAA", "BBB")}'`)).toEqual([
      { cookie: a },
      { cookie: "aux_sid=BBB; x=1" },
    ]);
  });

  it("dedupes identical cookie strings, preserving order", () => {
    const a = "aux_sid=AAA; x=1";
    const b = "aux_sid=BBB; x=2";
    expect(parseAdobeCookieEntries(`${a}\n${b}\n${a}`)).toEqual([
      { cookie: a },
      { cookie: b },
    ]);
  });

  it("parses a JSON array of cookie strings", () => {
    const a = "aux_sid=AAA; x=1";
    const b = "aux_sid=BBB; x=2";
    expect(parseAdobeCookieEntries(JSON.stringify([a, b]))).toEqual([
      { cookie: a },
      { cookie: b },
    ]);
  });

  it("parses a JSON array of objects with name/scope", () => {
    const result = parseAdobeCookieEntries(
      JSON.stringify([
        { cookie: "aux_sid=AAA", name: "号一", scope: "openid,AdobeID" },
        { cookie: "aux_sid=BBB" },
        { cookie: "   ", name: "空的" },
      ])
    );
    expect(result).toEqual([
      { cookie: "aux_sid=AAA", name: "号一", scope: "openid,AdobeID" },
      { cookie: "aux_sid=BBB" },
    ]);
  });

  it("parses a { cookies: [...] } wrapper object", () => {
    const result = parseAdobeCookieEntries(
      JSON.stringify({ cookies: ["aux_sid=AAA", { cookie: "aux_sid=BBB" }] })
    );
    expect(result).toEqual([{ cookie: "aux_sid=AAA" }, { cookie: "aux_sid=BBB" }]);
  });

  it("keeps a raw cookie containing braces (does not mistake it for JSON)", () => {
    const a = "aux_sid=AAA; meta={foo:bar}; x=1";
    expect(parseAdobeCookieEntries(a)).toEqual([{ cookie: a }]);
  });

  it("falls back to line parsing when bracket-led text is not valid JSON", () => {
    // 以 [ 开头但不是合法 JSON:走 catch,按行解析,不丢数据。
    const line = "[email protected]=AAA; x=1";
    expect(parseAdobeCookieEntries(line)).toEqual([{ cookie: line }]);
  });
});
