// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
import { describe, expect, test } from "bun:test";
import {
  buildDebridResolveUrl,
  debridResolvePath,
  resolveActiveDebridProvider,
} from "./debrid";

const HEX = "0123456789abcdef0123456789abcdef01234567";

describe("resolveActiveDebridProvider", () => {
  test("respeta la preferencia si ese proveedor tiene key", () => {
    expect(
      resolveActiveDebridProvider({
        preferred: "realdebrid",
        hasTorbox: true,
        hasRealDebrid: true,
      })
    ).toBe("realdebrid");
    expect(
      resolveActiveDebridProvider({
        preferred: "torbox",
        hasTorbox: true,
        hasRealDebrid: true,
      })
    ).toBe("torbox");
  });

  test("cae al proveedor que sí tenga key", () => {
    expect(
      resolveActiveDebridProvider({
        preferred: "realdebrid",
        hasTorbox: true,
        hasRealDebrid: false,
      })
    ).toBe("torbox");
    expect(
      resolveActiveDebridProvider({
        preferred: "torbox",
        hasTorbox: false,
        hasRealDebrid: true,
      })
    ).toBe("realdebrid");
  });

  test("sin keys conserva la preferencia (o TorBox por defecto)", () => {
    expect(
      resolveActiveDebridProvider({
        preferred: null,
        hasTorbox: false,
        hasRealDebrid: false,
      })
    ).toBe("torbox");
    expect(
      resolveActiveDebridProvider({
        preferred: "realdebrid",
        hasTorbox: false,
        hasRealDebrid: false,
      })
    ).toBe("realdebrid");
  });
});

describe("buildDebridResolveUrl", () => {
  test("arma la ruta del proveedor con hash y magnet", () => {
    const url = buildDebridResolveUrl(
      "realdebrid",
      `magnet:?xt=urn:btih:${HEX}&dn=movie`
    );
    expect(url).not.toBeNull();
    const parsed = new URL(url as string, "https://onevid.test");
    expect(parsed.pathname).toBe("/api/real-debrid/resolve");
    expect(parsed.searchParams.get("hash")).toBe(HEX);
    expect(parsed.searchParams.get("magnet")).toContain(`btih:${HEX}`);
  });

  test("deja pasar solo magnets", () => {
    expect(buildDebridResolveUrl("torbox", "https://example.com/a.mp4")).toBeNull();
  });

  test("cada proveedor tiene su endpoint", () => {
    expect(debridResolvePath("torbox")).toBe("/api/torbox/resolve");
    expect(debridResolvePath("realdebrid")).toBe("/api/real-debrid/resolve");
  });
});
