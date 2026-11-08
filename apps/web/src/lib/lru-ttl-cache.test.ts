// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LruTtlCache } from "./lru-ttl-cache";

const realDateNow = Date.now;
let now = realDateNow();

beforeEach(() => {
  now = 1_000;
  Date.now = () => now;
});

afterEach(() => {
  Date.now = realDateNow;
});

describe("LruTtlCache", () => {
  test("devuelve solo entradas frescas y permite el fallback stale", () => {
    const cache = new LruTtlCache<string, number>(10);
    cache.set("a", 1, 100);

    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);

    now = 1_100;
    expect(cache.get("a")).toBeNull();
    expect(cache.has("a")).toBe(false);
    expect(cache.get("a", { allowStale: true })).toBe(1);
  });

  test("expulsa la entrada menos usada al superar el máximo", () => {
    const cache = new LruTtlCache<string, number>(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);

    // "a" pasa a ser la más reciente; "b" es la siguiente víctima.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 60_000);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  test("set refresca valor y TTL", () => {
    const cache = new LruTtlCache<string, number>(10);
    cache.set("a", 1, 100);
    now = 1_500;
    cache.set("a", 2, 100);

    expect(cache.get("a")).toBe(2);
    now = 1_600;
    expect(cache.get("a")).toBeNull();
  });

  test("delete y clear liberan entradas", () => {
    const cache = new LruTtlCache<string, number>(10);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);

    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  test("rechaza un máximo inválido", () => {
    expect(() => new LruTtlCache<string, number>(0)).toThrow();
    expect(() => new LruTtlCache<string, number>(1.5)).toThrow();
  });
});
