import { useQueryClient } from "@tanstack/react-query";
import type { ActionResult } from "@vennora/core/errors";
import { ApiError } from "./api";

/**
 * Appel d'écriture, rendu sous la forme des anciens résultats d'action :
 * `{ ok: true, data }` ou `{ ok: false, error, code, fieldErrors }`. Les
 * formulaires affichent ainsi les erreurs champ par champ renvoyées par
 * l'API sans rien changer à leur logique.
 */
export async function act<T>(call: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (e) {
    if (e instanceof ApiError) {
      const hasFields = Object.keys(e.fieldErrors ?? {}).length > 0;
      return {
        ok: false,
        error: e.message,
        code: e.code,
        ...(hasFields ? { fieldErrors: e.fieldErrors } : {}),
      };
    }
    return {
      ok: false,
      error: "Une erreur est survenue. Réessayez dans un instant.",
      code: "INTERNAL",
    };
  }
}

/** Le contenu d'un formulaire, prêt à partir en JSON. */
export function formJson(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData);
}

/**
 * Après une écriture, les écrans qui montraient les données sont à relire :
 * l'équivalent du `router.refresh()` de l'ancienne application. Les écrans
 * affichés se rechargent aussitôt, les autres à leur prochaine ouverture.
 */
export function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}
