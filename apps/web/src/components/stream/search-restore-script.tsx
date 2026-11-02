import {
  SEARCH_INPUT_ID,
  SEARCH_STORAGE_KEY,
} from "@/lib/search-storage";

/**
 * Repone la última búsqueda guardada directo en el input durante el parseo del
 * HTML, antes de que React hidrate y del primer pintado. Sin esto la página se
 * vería con el buscador vacío y luego "saltaría" al valor guardado.
 *
 * Es un Server Component a propósito: un `<script>` renderizado desde un
 * componente cliente provoca el aviso de React "Scripts inside React components
 * are never executed when rendering on the client". Aquí se emite una sola vez
 * con el HTML del servidor.
 */
export function SearchRestoreScript() {
  const script = `(()=>{try{const q=localStorage.getItem("${SEARCH_STORAGE_KEY}");if(!q)return;const el=document.getElementById("${SEARCH_INPUT_ID}");if(el instanceof HTMLInputElement){el.value=q}}catch{}})()`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
