import { useState, useTransition } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

/**
 * Confirmation de suppression.
 *
 * Quand la suppression emporte des données rattachées (les sites et
 * équipements d'un client, par exemple), on demande de retaper le nom :
 * cliquer « Supprimer » deux fois de suite est un réflexe, retaper un nom
 * ne l'est pas.
 */
export function ConfirmDelete({
  action,
  entityName,
  title,
  description,
  redirectTo,
  requireTyping = false,
  triggerLabel = "Supprimer",
  triggerVariant = "outline",
}: {
  /** Appel de suppression à l'API ; lève une `ApiError` en cas de refus. */
  action: () => Promise<unknown>;
  entityName: string;
  title: string;
  description: string;
  redirectTo: string;
  requireTyping?: boolean;
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "destructive";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const confirmed = !requireTyping || typed.trim() === entityName;

  function onConfirm() {
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "La suppression a échoué.");
        return;
      }
      toast.success(`${entityName} supprimé.`);
      setOpen(false);
      // Les listes et fiches qui montraient l'élément sont à relire.
      await queryClient.invalidateQueries();
      navigate(redirectTo);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          className="gap-1.5 text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-pretty">
            {description}
          </DialogDescription>
        </DialogHeader>

        {requireTyping && (
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Saisissez <span className="font-medium">{entityName}</span> pour
              confirmer
            </Label>
            <Input
              id="confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-11"
            />
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Annuler
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!confirmed || pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Supprimer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
