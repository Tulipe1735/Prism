import { describe, expect, it, vi } from "vitest";

import { isPublicAddress } from "../../src/web/target.ts";
import { webFetch } from "../../src/web/fetch.ts";

const blockedUrls = [
  "http://127.0.0.1/admin",
  "http://127.1.2.3:8080/",
  "http://0.0.0.0/",
  "http://10.1.2.3/",
  "http://172.16.5.5/",
  "http://172.31.255.254/",
  "http://192.168.0.1/router",
  "http://169.254.169.254/latest/meta-data/",
  "http://100.64.0.1/",
  "http://192.0.2.5/",
  "http://198.18.0.1/",
  "http://203.0.113.9/",
  "http://224.0.0.1/",
  "http://240.0.0.1/",
  "http://255.255.255.255/",
  "http://[::1]/",
  "http://[::]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://[ff02::1]/",
  "http://[2001:db8::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:10.0.0.1]/",
  "http://[2002:7f00:1::]/",
  "http://localhost:3000/",
  "http://api.localhost/",
];

describe("webFetch target policy", () => {
  it.each(blockedUrls)("rejects %s before any network call", async (url) => {
    const fetchImpl = vi.fn();
    await expect(
      webFetch({ url, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/not a public address|non-public/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes and URLs carrying credentials", async () => {
    const fetchImpl = vi.fn();
    const fetch = fetchImpl as unknown as typeof fetch;
    await expect(webFetch({ url: "file:///etc/passwd", fetchImpl: fetch })).rejects.toThrow(
      /http and https/,
    );
    await expect(
      webFetch({ url: "https://user:secret@example.com/", fetchImpl: fetch }),
    ).rejects.toThrow(/credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const fetchImpl = vi.fn();
    await expect(
      webFetch({
        url: "https://intranet.example.com/wiki",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveAddresses: async () => ["10.0.0.7"],
      }),
    ).rejects.toThrow(/10\.0\.0\.7/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "11.0.0.1",
    "100.63.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.0.1",
    "192.88.99.1",
    "198.19.255.255",
    "224.0.0.1",
    "240.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:192.168.0.1",
    "64:ff9b::a00:1",
    "2001::1",
    "2002:c0a8:101::",
    "not-an-address",
  ])("rejects the non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
