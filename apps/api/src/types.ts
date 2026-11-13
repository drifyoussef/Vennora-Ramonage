/**
 * Types des réponses de l'API, importés par l'interface (`@vennora/api/types`).
 *
 * Imports de types uniquement : rien de ce fichier n'atteint le navigateur.
 * Une route qui change sa réponse casse la compilation du front au lieu de
 * produire un écran vide en production.
 */
import type { CustomerDetail } from "./data/customers";
import type { getDashboard } from "./data/dashboard";
import type { EquipmentDetail } from "./data/equipment";
import type { listEquipment } from "./data/equipment";
import type { listInterventions, listTechnicians } from "./data/interventions";
import type { listSites } from "./data/sites";
import type { EquipmentTypeEntry, InterventionTypeEntry } from "./data/catalog";
import type { ReminderItem } from "./data/reminders";

export type { CurrentUser } from "./auth/session";
export type { CustomerListItem, CustomerOption } from "./data/customers";
export type { InterventionCard } from "./data/dashboard";
export type { InterventionDetail } from "./data/interventions";
export type { SiteDetail } from "./data/sites";
export type { EquipmentDetail, EquipmentListItem } from "./data/equipment";
export type { AnomalyListItem } from "./data/anomalies";
export type { DocumentList } from "./data/documents";
export type { EquipmentTypeEntry, InterventionTypeEntry, ReminderItem };

type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/** Réponse paginée. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize?: number;
}

/** Lien signé à la place de la clé de stockage. */
type WithUrl<T extends { storageKey: string }> = Omit<T, "storageKey"> & { url: string };

/** GET /api/clients/:id */
export type CustomerDetailView = Omit<CustomerDetail, "documents"> & {
  documents: WithUrl<CustomerDetail["documents"][number]>[];
};

/** GET /api/equipements/:id */
export type EquipmentDetailView = EquipmentDetail & { qr: { svg: string; url: string } };

export type Dashboard = Result<typeof getDashboard>;
export type InterventionList = Result<typeof listInterventions>;
export type Technician = Result<typeof listTechnicians>[number];
export type SiteList = Result<typeof listSites>;
export type EquipmentList = Result<typeof listEquipment>;

/** GET /api/catalogue */
export interface Catalogue {
  interventionTypes: InterventionTypeEntry[];
  equipmentTypes: EquipmentTypeEntry[];
}

/** GET /api/rappels */
export interface RemindersView {
  reminders: ReminderItem[];
  pending: number;
  overdue: number;
}

/** GET /api/parametres */
export interface SettingsView {
  organization: {
    id: string;
    name: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    siret: string | null;
    createdAt: Date;
    trade: { id: string; name: string; colorHex: string };
  };
  users: Omit<TeamMember, "createdAt">[];
  equipmentTypes: EquipmentTypeEntry[];
  interventionTypes: InterventionTypeEntry[];
}

/** GET /api/equipe/:id */
export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: import("@vennora/core/enums").UserRole;
  active: boolean;
  colorHex: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export type { AnalyseImport, ResultatImport } from "./data/import-clients";
