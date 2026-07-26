"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DELAY_MS = 220;
const DEFAULT_MIN_LENGTH = 1;
// Las búsquedas de una sesión son pocas y cortas, pero sin tope el Map
// crecería mientras la pestaña siga abierta.
const MAX_CACHE_ENTRIES = 50;

interface UseDebouncedSearchOptions<T> {
  /** Construye la URL a consultar a partir de la query ya recortada. */
  buildUrl: (query: string) => string;
  delayMs?: number;
  minLength?: number;
  /** Extrae la lista de resultados del JSON de la respuesta. */
  parse: (payload: unknown) => T[];
}

interface UseDebouncedSearchResult<T> {
  error: boolean;
  loading: boolean;
  query: string;
  reset: () => void;
  results: T[];
  /** Para el onChange del input: debounce + caché. */
  search: (value: string) => void;
  /** Para el submit del form: se salta el debounce pendiente. */
  submit: () => void;
}

/**
 * Búsqueda con debounce para inputs de cliente.
 *
 * Tres detalles que importan y que la implementación anterior (inline en el
 * header) no tenía:
 *
 * - `loading` se enciende *antes* del debounce, no al empezar el fetch: así
 *   quien consume el hook puede pintar el skeleton desde la primera tecla en
 *   vez de dejar la UI congelada hasta que llega la respuesta.
 * - cada petición aborta la anterior, así que teclear rápido no puede acabar
 *   pintando los resultados de una query vieja que llegó tarde.
 * - las queries ya consultadas se sirven desde caché sin red ni debounce, lo
 *   que hace gratis borrar y reescribir lo mismo.
 */
export function useDebouncedSearch<T>({
  buildUrl,
  delayMs = DEFAULT_DELAY_MS,
  minLength = DEFAULT_MIN_LENGTH,
  parse,
}: UseDebouncedSearchOptions<T>): UseDebouncedSearchResult<T> {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, T[]>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // buildUrl/parse normalmente se declaran inline en el componente. Los
  // leemos desde un ref para que los callbacks del hook tengan identidad
  // estable y un re-render no reprograme el debounce en curso.
  const optionsRef = useRef({ buildUrl, parse });

  useEffect(() => {
    optionsRef.current = { buildUrl, parse };
  }, [buildUrl, parse]);

  const cancelPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(async (trimmed: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const { buildUrl: build, parse: parsePayload } = optionsRef.current;
    try {
      const res = await fetch(build(trimmed), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Search request failed (${res.status})`);
      }
      const items = parsePayload(await res.json());

      const cache = cacheRef.current;
      cache.set(trimmed.toLowerCase(), items);
      if (cache.size > MAX_CACHE_ENTRIES) {
        // Map itera por orden de inserción: la primera clave es la más vieja.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }

      setResults(items);
      setError(false);
      setLoading(false);
    } catch {
      // Si la abortó una petición más nueva no tocamos el estado: apagar el
      // loading aquí borraría el de la que sigue en vuelo.
      if (controller.signal.aborted) {
        return;
      }
      setResults([]);
      setError(true);
      setLoading(false);
    }
  }, []);

  const search = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      const trimmed = value.trim();
      if (trimmed.length < minLength) {
        cancelPending();
        setResults([]);
        setLoading(false);
        setError(false);
        return;
      }

      const cached = cacheRef.current.get(trimmed.toLowerCase());
      if (cached) {
        cancelPending();
        setResults(cached);
        setLoading(false);
        setError(false);
        return;
      }

      setLoading(true);
      setError(false);
      debounceRef.current = setTimeout(() => run(trimmed), delayMs);
    },
    [cancelPending, delayMs, minLength, run]
  );

  const submit = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      return;
    }

    const cached = cacheRef.current.get(trimmed.toLowerCase());
    if (cached) {
      setResults(cached);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    run(trimmed);
  }, [minLength, query, run]);

  const reset = useCallback(() => {
    cancelPending();
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(false);
  }, [cancelPending]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
    },
    []
  );

  return { error, loading, query, reset, results, search, submit };
}
