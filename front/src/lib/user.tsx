import { createContext, useContext } from "react";
import type { CurrentUser } from "@vennora/back/types";

/**
 * Utilisateur connecté, fourni par la coquille authentifiée (`AppLayout`).
 * Sert à l'affichage — masquer un bouton qu'on n'a pas le droit d'utiliser.
 * Le contrôle d'accès réel est fait par l'API.
 */
export const UserContext = createContext<CurrentUser | null>(null);

export function useUser(): CurrentUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser() appelé hors de la coquille authentifiée.");
  return user;
}
