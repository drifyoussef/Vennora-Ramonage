/**
 * Redonne l'accès à un utilisateur qui a perdu son mot de passe.
 *
 *   npm run user:password -- --email celine@ramonage-cevennes.fr
 *
 * Dans l'application, un administrateur réinitialise le mot de passe de ses
 * techniciens. Restait le cas sans issue : l'administrateur unique qui perd le
 * sien. Personne, dans le produit, ne peut alors rien pour lui — d'où cette
 * porte de service, qui exige un accès à la base et n'est donc pas une
 * faiblesse de plus.
 *
 * Le mot de passe est tiré au sort et affiché une seule fois, sauf si
 * `--mot-de-passe` en impose un.
 */
import { randomBytes } from "node:crypto";
import { connectMongo } from "../src/db";
import { env } from "../src/env";
import { one } from "../src/db";
import { hashPassword } from "../src/auth/password";


function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Lisible au téléphone : ni I, ni l, ni O, ni 0. */
function motDePasseAleatoire(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(18), (o) => alphabet[o % alphabet.length])
    .join("")
    .replace(/(.{6})(?=.)/g, "$1-");
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  if (!email) {
    console.error(
      [
        "Usage :",
        "  npm run user:password -- --email celine@exemple.fr [--mot-de-passe …] [--reactiver]",
      ].join("\n"),
    );
    process.exit(1);
  }

  const mongo = connectMongo(env.DATABASE_URL);
  const db = mongo.root;
  try {
    const user = await db.user.findOne(
      { email },
      {
        fields: ["firstName", "lastName", "role", "active"],
        with: { org: one("Organization", "orgId", { fields: ["name"] }) },
      },
    );

    if (!user) {
      console.error(`\n  Aucun utilisateur avec l'adresse ${email}.\n`);
      process.exitCode = 1;
      return;
    }

    const motDePasse = arg("mot-de-passe") ?? motDePasseAleatoire();
    const reactiver = process.argv.includes("--reactiver");

    await db.user.update(
      { id: user.id },
      {
        passwordHash: await hashPassword(motDePasse),
        ...(reactiver ? { active: true } : {}),
      },
    );

    console.log(
      [
        "",
        "  Mot de passe réinitialisé",
        `    Utilisateur    ${user.firstName} ${user.lastName} (${user.role.toLowerCase()})`,
        `    Entreprise     ${user.org.name}`,
        `    E-mail         ${email}`,
        `    Mot de passe   ${motDePasse}`,
        "",
      ].join("\n"),
    );

    // Un compte désactivé ne se connecte pas, mot de passe neuf ou non : le
    // dire ici évite un aller-retour de dépannage.
    if (!user.active && !reactiver) {
      console.log(
        [
          "  Attention : ce compte est désactivé, la connexion sera refusée.",
          "  Relancer avec --reactiver pour le réactiver en même temps.",
          "",
        ].join("\n"),
      );
    }
  } catch (e) {
    console.error(`\n  Échec : ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await mongo.close();
  }
}

void main();
