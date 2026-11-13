// Copie un fichier de l'ancienne appli Next vers apps/web en appliquant les
// conversions mécaniques. Usage : node porter-depuis-next.mjs <source> <cible>
// Les cas non mécaniques (Server Actions, useRouter…) restent à reprendre à la main.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [source, target] = process.argv.slice(2);
let s = readFileSync(source, "utf8").replace(/\r\n/g, "\n");

s = s.replace(/^"use client";?\n\n?/m, "");
s = s.replace(/import Link from "next\/link";/g, 'import { Link } from "react-router";');
s = s.replace(/<Link(\s[^>]*?)\shref=/g, "<Link$1 to=").replace(/<Link\s+href=/g, "<Link to=");
s = s.replace(/import \{ usePathname \} from "next\/navigation";/g, 'import { useLocation } from "react-router";');
s = s.replace(/usePathname\(\)/g, "useLocation().pathname");
s = s.replace(/from "@\/core\/navigation"/g, 'from "@/lib/navigation"');
s = s.replace(/from "@\/core\/(enums|labels|plans|permissions|schemas|errors|palette)"/g, 'from "@vennora/core/$1"');
s = s.replace(/from "@\/lib\/(format|csv|bytes)"/g, 'from "@vennora/core/$1"');
s = s.replace(/from "@\/verticals\/([a-z/]+)"/g, 'from "@vennora/core/verticals/$1"');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, s);
const restants = [...s.matchAll(/from "(next[^"]*|@\/core\/[^"]+|server-only)"/g)].map((m) => m[1]);
console.log(`${target}${restants.length ? "  ⚠ à reprendre : " + [...new Set(restants)].join(", ") : ""}`);
