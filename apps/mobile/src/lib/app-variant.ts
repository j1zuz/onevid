import { applicationId } from 'expo-application';
import Constants from 'expo-constants';

/**
 * Variante real del build instalado: `development` (la app "onevid Dev" que se
 * pasa a los testers y el dev client del equipo) o `production`.
 *
 * Se deriva del identificador nativo (`applicationId`) y NO de
 * `Constants.expoConfig.extra.appVariant`: en un development build el config se
 * descarga del dev server, así que `extra` refleja el entorno con el que corre
 * el servidor, no la identidad con la que se compiló la app. El identificador,
 * en cambio, está horneado en el binario y no cambia.
 *
 * En Expo Go no hay identidad propia (todo corre bajo `host.exp.exponent`), así
 * que se trata como desarrollo.
 */
export type AppVariant = 'development' | 'production';

const PRODUCTION_ID = 'tech.hackw.onevid';
const DEV_SUFFIX = '.dev';

function resolveAppVariant(): AppVariant {
  const id = applicationId ?? '';
  if (!id || Constants.expoGoConfig != null || id.endsWith(DEV_SUFFIX)) {
    return 'development';
  }
  return id === PRODUCTION_ID ? 'production' : 'development';
}

export const appVariant: AppVariant = resolveAppVariant();

export const isDevelopmentBuild = appVariant === 'development';
export const isProductionBuild = appVariant === 'production';
