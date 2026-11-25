/**
 * Change l'offre souscrite par une entreprise.
 *
 *   npm run org:plan -- --slug ramonage-cevennes --offre PRO
 *
 * Volontairement hors de l'application : ouvrir une fonctionnalité payante
 * est une décision commerciale, elle ne doit pas être à portée de clic d'un
 * administrateur client. Le paiement en ligne (Stripe) passe, lui, par son
 * webhook : une offre changée ici sur une entreprise abonnée en ligne sera
 * réécrite au prochain événement Stripe.
 */
import { connectMongo } from "../src/db";
import { env } from "../src/env";
import { count } from "../src/db";
import { Plan } from "@vennora/shared/enums";
import { libelleOffre, utilisateursInclus } from "@vennora/shared/plans";


function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const slug = arg("slug");
  const offre = arg("offre")?.toUpperCase();
  const mongo = connectMongo(env.DATABASE_URL);
  const db = mongo.root;

  try {
    if (!slug) {
      const orgs = await db.organization.find(
        {},
        { fields: ["slug", "name", "plan"], count: { users: count("User", "orgId") } },
        { sort: { name: 1 } },
      );
      console.log("\n  Entreprises\n");
      for (const o of orgs) {
        console.log(
          `    ${o.slug.padEnd(30)} ${libelleOffre(o.plan).padEnd(12)} ${o._count.users} utilisateur(s)  — ${o.name}`,
        );
      }
      console.log("\n  Pour changer : npm run org:plan -- --slug <slug> --offre PRO\n");
      return;
    }

    if (!offre || !(offre in Plan)) {
      console.error(
        `\n  Offre inconnue. Valeurs possibles : ${Object.keys(Plan).join(", ")}.\n`,
      );
      process.exitCode = 1;
      return;
    }

    const org = await db.organization.findOne(
      { slug },
      { fields: ["name", "plan"], count: { users: count("User", "orgId") } },
    );
    if (!org) {
      console.error(`\n  Aucune entreprise « ${slug} ».\n`);
      process.exitCode = 1;
      return;
    }

    const nouvelle = offre as Plan;
    await db.organization.update({ id: org.id }, { plan: nouvelle });

    console.log(
      [
        "",
        `  ${org.name}`,
        `    ${libelleOffre(org.plan)} → ${libelleOffre(nouvelle)}`,
        "",
      ].join("\n"),
    );

    // Rétrograder une entreprise qui a plus d'utilisateurs que l'offre n'en
    // comprend ne casse rien — personne n'est déconnecté — mais il faut le
    // savoir avant que le client s'en aperçoive sur sa facture.
    const inclus = utilisateursInclus(nouvelle);
    if (org._count.users > inclus) {
      console.log(
        `  Attention : ${org._count.users} utilisateurs pour ${inclus} compris dans l'offre.\n`,
      );
    }
  } finally {
    await mongo.close();
  }
}

void main();
