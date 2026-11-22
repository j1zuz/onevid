const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

/**
 * `runtimeVersion` ligado a la capa nativa: la versión más un hash de los
 * archivos que la definen. Un OTA solo llega a builds con el mismo valor, así
 * que un update que trae una librería nativa nueva ya no alcanza a un binario
 * compilado sin ella (que crashearía al arrancar).
 *
 * No se usa `policy: fingerprint` porque hashea `node_modules` y en este
 * monorepo bun el hash local y el de EAS no coinciden (ver da5b77d). Aquí solo
 * entran archivos versionados en git, que ambos entornos leen igual; los saltos
 * de línea se normalizan por si alguien publica desde Windows.
 *
 * Cualquier cambio en dependencias, `app.json`, `app.config.ts`, `plugins/`,
 * `patches/` o este archivo cambia el runtime: los builds existentes dejan de
 * recibir OTAs y hay que compilar uno nuevo.
 *
 * Es JS (y no parte de `app.config.ts`) para no meter los tipos de Node en el
 * typecheck de la app.
 *
 * @param {string} projectRoot carpeta de la app (`apps/mobile`)
 * @param {string} version versión de la variante
 * @returns {string}
 */
function nativeRuntimeVersion(projectRoot, version) {
  const repoRoot = path.join(projectRoot, '..', '..');
  const readText = (file) =>
    readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const readDir = (dir) =>
    readdirSync(dir)
      .sort()
      .map((name) => [name, readText(path.join(dir, name))]);
  const appPackage = JSON.parse(
    readText(path.join(projectRoot, 'package.json')),
  );
  const rootPackage = JSON.parse(readText(path.join(repoRoot, 'package.json')));

  const inputs = {
    appJson: readText(path.join(projectRoot, 'app.json')),
    appConfig: readText(path.join(projectRoot, 'app.config.ts')),
    script: readText(
      path.join(projectRoot, 'scripts', 'native-runtime-version.js'),
    ),
    dependencies: appPackage.dependencies,
    devDependencies: appPackage.devDependencies,
    overrides: rootPackage.overrides,
    patchedDependencies: rootPackage.patchedDependencies,
    plugins: readDir(path.join(projectRoot, 'plugins')),
    patches: readDir(path.join(repoRoot, 'patches')),
  };
  const hash = createHash('sha256')
    .update(JSON.stringify(inputs))
    .digest('hex')
    .slice(0, 12);
  return `${version}-${hash}`;
}

module.exports = { nativeRuntimeVersion };
