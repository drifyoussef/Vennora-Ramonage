import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nouvelle pile (Fastify + React) : chaque espace de travail a sa config.
    "apps/**",
    "packages/**",
    // Client Prisma : code généré, jamais édité à la main.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
