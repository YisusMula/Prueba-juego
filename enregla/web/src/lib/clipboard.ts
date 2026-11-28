/**
 * Copia un texto al portapapeles. Debe llamarse directamente desde el manejador del clic.
 * Si el navegador no lo permite (permisos, marco restringido…), selecciona el texto del elemento
 * indicado para que la persona pueda copiarlo a mano, y devuelve false.
 */
export async function copyText(text: string, fallbackEl?: HTMLElement | null): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Portapapeles no disponible');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      try {
        const range = document.createRange();
        range.selectNodeContents(fallbackEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        // sin selección posible: el texto sigue visible
      }
    }
    return false;
  }
}
