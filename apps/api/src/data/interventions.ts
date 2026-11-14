import { backOne, count, many, maybeOne, one, type Where } from "../db";
import { InterventionStatus, UserRole } from "@vennora/core/enums";
import { NotFoundError } from "@vennora/core/errors";
import { contains } from "../db/search";
import type { AppContext } from "../context";
import { findInterventionCards } from "./dashboard";

const PAGE_SIZE = 30;

export interface InterventionFilters {
  q?: string;
  page?: number;
  status?: InterventionStatus;
  technicianId?: string;
  typeId?: string;
  customerId?: string;
  equipmentId?: string;
  from?: Date;
  to?: Date;
  /** Uniquement les interventions ayant relevé au moins une anomalie. */
  withAnomalies?: boolean;
}

async function buildWhere(
  { db, user }: AppContext,
  filters: InterventionFilters,
): Promise<Where<"Intervention">> {
  const where: Where<"Intervention"> = {};

  // Un technicien ne voit que ses interventions : c'est sa journée de travail,
  // pas le carnet de commandes de l'entreprise.
  if (user.role === UserRole.TECHNICIAN) {
    where.technicianId = user.id;
  } else if (filters.technicianId) {
    where.technicianId = filters.technicianId;
  }

  if (filters.status) where.status = filters.status;
  if (filters.typeId) where.typeId = filters.typeId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.equipmentId) where.equipmentId = filters.equipmentId;
  if (filters.withAnomalies) {
    where.id = { $in: await db.anomaly.distinct("interventionId") };
  }

  if (filters.from || filters.to) {
    where.scheduledStart = {
      ...(filters.from ? { $gte: filters.from } : {}),
      ...(filters.to ? { $lte: filters.to } : {}),
    };
  }

  if (filters.q) {
    // Recherche sur les relations en deux temps : les clients et sites qui
    // correspondent, puis les interventions qui les visent.
    const like = contains(filters.q);
    const [customerIds, siteIds] = await Promise.all([
      db.customer.distinct("id", { name: like }),
      db.site.distinct("id", {
        $or: [{ name: like }, { address: like }, { city: like }],
      }),
    ]);
    where.$or = [
      { reference: like },
      { customerId: { $in: customerIds } },
      { siteId: { $in: siteIds } },
    ];
  }

  return where;
}

export async function listInterventions(
  context: AppContext,
  filters: InterventionFilters = {},
) {
  const page = filters.page ?? 1;
  const where = await buildWhere(context, filters);

  const [items, total] = await Promise.all([
    findInterventionCards(context.db, {
      where,
      sort: { scheduledStart: -1 },
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    context.db.intervention.count(where),
  ]);

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Interventions d'une plage de dates, pour le planning. Jamais paginé. */
export async function listPlanning(
  context: AppContext,
  from: Date,
  to: Date,
  technicianId?: string,
) {
  return findInterventionCards(context.db, {
    where: await buildWhere(context, { from, to, technicianId }),
    sort: { scheduledStart: 1 },
  });
}

export async function getIntervention({ db }: AppContext, id: string) {
  const intervention = await db.intervention.findOne(
    { id },
    {
      fields: [
        "reference",
        "scheduledStart",
        "scheduledEnd",
        "startedAt",
        "completedAt",
        "status",
        "notes",
        "internalNotes",
        "nextInterventionAt",
        "createdAt",
      ],
      with: {
        customer: one("Customer", "customerId", {
          fields: ["name", "phone", "email"],
        }),
        site: one("Site", "siteId", {
          fields: [
            "name",
            "address",
            "addressComplement",
            "postalCode",
            "city",
            "accessNotes",
          ],
        }),
        equipment: maybeOne("Equipment", "equipmentId", {
          fields: ["label", "brand", "model", "serialNumber", "location"],
          with: { type: one("EquipmentType", "typeId", { fields: ["label"] }) },
        }),
        technician: one("User", "technicianId", {
          fields: ["firstName", "lastName", "colorHex", "phone"],
        }),
        type: one("InterventionType", "typeId", {
          fields: ["label", "colorHex", "recurrenceMonths"],
        }),
        anomalies: many(
          "Anomaly",
          "interventionId",
          {
            fields: [
              "title",
              "description",
              "severity",
              "status",
              "recommendation",
              "createdAt",
            ],
          },
          { sort: { severity: -1, createdAt: 1 } },
        ),
        report: backOne("Report", "interventionId", {
          fields: [
            "summary",
            "workDone",
            "equipmentState",
            "anomaliesSummary",
            "recommendations",
            "futureWork",
            "origin",
            "validatedAt",
            "pdfKey",
            "sentAt",
            "sentTo",
            "regenerations",
          ],
        }),
        signature: backOne("Signature", "interventionId", {
          fields: ["signerName", "signedAt"],
        }),
        // Pièces du dossier, avec leur clé : la route les remplace par des
        // liens signés avant de répondre.
        photos: many(
          "InterventionPhoto",
          "interventionId",
          { fields: ["storageKey", "caption", "sizeBytes", "createdAt"] },
          { sort: { createdAt: 1 } },
        ),
        voiceNotes: many(
          "VoiceNote",
          "interventionId",
          {
            fields: [
              "storageKey",
              "durationSec",
              "transcript",
              "transcriptStatus",
              "transcriptEdited",
              "createdAt",
            ],
          },
          { sort: { createdAt: 1 } },
        ),
      },
      count: {
        photos: count("InterventionPhoto", "interventionId"),
        voiceNotes: count("VoiceNote", "interventionId"),
      },
    },
  );

  if (!intervention) throw new NotFoundError("Intervention");
  return intervention;
}

export type InterventionDetail = Awaited<ReturnType<typeof getIntervention>>;

/**
 * Numéro d'intervention lisible : INT-2026-0042.
 *
 * Le compteur est incrémenté par `$inc` MongoDB, atomique côté serveur : deux
 * interventions créées simultanément ne peuvent pas recevoir le même numéro.
 * L'`upsert` ne sert qu'à amorcer le compteur en début d'année.
 */
export async function nextReference(
  { db, ctx }: AppContext,
  date = new Date(),
): Promise<string> {
  const year = date.getFullYear();
  const key = `intervention:${year}`;

  const counter = await db.counter.upsert(
    { key },
    { create: { orgId: ctx.orgId, key }, inc: { value: 1 } },
    { fields: ["value"] },
  );

  return `INT-${year}-${String(counter.value).padStart(4, "0")}`;
}

/** Techniciens assignables, pour les sélecteurs de planning. */
export async function listTechnicians({ db }: AppContext) {
  return db.user.find(
    { active: true },
    { fields: ["firstName", "lastName", "colorHex", "role"] },
    { sort: { role: 1, firstName: 1 } },
  );
}
