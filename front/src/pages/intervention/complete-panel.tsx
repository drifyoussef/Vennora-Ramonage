import { useState, useTransition } from "react";
import { act, formJson, useRefresh } from "@/lib/actions";
import { api } from "@/lib/api";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/vennora/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonths, formatDate, toDateInput } from "@vennora/shared/format";
import { cn } from "@/lib/utils";

/**
 * Clôture de l'intervention.
 *
 * Les deux prérequis — compte-rendu validé et signature du client — sont
 * affichés comme une liste de contrôle plutôt que cachés derrière un message
 * d'erreur : le technicien voit ce qui manque avant d'appuyer.
 *
 * La prochaine échéance est proposée à partir de la périodicité du type
 * d'intervention (§23), modifiable, et supprimable — toutes les interventions
 * ne se reconduisent pas.
 */
/**
 * Contenu du formulaire de clôture, avec la prochaine échéance convertie
 * ici en instant (9 h dans le fuseau de l'utilisateur) : le serveur, lui,
 * ne connaît que son propre fuseau.
 */
function closing(formData: FormData) {
  const values = formJson(formData);
  const date = typeof values.nextInterventionAt === "string" ? values.nextInterventionAt : "";
  const instant = date ? new Date(`${date}T09:00:00`) : null;
  return {
    ...values,
    prochaine: instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : undefined,
  };
}

export function CompletePanel({
  interventionId,
  hasValidatedReport,
  hasSignature,
  recurrenceMonths,
  baseDate,
}: {
  interventionId: string;
  hasValidatedReport: boolean;
  hasSignature: boolean;
  recurrenceMonths: number | null;
  baseDate: Date;
}) {
  const refresh = useRefresh();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [withNext, setWithNext] = useState(Boolean(recurrenceMonths));
  const [nextDate, setNextDate] = useState(
    toDateInput(addMonths(new Date(baseDate), recurrenceMonths ?? 12)),
  );

  const ready = hasValidatedReport && hasSignature;

  function onSubmit(formData: FormData) {
    setFormError(null);
    if (!withNext) formData.set("nextInterventionAt", "");

    startTransition(async () => {
      const result = await act(() => api.post<{ id: string }>(`/api/interventions/${interventionId}/cloture`, closing(formData)));
      if (result.ok) {
        toast.success("Intervention terminée.");
        await refresh();
      } else {
        setFormError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-heading mb-4 text-base font-semibold">
        Terminer l&apos;intervention
      </h2>

      <ul className="mb-5 space-y-2">
        <Requirement done={hasValidatedReport} label="Compte-rendu validé" />
        <Requirement done={hasSignature} label="Signature du client" />
      </ul>

      <form action={onSubmit} className="space-y-4">
        <FormError message={formError} />

        <div className="rounded-lg bg-muted/60 p-3.5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={withNext}
              onChange={(e) => setWithNext(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span className="text-sm">
              <span className="font-medium">
                Programmer un rappel de prochaine intervention
              </span>
              {recurrenceMonths && (
                <span className="mt-0.5 block text-muted-foreground">
                  Périodicité conseillée pour ce type : {recurrenceMonths} mois.
                </span>
              )}
            </span>
          </label>

          {withNext && (
            <div className="mt-3 max-w-xs">
              <Label htmlFor="nextInterventionAt">Date conseillée</Label>
              <Input
                id="nextInterventionAt"
                name="nextInterventionAt"
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                className="mt-1.5 h-11"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Soit {formatDate(new Date(`${nextDate}T09:00:00`))}. Le client
                n&apos;est pas relancé automatiquement : le rappel apparaît dans
                vos échéances.
              </p>
            </div>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={!ready || pending}
          className="h-12 w-full gap-2 sm:w-auto"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Terminer l&apos;intervention
        </Button>

        {!ready && (
          <p className="text-sm text-muted-foreground">
            Complétez les deux points ci-dessus pour pouvoir clôturer.
          </p>
        )}
      </form>
    </section>
  );
}

function Requirement({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border",
          done
            ? "border-status-done bg-status-done text-white"
            : "border-input text-transparent",
        )}
      >
        <CheckCircle2 className="size-3.5" />
      </span>
      <span className={done ? undefined : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
