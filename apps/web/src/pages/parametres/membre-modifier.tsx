import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { useParams } from "react-router";
import type { TeamMember } from "@vennora/api/types";
import { DetailSkeleton, HeaderSkeleton } from "@/components/vennora/skeletons";
import { RequirePermission } from "@/components/vennora/require-permission";

import { PageHeader } from "@/components/vennora/page";
import { USER_ROLE_LABEL } from "@vennora/core/labels";
import { TEAM_COLORS } from "@vennora/core/palette";
import { objectId } from "@vennora/core/schemas";
import { formatDate } from "@vennora/core/format";
import { UserForm } from "./user-form";
import { ResetPassword } from "./reset-password";

export function EditMemberPage() {
  return (
    <RequirePermission permission="user.manage">
      <EditMember />
    </RequirePermission>
  );
}

function EditMember() {
  useDocumentTitle("Modifier le membre");
  const actor = useUser();
  const { id = "" } = useParams();
  const query = useApiQuery<TeamMember>(`/api/equipe/${id}`);
  const state = pageState(
    query,
    <>
      <HeaderSkeleton withAction={false} />
      <DetailSkeleton panels={2} aside={false} />
    </>,
  );
  if (state) return state;
  const member = query.data!;

  const fullName = `${member.firstName} ${member.lastName}`;
  const isSelf = member.id === actor.id;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={fullName}
        description={`${USER_ROLE_LABEL[member.role]} · dans l'équipe depuis le ${formatDate(member.createdAt)}${
          member.lastLoginAt
            ? ` · dernière connexion le ${formatDate(member.lastLoginAt)}`
            : " · jamais connecté"
        }`}
        breadcrumbs={[
          { label: "Paramètres", href: "/parametres" },
          { label: fullName },
        ]}
      />

      <UserForm
        initial={member}
        defaultColor={member.colorHex ?? TEAM_COLORS[0].hex}
        isSelf={isSelf}
        cancelHref="/parametres"
      />

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="font-heading text-base font-semibold">Mot de passe</h2>
        <p className="mt-1 mb-4 max-w-prose text-sm text-muted-foreground text-pretty">
          {isSelf
            ? "Pour changer votre propre mot de passe, passez par votre profil : l'ancien mot de passe y est demandé."
            : "À utiliser si le mot de passe a été oublié, ou en urgence si un téléphone a été perdu."}
        </p>
        {!isSelf && <ResetPassword userId={member.id} fullName={fullName} />}
      </section>
    </div>
  );
}
