import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * En développement, `/api` est relayé vers Fastify : navigateur et API
 * partagent une seule origine, le cookie de session suit sans exception CORS.
 * `host: true` ouvre le serveur au réseau local, pour tester sur téléphone.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": "http://localhost:4000" },
  },
});
