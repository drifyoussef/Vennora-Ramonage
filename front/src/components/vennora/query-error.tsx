import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

/** Échec de chargement d'un écran : le dire, et proposer de réessayer. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError ? error.message : "Le chargement a échoué. Réessayez dans un instant.";
  return (
    <div
      role="alert"
      className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card px-6 py-8 text-center"
    >
      <AlertCircle className="size-6 text-destructive" />
      <p className="text-sm text-pretty">{message}</p>
      <Button variant="outline" onClick={onRetry} className="gap-1.5">
        <RotateCw className="size-4" />
        Réessayer
      </Button>
    </div>
  );
}
