import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { loadCurrentUser, readSession, signSession } from "../src/auth/session";
import { createTestOrg, destroyTestOrg, rootDb, type TestOrg } from "./fixtures";

/**
 * Session : un jeton signé ne décide de rien, la base tranche.
 *
 * Le jeton porte des identifiants et sa date d'émission ; l'utilisateur est
 * relu à chaque requête. Ces tests vérifient les trois façons dont un jeton
 * encore valide doit malgré tout être refusé, et que la signature protège
 * contre la contrefaçon.
 */
describe("session", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg("session");
  });

  afterAll(async () => {
    await destroyTestOrg(org);
  });

  const claimsOf = async (o: TestOrg) => ({
    uid: o.technicianId,
    orgId: o.id,
    tradeSlug: "ramonage",
  });

  it("relit l'utilisateur et son organisation depuis un jeton valide", async () => {
    const token = await signSession(await claimsOf(org));
    const claims = await readSession(token);
    expect(claims?.uid).toBe(org.technicianId);

    const user = await loadCurrentUser(claims!);
    expect(user?.id).toBe(org.technicianId);
    expect(user?.org.id).toBe(org.id);
    expect(user?.org.tradeSlug).toBe("ramonage");
  });

  it("refuse un jeton signé avec une autre clé", async () => {
    const forged = await new SignJWT({ ...(await claimsOf(org)) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("une-cle-qui-n-est-pas-celle-du-serveur-0000"));
    expect(await readSession(forged)).toBeNull();
  });

  it("refuse un jeton expiré ou malformé", async () => {
    const expired = await new SignJWT({ ...(await claimsOf(org)) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await readSession(expired)).toBeNull();
    expect(await readSession("pas.un.jeton")).toBeNull();
    expect(await readSession(undefined)).toBeNull();
  });

  it("refuse un compte désactivé, même avec un jeton valide", async () => {
    const claims = await readSession(await signSession(await claimsOf(org)));
    await rootDb.user.update({ id: org.technicianId }, { active: false });
    try {
      expect(await loadCurrentUser(claims!)).toBeNull();
    } finally {
      await rootDb.user.update({ id: org.technicianId }, { active: true });
    }
  });

  it("refuse un jeton émis avant le dernier changement de mot de passe", async () => {
    const claims = await readSession(await signSession(await claimsOf(org)));
    // Mot de passe changé une minute après l'émission du jeton.
    await rootDb.user.update(
      { id: org.technicianId },
      { passwordChangedAt: new Date(claims!.iat * 1000 + 60_000) },
    );
    try {
      expect(await loadCurrentUser(claims!)).toBeNull();
    } finally {
      await rootDb.user.update({ id: org.technicianId }, { passwordChangedAt: null });
    }
  });

  it("suit l'organisation en base si le jeton en désigne une autre", async () => {
    const other = await createTestOrg("session-autre");
    try {
      // Jeton périmé dans son contenu : il désigne l'organisation voisine.
      const claims = await readSession(
        await signSession({ uid: org.technicianId, orgId: other.id, tradeSlug: "ramonage" }),
      );
      const user = await loadCurrentUser(claims!);
      expect(user?.org.id).toBe(org.id);
    } finally {
      await destroyTestOrg(other);
    }
  });
});
