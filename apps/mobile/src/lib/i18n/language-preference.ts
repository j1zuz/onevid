import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import i18next from '@/lib/i18n';
import { SUPPORTED_CODES, type SupportedLanguage } from './languages';

// Override manual de idioma elegido por el usuario en Perfil. null = seguir el
// idioma del dispositivo (comportamiento por defecto: no forzamos ninguno). Solo
// cuando el usuario elige uno explícitamente lo persistimos y pasa a mandar por
// encima del locale del dispositivo.
const LANG_KEY = 'onevid_language';

let current: SupportedLanguage | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function getLanguageOverride(): SupportedLanguage | null {
  return current;
}

// Lee el override persistido a memoria (una vez, al arrancar). Devuelve el valor
// resuelto para que quien llame pueda aplicarlo de inmediato.
export async function loadLanguageOverride(): Promise<SupportedLanguage | null> {
  const raw = await SecureStore.getItemAsync(LANG_KEY);
  current =
    raw && (SUPPORTED_CODES as readonly string[]).includes(raw)
      ? (raw as SupportedLanguage)
      : null;
  notify();
  return current;
}

// Fija el idioma elegido: persiste, cambia i18next y notifica a los suscriptores
// (el layout re-aplica el idioma; la UI de Perfil refleja la selección).
export async function setLanguageOverride(code: SupportedLanguage): Promise<void> {
  current = code;
  await SecureStore.setItemAsync(LANG_KEY, code);
  await i18next.changeLanguage(code);
  notify();
}

/**
 * Suscribe a cambios del override y carga el valor persistido al montar.
 * Devuelve el override actual (null → seguir el idioma del dispositivo).
 */
export function useLanguageOverride(): SupportedLanguage | null {
  const [value, setValue] = useState<SupportedLanguage | null>(current);
  useEffect(() => {
    let cancelled = false;
    loadLanguageOverride().then((v) => {
      if (!cancelled) setValue(v);
    });
    const listener = () => setValue(getLanguageOverride());
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);
  return value;
}
