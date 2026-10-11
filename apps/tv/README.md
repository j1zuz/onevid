# apps/tv — onevid para LG webOS (hito dev-mode)

App LG webOS de tipo **hosted**: el `.ipk` es un stub (`index.html`) que abre la web de
onevid (`https://onevid.hackw.tech`) dentro del navegador del TV. Es una **sonda de
medicion**, no el producto final — sirve para ver si el navegador del TV aguanta el stack
web actual y como se porta el mando a distancia. La **SPA empaquetada** dedicada viene en
el hito MVP.

webOS no ejecuta React Native, por eso la app de `apps/mobile` (Android TV) no sirve aqui.

## 1. Requisitos previos (una sola vez)

- Cuenta **LG Developer** gratuita: https://webostv.developer.lge.com
- **webOS CLI** — YA INSTALADO en esta maquina (`@webos-tools/cli@3.2.6`, verifica con
  `ares -V`). Para reinstalar o en otra maquina:
  - La doc de LG dice Node 14-16 pero esta DESACTUALIZADA: el CLI real exige **Node >= 20**.
    El Node 25 de `mise` de este equipo sirve; no hace falta nvm.
  - `npm install -g @webos-tools/cli && mise reshim` (el `reshim` crea los shims `ares-*`
    para que esten en el PATH de cualquier terminal).
  - Doc: https://webostv.developer.lge.com/develop/tools/cli-installation

> **Sin TV fisico (desarrollo en Linux):** usa SOLO el **Simulador** (paso 3). El flujo de
> "Developer Mode app" y el **paso 4** (TV real) NO aplican sin un televisor. El simulador
> es una ventana Chromium de escritorio con mando virtual: sirve para comprobar que
> empaqueta, que carga y para probar la navegacion con cruceta; **NO** mide el rendimiento
> real del TV ni los codecs/reproduccion reales (eso necesita hardware).

- Solo para TV real: en el TV, instala la app **Developer Mode** desde LG Content Store,
  inicia sesion con tu cuenta LG y activa **Dev Mode Status** (reinicia el TV). La sesion
  dev caduca; extiendela con **EXTEND**.

## 2. Empaquetar (genera el .ipk)

```sh
cd apps/tv
ares-package .
# -> tech.hackw.onevid_1.0.0_all.ipk
```

El `appinfo.json` ya incluye `"requiredACG": []` (obligatorio desde webOS TV 27 / mar-2027;
el CLI avisa desde sep-2026 si falta). Los PNG (`icon` 80x80, `largeIcon` 130x130, `splash`
1920x1080) son **marcadores** solidos; reemplazalos por el branding real antes de la tienda.

## 3. Probar en el simulador (unica via sin TV fisico)

El Simulador de Linux es un **AppImage** (dentro de un ZIP que descargas de la doc). En
Ubuntu 24+ / Wayland hay que lanzarlo con flags:

```sh
./webOS_TV_26_Simulator_<ver>.AppImage --ozone-platform=x11 --no-sandbox
```

`ares-launch -s` no puede pasar esos flags, asi que abre el AppImage directo (con los flags)
y **carga la app / el .ipk desde la interfaz del simulador**.

## 4. Probar en un TV real (Developer Mode) — SOLO si tienes TV fisico

Enlaza el TV una vez:

```sh
ares-setup-device            # add -> nombre "tv", IP del TV, puerto 9922, ssh user "prisoner", sin password
# en la app Developer Mode del TV pulsa "Key Server", luego:
ares-novacom --device tv --getkey   # introduce el passphrase de 6 chars que muestra el TV
ares-device --system-info --device tv   # confirma conexion
```

Instala y lanza:

```sh
ares-install -d tv tech.hackw.onevid_1.0.0_all.ipk
ares-launch  -d tv tech.hackw.onevid
```

Depurar (abre DevTools remotas):

```sh
ares-inspect -d tv -o tech.hackw.onevid
```

## 5. Que medir en el TV (entregable del hito)

- ¿Carga la web? ¿Cuanto tarda en arrancar?
- ¿Se puede navegar algo con la cruceta del mando? (la web es de raton; probable que no)
- ¿Reproduce un titulo (video.js) y con que fluidez?
- ¿Cloudflare bloquea la peticion del TV (managed challenge)? Si es asi, hay que añadir una
  regla WAF Skip.

Con esa medicion se decide el alcance de la SPA empaquetada (hito MVP).

## Notas

- Cambia la URL destino en `index.html` (`ONEVID_TV_URL`) si quieres apuntar a una ruta
  dedicada de TV en vez de la home.
- El nombre de dispositivo `tv` en los scripts/comandos es el que registras con
  `ares-setup-device`; ajustalo si usas otro.
