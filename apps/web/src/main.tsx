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
import { CustomersPage } from "@/pages/clients";
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
      { path: "/clients", element: <CustomersPage /> },
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
