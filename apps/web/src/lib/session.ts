import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { CurrentUser } from "@vennora/api/types";
import { api, ApiError } from "./api";

/**
 * Session côté interface.
 *
 * L'interface ne décide de rien : elle demande à l'API qui est connecté
 * (`/api/auth/moi`), et l'API relit l'utilisateur en base à chaque requête.
 * Masquer un écran ici n'est qu'un confort — le contrôle d'accès est fait par
 * l'API, route par route.
 */

export const ME_KEY = ["moi"] as const;

/** Utilisateur connecté, ou `null`. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        const { user } = await api.get<{ user: CurrentUser }>("/api/auth/moi");
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.post<{ user: CurrentUser }>("/api/auth/connexion", credentials),
    onSuccess: ({ user }) => {
      // Rien de l'éventuelle session précédente ne doit rester en cache.
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api.post("/api/auth/deconnexion");
    } finally {
      // Les données de l'entreprise ne doivent pas survivre à la session.
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
      navigate("/connexion", { replace: true });
    }
  };
}
