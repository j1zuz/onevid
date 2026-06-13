# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   pnpm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Builds locales (gratis)

> ⚠️ **Importante:** `eas build` **sin** `--local` compila en la nube de Expo y **cobra por build**.
> Todos los comandos de abajo compilan en **tu máquina** y **no generan cargos**.
>
> Las versiones de **Apple (iOS / Apple TV) requieren una Mac con Xcode** y no pueden compilarse
> en Linux. Este proyecto está preparado para compilar **Android (teléfono) y Android TV** en local.

Esta app usa módulos nativos propios (`expo-libvlc-player`, `react-native-tvos`), por eso no
funciona en Expo Go: se necesita un *development build* propio (`expo-dev-client`). El switch
entre móvil y TV lo hace el plugin `@react-native-tvos/config-tv` leyendo la variable de
entorno `EXPO_TV` en tiempo de build.

### Comandos

| Objetivo | Móvil | Android TV |
| --- | --- | --- |
| Dev build + instalar (debug, lo más rápido) | `pnpm android` | `pnpm android:tv` |
| APK distribuible (sideload) | `pnpm build:android` | `pnpm build:android:tv` |
| AAB para Play Store | `pnpm build:android:prod` | `pnpm build:android:tv:prod` |
| Update OTA (sin recompilar) | `pnpm update` | `pnpm update:tv` |

- Los `expo run:*` (`pnpm android` / `pnpm android:tv`) son 100% locales y **no necesitan `eas-cli`**.
- Los `build:*` usan `eas build --local`: compilan en tu máquina (sin cobro) usando los
  perfiles de `eas.json`. Los perfiles `-tv` ya inyectan `EXPO_TV=1`.
- **EAS Update (OTA)** se conserva: es gratis hasta 1,000 usuarios activos/mes y **no** consume
  builds de pago. Para TV se antepone `EXPO_TV=1` para que el *fingerprint* coincida con el build de TV.

### Requisitos para compilar Android en local

- **JDK 17** (en Arch: `jdk17-openjdk`).
- **Android SDK** (Android Studio o `cmdline-tools`) con `ANDROID_HOME` exportado.
- Un **emulador** (AVD de teléfono y/o de Android TV) o un dispositivo real con depuración
  USB / `adb connect`.
- Solo para los scripts `build:*` y `update*`: `eas-cli` global (`npm i -g eas-cli`).

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
