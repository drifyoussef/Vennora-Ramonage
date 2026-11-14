import { TRADES } from "@vennora/core/verticals/registry";
import type { TradeDefinition } from "@vennora/core/verticals/types";
import type { Repos } from "../db";

/**
 * Projection du registre des métiers vers la base.
 *
 * Les catalogues (types d'équipement, types d'intervention) sont déclarés en
 * code — c'est là qu'ils sont relus et versionnés — mais stockés en base pour
 * que les interventions déjà enregistrées gardent une référence stable même
 * si un type disparaît du registre.
 *
 * Idempotent : à relancer après chaque évolution d'un vertical. Les types
 * absents du registre sont désactivés, jamais supprimés.
 *
 * Reçoit le client racine en paramètre : il doit rester exécutable depuis un
 * script (seed, création d'organisation) comme depuis l'API.
 */
export async function syncTradeCatalogs(db: Repos): Promise<void> {
  for (const trade of Object.values(TRADES) as TradeDefinition[]) {
    const fields = { name: trade.name, colorHex: trade.colorHex, active: trade.active };
    const record = await db.trade.upsert(
      { slug: trade.slug },
      { create: { slug: trade.slug, ...fields }, update: fields },
      {},
    );

    for (const type of trade.equipmentTypes) {
      const values = {
        label: type.label,
        icon: type.icon,
        defaultIntervalMonths: type.defaultIntervalMonths ?? null,
        sortOrder: type.sortOrder,
        active: true,
      };
      await db.equipmentType.upsert(
        { tradeId: record.id, code: type.code },
        { create: { tradeId: record.id, code: type.code, ...values }, update: values },
        {},
      );
    }

    for (const type of trade.interventionTypes) {
      const values = {
        label: type.label,
        colorHex: type.colorHex,
        defaultDurationMin: type.defaultDurationMin,
        recurrenceMonths: type.recurrenceMonths ?? null,
        sortOrder: type.sortOrder,
        active: true,
      };
      await db.interventionType.upsert(
        { tradeId: record.id, code: type.code },
        { create: { tradeId: record.id, code: type.code, ...values }, update: values },
        {},
      );
    }

    const keptEquipment = trade.equipmentTypes.map((t) => t.code);
    const keptIntervention = trade.interventionTypes.map((t) => t.code);
    if (keptEquipment.length > 0) {
      await db.equipmentType.updateMany(
        { tradeId: record.id, code: { $nin: keptEquipment } },
        { active: false },
      );
    }
    if (keptIntervention.length > 0) {
      await db.interventionType.updateMany(
        { tradeId: record.id, code: { $nin: keptIntervention } },
        { active: false },
      );
    }
  }
}
