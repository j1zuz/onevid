/**
 * Cache en memoria con TTL y límite de entradas (LRU).
 *
 * Sustituye los `Map<string, { expiresAt, value }>` que crecían sin tope: al
 * superar `maxEntries` se expulsa la entrada menos usada recientemente. Las
 * entradas caducadas no se devuelven como frescas, pero se conservan hasta que
 * el LRU las expulsa para permitir un fallback explícito a la copia vieja
 * (`get(key, { allowStale: true })`).
 */
interface CacheEntry<V> {
  expiresAt: number;
  value: V;
}

export interface LruTtlCacheGetOptions {
  /** Devuelve la entrada aunque haya expirado (fallback a copia vieja). */
  allowStale?: boolean;
}

export class LruTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("LruTtlCache: maxEntries debe ser un entero positivo");
    }
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Devuelve el valor si sigue fresco. Un acierto refresca la recencia; una
   * entrada expirada se deja en el mapa (sin refrescar) para `allowStale`.
   */
  get(key: K, options: LruTtlCacheGetOptions = {}): V | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    const fresh = entry.expiresAt > Date.now();
    if (!fresh && !options.allowStale) {
      return null;
    }
    if (fresh) {
      // Map preserva el orden de inserción: borrar + insertar mueve al final.
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== null;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (ttlMs <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    this.evict();
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
