# onevid — UX Scenario (borrador para LG Seller Lounge)

> Documento que el revisor de LG usa para probar la app. Es un BORRADOR: revisa
> los pasos contra el comportamiento real en un TV antes de enviar. Las
> credenciales de prueba se entregan por el campo seguro de Seller Lounge, nunca
> en este archivo.

## Resumen

onevid es un reproductor de video por streaming. La app corre en el navegador del
TV (app web hosted) y se controla con el mando a distancia (D-pad + OK + Atrás).

## Credenciales de prueba

- Se proveen en Seller Lounge (cuenta de demo con catálogo ya configurado).
- El inicio de sesión es por **código de dispositivo** (no se escribe email/clave
  en el TV): la TV muestra un código y el usuario lo aprueba desde un teléfono.

## Recorrido paso a paso

1. **Arranque**: al abrir la app aparece la pantalla de inicio de sesión con un
   código QR y un código de 8 caracteres.
2. **Autorizar la TV**:
   - Opción A: escanear el QR con el teléfono → abre la página de aprobación con
     el código ya puesto.
   - Opción B: entrar en la URL mostrada e ingresar el código manualmente.
   - Iniciar sesión con las credenciales de prueba y pulsar "Aprobar".
   - La TV detecta la aprobación y entra al catálogo automáticamente.
3. **Navegar el catálogo** (mando): moverse con el D-pad entre el carrusel
   destacado y las filas ("Continuar viendo", etc.). El elemento enfocado se
   resalta. Pulsar OK sobre un título abre su detalle.
4. **Reproducir**: en el detalle, pulsar "Reproducir". El video arranca a
   pantalla completa. Controles por mando: Play/Pausa, avance/retroceso, Atrás
   para volver.
5. **Volver y salir**: el botón Atrás del mando navega hacia atrás por las
   pantallas; desde el inicio, Atrás sale de la app.

## Notas para el revisor

- Requiere conexión a internet (la app carga contenido por red).
- El código de inicio de sesión caduca; si expira, la app genera uno nuevo solo.
