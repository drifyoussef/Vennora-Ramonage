/**
 * Types des réponses de l'API, importés par l'interface (`@vennora/api/types`).
 *
 * Imports de types uniquement : rien de ce fichier n'atteint le navigateur.
 * Une route qui change sa réponse casse la compilation du front au lieu de
 * produire un écran vide en production.
 */
export type { CurrentUser } from "./auth/session";
export type {
  CustomerDetail,
  CustomerListItem,
  CustomerOption,
} from "./data/customers";
export type { InterventionCard } from "./data/dashboard";
export type { InterventionDetail } from "./data/interventions";
export type { SiteDetail } from "./data/sites";
export type { EquipmentDetail, EquipmentListItem } from "./data/equipment";

/** Réponse paginée. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize?: number;
}
