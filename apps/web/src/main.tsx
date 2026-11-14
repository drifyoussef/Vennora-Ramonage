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
import { AnomaliesPage } from "@/pages/anomalies";
import { CustomerPage } from "@/pages/client/client";
import { EditCustomerPage } from "@/pages/client/client-modifier";
import { NewCustomerPage } from "@/pages/client/client-nouveau";
import { ImportCustomersPage } from "@/pages/client/client-import";
import { EditMemberPage } from "@/pages/parametres/membre-modifier";
import { NewMemberPage } from "@/pages/parametres/membre-nouveau";
import { SettingsPage } from "@/pages/parametres/parametres";
import { ProfilePage } from "@/pages/profil/profil";
import { EditEquipmentPage } from "@/pages/equipement/equipement-modifier";
import { NewEquipmentPage } from "@/pages/equipement/equipement-nouveau";
import { InterventionPage } from "@/pages/intervention/intervention";
import { EditInterventionPage } from "@/pages/intervention/intervention-modifier";
import { QrResolvePage } from "@/pages/scanner/qr-resolution";
import { ScannerPage } from "@/pages/scanner/scanner";
import { NotFoundPage } from "@/pages/introuvable";
import { NewInterventionPage } from "@/pages/intervention/intervention-nouvelle";
import { EditSitePage } from "@/pages/site/site-modifier";
import { NewSitePage } from "@/pages/site/site-nouveau";
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
      { path: "/clients/nouveau", element: <NewCustomerPage /> },
      { path: "/clients/:id/modifier", element: <EditCustomerPage /> },
      { path: "/sites/nouveau", element: <NewSitePage /> },
      { path: "/sites/:id/modifier", element: <EditSitePage /> },
      { path: "/equipements/nouveau", element: <NewEquipmentPage /> },
      { path: "/equipements/:id/modifier", element: <EditEquipmentPage /> },
      { path: "/interventions/nouvelle", element: <NewInterventionPage /> },
      { path: "/interventions/:id", element: <InterventionPage /> },
      { path: "/scanner", element: <ScannerPage /> },
      { path: "/e/:token", element: <QrResolvePage /> },
      { path: "/interventions/:id/modifier", element: <EditInterventionPage /> },
      { path: "/clients/import", element: <ImportCustomersPage /> },
      { path: "/parametres", element: <SettingsPage /> },
      { path: "/parametres/equipe/nouveau", element: <NewMemberPage /> },
      { path: "/parametres/equipe/:id/modifier", element: <EditMemberPage /> },
      { path: "/profil", element: <ProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
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
