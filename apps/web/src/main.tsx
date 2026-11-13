import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/layouts/app-layout";
import { ApiError } from "@/lib/api";
import { NotPortedYet } from "@/pages/a-porter";
import { AnomaliesPage } from "@/pages/anomalies";
import { CustomerPage } from "@/pages/client/client";
import { CustomersPage } from "@/pages/clients";
import { DocumentsPage } from "@/pages/documents";
import { EquipmentPage } from "@/pages/equipement/equipement";
import { EquipmentsPage } from "@/pages/equipements";
import { InterventionsPage } from "@/pages/interventions";
import { PlanningPage } from "@/pages/planning/planning";
import { RemindersPage } from "@/pages/rappels/rappels";
import { SitePage } from "@/pages/site/site";
import { SitesPage } from "@/pages/sites";
import { DashboardPage } from "@/pages/tableau-de-bord";
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

const router = createBrowserRouter([
  { path: "/connexion", element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/interventions", element: <InterventionsPage /> },
      { path: "/planning", element: <PlanningPage /> },
      { path: "/clients", element: <CustomersPage /> },
      { path: "/clients/:id", element: <CustomerPage /> },
      { path: "/sites", element: <SitesPage /> },
      { path: "/sites/:id", element: <SitePage /> },
      { path: "/equipements", element: <EquipmentsPage /> },
      { path: "/equipements/:id", element: <EquipmentPage /> },
      { path: "/rappels", element: <RemindersPage /> },
      { path: "/anomalies", element: <AnomaliesPage /> },
      { path: "/documents", element: <DocumentsPage /> },
      // Écrans de saisie, étape 3 : déclarés explicitement pour ne pas être
      // pris pour une fiche dont l'identifiant serait « nouveau ».
      ...["/clients/nouveau", "/clients/import", "/sites/nouveau", "/equipements/nouveau", "/interventions/nouvelle"].map(
        (path) => ({ path, element: <NotPortedYet /> }),
      ),
      { path: "*", element: <NotPortedYet /> },
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
