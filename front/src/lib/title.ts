import { useEffect } from "react";

/** Titre de l'onglet : « Clients · Vennora Ramonage ». */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Vennora Ramonage` : "Vennora Ramonage";
  }, [title]);
}
