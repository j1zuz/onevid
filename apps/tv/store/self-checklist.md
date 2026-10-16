# onevid — Self-Checklist (borrador para LG Seller Lounge)

> LG EXIGE subir su propia plantilla de self-checklist rellenada con resultados
> REALES de prueba. Esta es una guía previa para no llegar con huecos. Los ítems
> marcados ❌/⚠️ NO se pueden dar por buenos hasta probar en un TV LG físico.
> Descarga la plantilla oficial desde Seller Lounge y vuelca ahí estos resultados.

## Estado de verificación (al día de hoy)

| Ítem | Estado | Nota |
|------|--------|------|
| La app empaqueta a `.ipk` sin errores | ✅ | `ares-package` OK, sin aviso de ACG |
| `appinfo.json` con `requiredACG` | ✅ | `[]` (no usa Luna APIs) |
| Iconos (80×80, 130×130) y splash (1920×1080) | ✅ | logo onevid real, 8-bit PNG |
| Carga de la app en el navegador del TV | ⚠️ | visto en simulador webOS 26; falta TV físico |
| **Inicio de sesión (código de dispositivo) en el TV** | ❌ | probado en navegador de escritorio; **falta en TV** |
| **Reproducción de video en el TV** (el ítem crítico) | ❌ | `<video>` nativo; **sin probar en hardware** |
| Navegación completa solo con el mando (D-pad + OK + Atrás) | ⚠️ | D-pad global ya activo; validar en TV real |
| Botón Atrás: navega atrás y sale desde el inicio | ❌ | validar en TV |
| Comportamiento sin red / con red lenta | ❌ | validar en TV |
| Sin textos de depuración ni placeholders visibles | ✅ | revisado |
| Cumple lineamientos de contenido de LG | ⚠️ | revisar catálogo de demo |

## Riesgos conocidos a cerrar antes de enviar

1. **Reproducción en TV**: confirmar que el `<video>` nativo reproduce las fuentes
   reales (MKV/HEVC/AC-3). Es lo que LG prueba en el "function test".
2. **DTS en modelos LG 2020+**: el audio DTS puede salir mudo (licencia retirada).
   Decidir: descartar fuentes DTS en TV o transcodificar solo audio en servidor.
3. **Cloudflare**: confirmar que `POST /api/auth/device/*` no recibe "managed
   challenge" desde el navegador del TV (si pasa, añadir regla WAF Skip).

## Pendiente administrativo

- Cuenta de LG Seller Lounge.
- Plantilla oficial de self-checklist (se descarga de Seller Lounge).
- UX scenario (ver `ux-scenario.md`).
- Capturas/íconos de tienda (icono 400×400 que LG redimensiona).
