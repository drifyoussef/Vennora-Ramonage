// Conversion mécanique d'une page serveur Next vers une page React :
// métadonnées → useDocumentTitle, export par défaut asynchrone → composant,
// contexte serveur → useUser. Le chargement des données reste à écrire.
// Usage : node porter-page.mjs <source> <cible> <NomDuComposant>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [source, target, name] = process.argv.slice(2);
execFileSync(process.execPath, [fileURLToPath(new URL("./porter-depuis-next.mjs", import.meta.url)), source, target], { stdio: "inherit" });
let s = readFileSync(target, "utf8");

s = s.replace(/import type \{ Metadata \} from "next";\n/, "");
const title = s.match(/export const metadata: Metadata = \{ title: "([^"]+)" \};\n\n?/);
s = s.replace(/export const metadata: Metadata = \{[^}]*\};\n\n?/, "");
s = s.replace(/export default async function \w+\([\s\S]*?\)(: [^{]+)? \{\n/, `export function ${name}() {\n${title ? `  useDocumentTitle("${title[1]}");\n` : ""}`);
s = s.replace(/  const context = await getPageContext\([^)]*\);\n/, "  const user = useUser();\n");
s = s.replace(/  const \{ user \} = context;\n/, "");
s = s.replace(/context\.user\b/g, "user");
s = s.replace(/import \{ getPageContext \} from "@\/core\/context";\n/, "");
// En tête de fichier : l'ordre des imports n'a pas d'effet, et insérer au
// milieu risquerait de couper un import sur plusieurs lignes.
s = `import { useDocumentTitle } from "@/lib/title";\nimport { useUser } from "@/lib/user";\nimport { pageState, useApiQuery } from "@/lib/query";\n` + s;
writeFileSync(target, s);
