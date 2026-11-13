import type { DocumentList } from "@vennora/api/types";
import { HeaderSkeleton, TableSkeleton } from "@/components/vennora/skeletons";
import { useDocumentTitle } from "@/lib/title";
import { useUser } from "@/lib/user";
import { pageState, useApiQuery } from "@/lib/query";
import { Link } from "react-router";
import { Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/vennora/page";
import { DOCUMENT_CATEGORY_LABEL, plural } from "@vennora/core/labels";
import { can } from "@vennora/core/permissions";
import { formatDate } from "@vennora/core/format";
import { formatSize } from "@vennora/core/bytes";
import { DeleteDocument, DocumentUpload } from "./documents/document-upload";

export function DocumentsPage() {
  useDocumentTitle("Documents");
  const user = useUser();
  // Les liens sont signés par l'API et expirent : aucune URL de document
  // n'est stable.
  const result = useApiQuery<DocumentList>("/api/documents");
  const state = pageState(
    result,
    <>
      <HeaderSkeleton withAction={false} />
      <TableSkeleton rows={8} />
    </>,
  );
  if (state) return state;
  const { documents, customers } = result.data!;

  const canUpload = can(user.role, "document.upload");
  const canDelete = can(user.role, "document.delete");

  return (
    <>
      <PageHeader
        title="Documents"
        description="Rapports, devis, certificats et pièces rattachés à vos clients."
        actions={
          canUpload && <DocumentUpload customers={customers} />
        }
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucun document"
          description="Les rapports d'intervention validés sont rangés ici automatiquement. Vous pouvez aussi ajouter un devis, une facture ou un certificat."
          action={canUpload && <DocumentUpload customers={customers} />}
        />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />

                <div className="min-w-0 flex-1">
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {document.name}
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {document.customer ? (
                      <Link
                        to={`/clients/${document.customer.id}`}
                        className="hover:underline"
                      >
                        {document.customer.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {document.intervention && (
                      <>
                        {" · "}
                        <Link
                          to={`/interventions/${document.intervention.id}`}
                          className="hover:underline"
                        >
                          {document.intervention.reference}
                        </Link>
                      </>
                    )}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {DOCUMENT_CATEGORY_LABEL[document.category]}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">
                  {formatSize(document.sizeBytes)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDate(document.createdAt)}
                </span>

                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                >
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Télécharger ${document.name}`}
                  >
                    <Download className="size-4" />
                  </a>
                </Button>

                {canDelete && (
                  <DeleteDocument id={document.id} name={document.name} />
                )}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-muted-foreground">
            {plural(documents.length, "document")}
          </p>
        </>
      )}
    </>
  );
}
