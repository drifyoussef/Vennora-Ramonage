import { escapeSearch } from "@vennora/shared/schemas";

/** Filtre « contient », insensible à la casse, d'une saisie utilisateur. */
export function contains(input: string): { $regex: string; $options: "i" } {
  return { $regex: escapeSearch(input), $options: "i" };
}
