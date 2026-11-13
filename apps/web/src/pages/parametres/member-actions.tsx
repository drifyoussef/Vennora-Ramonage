import { useTransition } from "react";
import { useNavigate } from "react-router";
import { act, formJson, useRefresh } from "@/lib/actions";
import { api } from "@/lib/api";
import { Link } from "react-router";
import { Loader2, MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MemberActions({
  userId,
  fullName,
  active,
  isSelf,
}: {
  userId: string;
  fullName: string;
  active: boolean;
  isSelf: boolean;
}) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await act(() => api.post<{ id: string; active: boolean }>(`/api/equipe/${userId}/actif`, { active: !active }));
      if (result.ok) {
        toast.success(
          result.data.active
            ? `${fullName} peut à nouveau se connecter.`
            : `${fullName} n'a plus accès à Vennora.`,
        );
        await refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`Actions pour ${fullName}`}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to={`/parametres/equipe/${userId}/modifier`}>
            <Pencil className="size-4" />
            Modifier
          </Link>
        </DropdownMenuItem>

        {/* Se désactiver soi-même verrouillerait l'entreprise hors de son
            propre compte : l'action est retirée plutôt que refusée. */}
        {!isSelf && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={toggle}
              variant={active ? "destructive" : "default"}
            >
              {active ? (
                <>
                  <UserX className="size-4" />
                  Désactiver l&apos;accès
                </>
              ) : (
                <>
                  <UserCheck className="size-4" />
                  Réactiver l&apos;accès
                </>
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
