import { useDocumentTitle } from "@/lib/title";
import { RequirePermission } from "@/components/vennora/require-permission";
import { HeaderSkeleton } from "@/components/vennora/skeletons";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";

import { PageHeader } from "@/components/vennora/page";
import { nextFreeColor } from "@vennora/core/palette";
import { UserForm } from "./user-form";

export function NewMemberPage() {
  return (
    <RequirePermission permission="user.manage">
      <NewMember />
    </RequirePermission>
  );
}

function NewMember() {
  useDocumentTitle("Nouveau membre");
  const query = useApiQuery<(string | null)[]>("/api/equipe/couleurs");
  const state = pageState(query, <HeaderSkeleton withAction={false} />);
  if (state) return state;
  const used = query.data!.map((colorHex) => ({ colorHex }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Ajouter un membre"
        description="Créez un accès pour un technicien ou un administrateur de l'entreprise."
        breadcrumbs={[
          { label: "Paramètres", href: "/parametres" },
          { label: "Nouveau membre" },
        ]}
      />
      <UserForm
        defaultColor={nextFreeColor(used.map((u) => u.colorHex))}
        cancelHref="/parametres"
      />
    </div>
  );
}
