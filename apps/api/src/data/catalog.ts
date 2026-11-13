import { rootDb } from "../mongo";

/**
 * Catalogues actifs du métier : types d'équipement et d'intervention.
 *
 * Ces collections ne portent pas d'`orgId` — ce sont des référentiels métier
 * partagés, pas des données d'entreprise — donc elles se lisent avec le
 * client racine. Elles ne changent qu'au déploiement (synchronisation des
 * verticaux) : on les garde cinq minutes en mémoire plutôt que de les relire
 * à chaque écran.
 */

const TTL_MS = 5 * 60 * 1000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  // Un échec ne doit pas rester en cache.
  value.catch(() => memo.delete(key));
  return value;
}

async function tradeId(tradeSlug: string): Promise<string | null> {
  const trade = await rootDb.trade.findOne({ slug: tradeSlug }, {});
  return trade?.id ?? null;
}

export function getEquipmentTypes(tradeSlug: string) {
  return remember(`equipment:${tradeSlug}`, async () => {
    const id = await tradeId(tradeSlug);
    if (!id) return [];
    return rootDb.equipmentType.find(
      { tradeId: id, active: true },
      { fields: ["code", "label", "icon", "defaultIntervalMonths", "sortOrder"] },
      { sort: { sortOrder: 1, label: 1 } },
    );
  });
}

export function getInterventionTypes(tradeSlug: string) {
  return remember(`intervention:${tradeSlug}`, async () => {
    const id = await tradeId(tradeSlug);
    if (!id) return [];
    return rootDb.interventionType.find(
      { tradeId: id, active: true },
      {
        fields: [
          "code",
          "label",
          "colorHex",
          "defaultDurationMin",
          "recurrenceMonths",
          "sortOrder",
        ],
      },
      { sort: { sortOrder: 1, label: 1 } },
    );
  });
}

export type EquipmentTypeEntry = Awaited<ReturnType<typeof getEquipmentTypes>>[number];
export type InterventionTypeEntry = Awaited<ReturnType<typeof getInterventionTypes>>[number];
