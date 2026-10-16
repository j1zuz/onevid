# apps/tv-tizen — onevid para Samsung Tizen TV

App Samsung Tizen TV de tipo **hosted**: el paquete `.wgt` es un stub (`index.html`)
que abre `https://onevid.hackw.tech` en el navegador del TV. Misma web que LG
(`apps/tv`) y escritorio. Equivalente Samsung del paquete LG.

| | LG (apps/tv) | Samsung (apps/tv-tizen) |
|---|---|---|
| Paquete | `.ipk` | `.wgt` |
| Manifiesto | `appinfo.json` | `config.xml` |
| Herramienta | `ares` CLI | `tizen` CLI (Tizen Studio) |
| Portal | Seller Lounge | Samsung Apps TV Seller Office |

## 1. Requisitos (una sola vez)

- **Cuenta Samsung** + alta en **Samsung Apps TV Seller Office** (seller.samsungapps.com/tv). HECHO.
- **Tizen Studio** (o Tizen CLI). Incluye `tizen` (empaquetar) y `sdb` (conectar TV).
  - Descarga: https://developer.tizen.org/development/tizen-studio/download
  - OJO Java: Tizen pide **JDK 8/11/17**; este equipo tiene Java 27 → instalar un JDK 17
    y apuntarlo (como se hizo con Node en LG).
- **Certificados Author + Distributor**: se generan con el **Certificate Manager** de
  Tizen Studio (ligados a tu cuenta Samsung). Samsung NO instala un `.wgt` sin firmar.

## 2. Empaquetar el .wgt

Con Tizen CLI en el PATH, desde esta carpeta:

```sh
# 1) Firmar/definir perfil de certificados (una vez), p.ej. perfil "onevid":
tizen security-profiles add -n onevid -a <author.p12> -p <pass> -d <distributor.p12> -dp <pass>

# 2) Empaquetar (genera onevid.wgt firmado):
tizen package -t wgt -s onevid -- .
```

El `.wgt` resultante es lo que se sube en el Seller Office → App Package → "Choose a file".

## 3. Probar (sin TV fisico)

- **Emulador de TV** de Tizen Studio (TV emulator image), o
- **Samsung TV real** en modo desarrollador (`sdb connect <ip>` → `tizen install`).
- Mismo requisito que LG: confirmar login (codigo de dispositivo) y **reproduccion**.

## Notas

- `config.xml` usa `required_version 6.0` (Samsung TV 2021+). Subir/bajar para cambiar
  el rango de modelos soportados.
- Los valores `id`/`package` de `config.xml` son un punto de partida; Tizen Studio puede
  reasignarlos al importar. Deben mantener la forma `<package>.<appName>`.
- El icono es 512x512 (`icon.png`), generado del logo onevid sobre fondo #09090b.
- URL destino en `index.html` → `ONEVID_TV_URL`.
