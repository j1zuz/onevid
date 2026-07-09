import { Redirect } from 'expo-router';

// La ruta raíz "/" ya no muestra nada propio: la app vive en los tabs. Algunos
// flujos (p. ej. cerrar sesión) navegan a "/", así que redirigimos al tab Inicio,
// que decide entre "Reproducir video" (sin sesión) y el catálogo (con sesión).
export default function Index() {
  return <Redirect href="/home" />;
}
