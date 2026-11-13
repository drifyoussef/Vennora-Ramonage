import { can } from "@vennora/core/permissions";
import { maybeOne } from "../db";
import { fileUrl } from "../services/storage";
import type { AppContext } from "../context";

/**
 * Documents récents de l'entreprise, avec un lien de téléchargement.
 *
 * Les liens sont signés et expirent : aucune URL de document n'est stable,
 * et la clé de stockage ne quitte jamais le serveur.
 */
export async function listDocuments({ db, user }: AppContext) {
  const [rows, customers] = await Promise.all([
    db.document.find(
      {},
      {
        fields: ["name", "category", "sizeBytes", "storageKey", "createdAt"],
        with: {
          customer: maybeOne("Customer", "customerId", { fields: ["name"] }),
          intervention: maybeOne("Intervention", "interventionId", {
            fields: ["reference"],
          }),
        },
      },
      { sort: { createdAt: -1 }, limit: 100 },
    ),
    // La liste des clients ne sert qu'au formulaire de dépôt.
    can(user.role, "document.upload")
      ? db.customer.find({}, { fields: ["name"] }, { sort: { name: 1 } })
      : Promise.resolve([]),
  ]);

  const documents = await Promise.all(rows.map(withUrl));
  return { documents, customers };
}

/** Remplace la clé de stockage par un lien signé, valable quelques minutes. */
export async function withUrl<T extends { storageKey: string }>(
  doc: T,
): Promise<Omit<T, "storageKey"> & { url: string }> {
  const { storageKey, ...rest } = doc;
  return { ...rest, url: await fileUrl(storageKey) };
}

export type DocumentList = Awaited<ReturnType<typeof listDocuments>>;
