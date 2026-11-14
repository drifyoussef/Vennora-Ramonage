import { defineConfig } from "vitest/config";

/**
 * Tests de l'API.
 *
 * Ils tournent contre la vraie base : l'essentiel de ce qu'on veut vérifier —
 * isolation multi-tenant, cascades, contraintes d'unicité — est un
 * comportement de la base qu'un double en mémoire ne reproduirait pas. Chaque
 * suite crée son organisation jetable et l'efface à la fin.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Les suites partagent la base : les paralléliser produirait des
    // interférences pénibles à diagnostiquer pour un gain nul à cette échelle.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["tests/setup.ts"],
  },
});
