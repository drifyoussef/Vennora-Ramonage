// Lance l'API (Fastify, port 4000) et l'interface (Vite, port 5173) ensemble,
// sorties préfixées. Ctrl+C arrête les deux.
import { spawn } from "node:child_process";

const apps = [
  { name: "api", color: "\x1b[36m", workspace: "@vennora/api" },
  { name: "web", color: "\x1b[35m", workspace: "@vennora/web" },
];

const children = apps.map(({ name, color, workspace }) => {
  const child = spawn("npm", ["run", "dev", "-w", workspace], { shell: true });
  const prefix = `${color}[${name}]\x1b[0m `;
  const relay = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}arrêté (code ${code})`);
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 0;
  });
  return child;
});

process.on("SIGINT", () => children.forEach((c) => c.kill()));
