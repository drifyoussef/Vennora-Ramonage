import { Construction } from "lucide-react";
import { useLocation } from "react-router";
import { EmptyState } from "@/components/vennora/page";

/**
 * Écran provisoire, le temps de la refonte : la page existe dans l'ancienne
 * application et n'a pas encore été portée.
 */
export function NotPortedYet() {
  const { pathname } = useLocation();
  return (
    <EmptyState
      icon={Construction}
      title="Écran en cours de portage"
      description={`« ${pathname} » fonctionne encore dans l'ancienne application, et arrive bientôt ici.`}
    />
  );
}
