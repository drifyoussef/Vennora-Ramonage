import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/layouts/app-layout";
import { ApiError } from "@/lib/api";
import { LoginPage } from "@/pages/connexion";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Revenir sur un écran déjà vu l'affiche aussitôt, puis le rafraîchit
      // en arrière-plan s'il date de plus de 30 secondes.
      staleTime: 30_000,
      // Une erreur métier (introuvable, interdit) ne se corrige pas en
      // réessayant ; une coupure réseau, si.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

/**
 * Chargement à la demande : chaque écran est un fichier séparé, téléchargé
 * la première fois qu'on l'ouvre. La coquille et la connexion restent dans le
 * fichier principal pour s'afficher sans attente ; un technicien qui ne va
 * jamais dans les paramètres ne télécharge jamais leur code.
 */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

/** Le temps de télécharger l'écran demandé au premier affichage. */
function ScreenLoading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center" aria-busy="true">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Chargement" />
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/connexion", element: <LoginPage /> },
  {
    element: <AppLayout />,
    HydrateFallback: ScreenLoading,
    children: [
      { path: "/", lazy: page(() => import("@/pages/tableau-de-bord"), "DashboardPage") },
      { path: "/interventions", lazy: page(() => import("@/pages/interventions"), "InterventionsPage") },
      { path: "/interventions/nouvelle", lazy: page(() => import("@/pages/intervention/intervention-nouvelle"), "NewInterventionPage") },
      { path: "/interventions/:id", lazy: page(() => import("@/pages/intervention/intervention"), "InterventionPage") },
      { path: "/interventions/:id/modifier", lazy: page(() => import("@/pages/intervention/intervention-modifier"), "EditInterventionPage") },
      { path: "/planning", lazy: page(() => import("@/pages/planning/planning"), "PlanningPage") },
      { path: "/clients", lazy: page(() => import("@/pages/clients"), "CustomersPage") },
      { path: "/clients/nouveau", lazy: page(() => import("@/pages/client/client-nouveau"), "NewCustomerPage") },
      { path: "/clients/import", lazy: page(() => import("@/pages/client/client-import"), "ImportCustomersPage") },
      { path: "/clients/:id", lazy: page(() => import("@/pages/client/client"), "CustomerPage") },
      { path: "/clients/:id/modifier", lazy: page(() => import("@/pages/client/client-modifier"), "EditCustomerPage") },
      { path: "/sites", lazy: page(() => import("@/pages/sites"), "SitesPage") },
      { path: "/sites/nouveau", lazy: page(() => import("@/pages/site/site-nouveau"), "NewSitePage") },
      { path: "/sites/:id", lazy: page(() => import("@/pages/site/site"), "SitePage") },
      { path: "/sites/:id/modifier", lazy: page(() => import("@/pages/site/site-modifier"), "EditSitePage") },
      { path: "/equipements", lazy: page(() => import("@/pages/equipements"), "EquipmentsPage") },
      { path: "/equipements/nouveau", lazy: page(() => import("@/pages/equipement/equipement-nouveau"), "NewEquipmentPage") },
      { path: "/equipements/:id", lazy: page(() => import("@/pages/equipement/equipement"), "EquipmentPage") },
      { path: "/equipements/:id/modifier", lazy: page(() => import("@/pages/equipement/equipement-modifier"), "EditEquipmentPage") },
      { path: "/rappels", lazy: page(() => import("@/pages/rappels/rappels"), "RemindersPage") },
      { path: "/anomalies", lazy: page(() => import("@/pages/anomalies"), "AnomaliesPage") },
      { path: "/documents", lazy: page(() => import("@/pages/documents"), "DocumentsPage") },
      { path: "/scanner", lazy: page(() => import("@/pages/scanner/scanner"), "ScannerPage") },
      { path: "/e/:token", lazy: page(() => import("@/pages/scanner/qr-resolution"), "QrResolvePage") },
      { path: "/parametres", lazy: page(() => import("@/pages/parametres/parametres"), "SettingsPage") },
      { path: "/parametres/equipe/nouveau", lazy: page(() => import("@/pages/parametres/membre-nouveau"), "NewMemberPage") },
      { path: "/parametres/equipe/:id/modifier", lazy: page(() => import("@/pages/parametres/membre-modifier"), "EditMemberPage") },
      { path: "/profil", lazy: page(() => import("@/pages/profil/profil"), "ProfilePage") },
      { path: "*", lazy: page(() => import("@/pages/introuvable"), "NotFoundPage") },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
