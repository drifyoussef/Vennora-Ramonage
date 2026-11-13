import type { ReactNode } from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { QueryError } from "@/components/vennora/query-error";
import { api } from "./api";

/**
 * Lecture d'une route de l'API, mise en cache sous son chemin complet
 * (chaîne de requête comprise) : revenir sur un écran déjà vu l'affiche
 * aussitôt. Pendant un changement de filtre ou de page, les données
 * précédentes restent affichées plutôt qu'un squelette qui clignote.
 */
export function useApiQuery<T>(path: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api.get<T>(path),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  });
}

/**
 * Écran de chargement ou d'erreur d'une page, ou `null` quand les données
 * sont là : `const state = pageState(q, <Squelette />); if (state) return state;`
 */
export function pageState(query: UseQueryResult<unknown>, skeleton: ReactNode): ReactNode | null {
  if (query.isPending) return skeleton;
  if (query.isError) return <QueryError error={query.error} onRetry={() => query.refetch()} />;
  return null;
}
