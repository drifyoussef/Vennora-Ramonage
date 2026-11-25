import { Plan, UserRole } from "@vennora/shared/enums";
import type { AppContext } from "../src/context";
import { rootDb } from "../src/mongo";
import { tenantDb, type TenantContext } from "../src/tenant";

/**
 * Organisations jetables pour les tests.
 *
 * Chaque suite crée les siennes et les efface après : les tests tournent
 * contre la vraie base, donc ils ne doivent jamais s'appuyer sur — ni abîmer —
 * le jeu de démonstration.
 */

export { rootDb };

export interface TestOrg {
  id: string;
  slug: string;
  adminId: string;
  technicianId: string;
  otherTechnicianId: string;
  admin: AppContext;
  technician: AppContext;
  /** Un second technicien, pour vérifier le cloisonnement entre pairs. */
  otherTechnician: AppContext;
}

function contextFor(
  orgId: string,
  userId: string,
  role: UserRole,
  tradeSlug: string,
  plan: Plan,
): AppContext {
  const ctx: TenantContext = { orgId, userId, role };
  return {
    ctx,
    db: tenantDb(ctx),
    user: {
      id: userId,
      orgId,
      role,
      firstName: "Test",
      lastName: role,
      fullName: `Test ${role}`,
      email: `${userId}@test.local`,
      colorHex: null,
      org: {
        id: orgId,
        name: "Organisation de test",
        logoKey: null,
        tradeSlug,
        tradeName: "Ramonage",
        plan,
        acces: { lectureSeule: false, essaiJusquAu: null, abonne: false },
      },
    },
  };
}

/**
 * Organisation jetable. L'offre par défaut est la plus large : la plupart des
 * tests portent sur autre chose que la facturation, et une organisation
 * bridée les ferait échouer pour la mauvaise raison. Les tests de
 * verrouillage, eux, demandent explicitement leur offre.
 */
export async function createTestOrg(label: string, plan: Plan = Plan.ENTREPRISE): Promise<TestOrg> {
  const trade = await rootDb.trade.findOne({ slug: "ramonage" }, { fields: ["slug"] });
  if (!trade) throw new Error("Métier « ramonage » absent : lancer npm run db:seed.");

  const slug = `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await rootDb.organization.insert({ name: `Test ${label}`, slug, tradeId: trade.id, plan });

  const make = (role: UserRole, suffix: string) =>
    rootDb.user.insert({
      orgId: org.id,
      firstName: "Test",
      lastName: suffix,
      email: `${slug}-${suffix}@test.local`,
      passwordHash: "x".repeat(60),
      role,
    });

  const admin = await make(UserRole.ADMIN, "admin");
  const technician = await make(UserRole.TECHNICIAN, "tech");
  const other = await make(UserRole.TECHNICIAN, "tech2");

  return {
    id: org.id,
    slug,
    adminId: admin.id,
    technicianId: technician.id,
    otherTechnicianId: other.id,
    admin: contextFor(org.id, admin.id, UserRole.ADMIN, trade.slug, plan),
    technician: contextFor(org.id, technician.id, UserRole.TECHNICIAN, trade.slug, plan),
    otherTechnician: contextFor(org.id, other.id, UserRole.TECHNICIAN, trade.slug, plan),
  };
}

/** Efface l'organisation et tout ce qui lui appartient, dans l'ordre inverse des dépendances. */
export async function destroyTestOrg(org: TestOrg): Promise<void> {
  const orgId = org.id;
  await rootDb.auditLog.deleteMany({ orgId });
  await rootDb.reminder.deleteMany({ orgId });
  await rootDb.document.deleteMany({ orgId });
  await rootDb.signature.deleteMany({ orgId });
  await rootDb.report.deleteMany({ orgId });
  await rootDb.interventionPhoto.deleteMany({ orgId });
  await rootDb.voiceNote.deleteMany({ orgId });
  await rootDb.anomaly.deleteMany({ orgId });
  await rootDb.intervention.deleteMany({ orgId });
  await rootDb.equipment.deleteMany({ orgId });
  await rootDb.site.deleteMany({ orgId });
  await rootDb.customer.deleteMany({ orgId });
  await rootDb.counter.deleteMany({ orgId });
  await rootDb.user.deleteMany({ orgId });
  await rootDb.organization.deleteMany({ id: orgId });
}

async function catalogEntry(kind: "equipment" | "intervention", code: string): Promise<string> {
  const trade = await rootDb.trade.findOne({ slug: "ramonage" }, {});
  const where = { tradeId: trade?.id ?? "", code };
  const entry = !trade
    ? null
    : kind === "equipment"
      ? await rootDb.equipmentType.findOne(where, {})
      : await rootDb.interventionType.findOne(where, {});
  if (!entry) throw new Error(`Type ${code} absent du catalogue : lancer npm run db:seed.`);
  return entry.id;
}

/** Client → site → équipement → intervention, l'ossature de tout test métier. */
export async function seedChain(
  org: TestOrg,
  options: { technicianId?: string; status?: "PLANNED" | "IN_PROGRESS" } = {},
) {
  const db = org.admin.db;

  const customer = await db.customer.insert({
    orgId: org.id,
    kind: "INDIVIDUAL",
    name: "Dupont Jean",
    lastName: "Dupont",
    firstName: "Jean",
    email: "jean@test.local",
    phone: "0466521874",
  });

  const site = await db.site.insert({
    orgId: org.id,
    customerId: customer.id,
    name: "Maison principale",
    address: "12 rue Victor Hugo",
    postalCode: "30100",
    city: "Alès",
  });

  const qrToken = `test-${Math.random().toString(36).slice(2)}`;
  const equipment = await db.equipment.insert({
    orgId: org.id,
    siteId: site.id,
    typeId: await catalogEntry("equipment", "POELE_GRANULES"),
    label: "Poêle à granulés",
    brand: "MCZ",
    qrToken,
  });

  const start = new Date();
  const reference = `TST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const intervention = await db.intervention.insert({
    orgId: org.id,
    reference,
    customerId: customer.id,
    siteId: site.id,
    equipmentId: equipment.id,
    technicianId: options.technicianId ?? org.technicianId,
    typeId: await catalogEntry("intervention", "RAMONAGE"),
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + 3_600_000),
    status: options.status ?? "IN_PROGRESS",
  });

  return {
    customer,
    site,
    equipment: { ...equipment, qrToken },
    intervention: { ...intervention, reference },
  };
}

/** Fichiers minimaux mais authentiques : la validation lit les octets réels. */
export const bytes = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]),
  png: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(400, 1),
  ]),
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 3)]),
  pdf: Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(400, 5)]),
  html: Buffer.from("<!doctype html><script>alert(1)</script>"),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
};
