import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InterventionStatus, UserRole } from "@vennora/core/enums";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@vennora/core/errors";
import { endOfWeek, startOfWeek } from "@vennora/core/format";
import {
  objectId,
  passwordChangeSchema,
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@vennora/core/schemas";
import { hashPassword, verifyPassword } from "../auth/password";
import { SESSION_COOKIE } from "../auth/session";
import { requireContext, type AppContext } from "../context";
import { one, isDuplicateKeyError } from "../db";
import { getEquipmentTypes, getInterventionTypes } from "../data/catalog";
import { parse } from "../http";
import { audit } from "../tenant";

const idParams = z.object({ id: objectId });

/** L'index unique sur `User.email` est global : la collision remonte en 11000. */
function emailTaken(): never {
  throw new ValidationError("Cette adresse e-mail est déjà utilisée.", {
    email: ["Cette adresse e-mail est déjà utilisée."],
  });
}

/**
 * Nombre d'administrateurs actifs, hors celui qu'on est en train de
 * modifier. Sert à empêcher les deux manœuvres qui verrouillent une
 * entreprise hors de son propre compte : rétrograder le dernier
 * administrateur, ou le désactiver.
 */
function otherActiveAdmins({ db }: AppContext, exceptId: string): Promise<number> {
  return db.user.count({ role: UserRole.ADMIN, active: true, id: { $ne: exceptId } });
}

const memberFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "role",
  "active",
  "colorHex",
  "lastLoginAt",
] as const;

export async function equipeRoutes(app: FastifyInstance): Promise<void> {
  /** Page Paramètres : entreprise, équipe, référentiels métier. */
  app.get("/api/parametres", async (request) => {
    const { db, user } = await requireContext(request, "organization.manage");
    const [organization, users, equipmentTypes, interventionTypes] = await Promise.all([
      db.organization.findOne(
        { id: user.orgId },
        {
          fields: ["name", "address", "postalCode", "city", "phone", "email", "siret", "createdAt"],
          with: { trade: one("Trade", "tradeId", { fields: ["name", "colorHex"] }) },
        },
      ),
      db.user.find({}, { fields: memberFields }, { sort: { role: 1, firstName: 1 } }),
      getEquipmentTypes(user.org.tradeSlug),
      getInterventionTypes(user.org.tradeSlug),
    ]);
    if (!organization) throw new NotFoundError("Entreprise");
    return { organization, users, equipmentTypes, interventionTypes };
  });

  /** Couleurs déjà prises, pour proposer la suivante à un nouveau membre. */
  app.get("/api/equipe/couleurs", async (request) => {
    const { db } = await requireContext(request, "user.manage");
    return db.user.distinct("colorHex");
  });

  app.get("/api/equipe/:id", async (request) => {
    const { db } = await requireContext(request, "user.manage");
    const { id } = parse(idParams, request.params);
    const member = await db.user.findOne({ id }, { fields: [...memberFields, "createdAt"] });
    if (!member) throw new NotFoundError("Utilisateur");
    return member;
  });

  app.post("/api/equipe", async (request) => {
    const { db, ctx } = await requireContext(request, "user.manage");
    const input = parse(userCreateSchema, request.body);
    try {
      const { id } = await db.user.insert({
        orgId: ctx.orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        role: input.role,
        colorHex: input.colorHex,
        passwordHash: await hashPassword(input.password),
        active: true,
      });
      await audit(ctx, {
        action: "user.created",
        entity: "User",
        entityId: id,
        metadata: { email: input.email, role: input.role },
      });
      return { id };
    } catch (e) {
      if (isDuplicateKeyError(e)) emailTaken();
      throw e;
    }
  });

  app.patch("/api/equipe/:id", async (request) => {
    const context = await requireContext(request, "user.manage");
    const { db, ctx, user: actor } = context;
    const { id } = parse(idParams, request.params);
    const input = parse(userUpdateSchema, request.body);

    const target = await db.user.findOne({ id }, { fields: ["role", "active", "email"] });
    if (!target) throw new NotFoundError("Utilisateur");

    const losesAdmin =
      target.role === UserRole.ADMIN && (input.role !== UserRole.ADMIN || !input.active);
    if (losesAdmin && (await otherActiveAdmins(context, id)) === 0) {
      throw new ConflictError(
        "C'est le dernier administrateur actif. Nommez-en un autre avant de modifier celui-ci.",
      );
    }
    if (id === actor.id && !input.active) {
      throw new ConflictError("Vous ne pouvez pas désactiver votre propre compte.");
    }

    try {
      await db.user.update(
        { id },
        {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          role: input.role,
          colorHex: input.colorHex,
          active: input.active,
        },
      );
    } catch (e) {
      if (isDuplicateKeyError(e)) emailTaken();
      throw e;
    }

    await audit(ctx, {
      action: "user.updated",
      entity: "User",
      entityId: id,
      metadata: { role: input.role, active: input.active, roleChanged: target.role !== input.role },
    });
    return { id };
  });

  /**
   * Activation ou désactivation rapide depuis la liste.
   *
   * On ne supprime jamais un utilisateur : ses interventions, ses rapports
   * et ses signatures le référencent, et un rapport signé par un compte
   * disparu perd sa valeur probante.
   */
  app.post("/api/equipe/:id/actif", async (request) => {
    const context = await requireContext(request, "user.manage");
    const { db, ctx, user: actor } = context;
    const { id } = parse(idParams, request.params);
    const { active } = parse(z.object({ active: z.boolean() }), request.body);

    if (id === actor.id && !active) {
      throw new ConflictError("Vous ne pouvez pas désactiver votre propre compte.");
    }
    const target = await db.user.findOne({ id }, { fields: ["role", "firstName", "lastName"] });
    if (!target) throw new NotFoundError("Utilisateur");
    if (!active && target.role === UserRole.ADMIN && (await otherActiveAdmins(context, id)) === 0) {
      throw new ConflictError(
        "C'est le dernier administrateur actif. Nommez-en un autre avant de le désactiver.",
      );
    }

    await db.user.update({ id }, { active });
    await audit(ctx, {
      action: active ? "user.reactivated" : "user.deactivated",
      entity: "User",
      entityId: id,
      metadata: { name: `${target.firstName} ${target.lastName}` },
    });
    return { id, active };
  });

  /**
   * Réinitialisation par un administrateur.
   *
   * `passwordChangedAt` est mis à jour : tous les jetons déjà émis pour ce
   * compte cessent d'être acceptés, y compris ceux d'un appareil perdu —
   * c'est précisément l'usage attendu.
   */
  app.post("/api/equipe/:id/mot-de-passe", async (request) => {
    const { db, ctx } = await requireContext(request, "user.manage");
    const { id } = parse(idParams, request.params);
    const { password } = parse(passwordResetSchema, request.body);

    const target = await db.user.findOne({ id }, { fields: ["email"] });
    if (!target) throw new NotFoundError("Utilisateur");

    await db.user.update(
      { id },
      { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
    );
    await audit(ctx, {
      action: "user.passwordReset",
      entity: "User",
      entityId: id,
      metadata: { email: target.email },
    });
    return { id };
  });

  /** Page Profil : l'activité de l'utilisateur connecté. */
  app.get("/api/profil", async (request) => {
    const { db, user } = await requireContext(request);
    const now = new Date();
    const [weekCount, completedCount] = await Promise.all([
      db.intervention.count({
        technicianId: user.id,
        scheduledStart: { $gte: startOfWeek(now), $lte: endOfWeek(now) },
        status: { $ne: InterventionStatus.CANCELLED },
      }),
      db.intervention.count({ technicianId: user.id, status: InterventionStatus.COMPLETED }),
    ]);
    return { weekCount, completedCount };
  });

  /**
   * Changement de mot de passe par l'intéressé.
   *
   * L'ancien mot de passe est exigé : sans lui, un téléphone déverrouillé
   * laissé sur un chantier suffirait à prendre le compte définitivement.
   *
   * `passwordChangedAt` invalide tous les jetons émis avant, y compris
   * celui de la session en cours : on change son mot de passe surtout quand
   * on le croit compromis. Le cookie est effacé ici, pour que l'interface
   * renvoie à la connexion avec un message plutôt qu'avec une erreur.
   */
  app.post("/api/profil/mot-de-passe", async (request, reply) => {
    const { db, ctx, user } = await requireContext(request);
    const input = parse(passwordChangeSchema, request.body);

    const record = await db.user.findOne({ id: user.id }, { fields: ["passwordHash"] });
    if (!record) throw new UnauthorizedError();
    if (!(await verifyPassword(input.currentPassword, record.passwordHash))) {
      throw new ValidationError("Mot de passe actuel incorrect.", {
        currentPassword: ["Mot de passe actuel incorrect."],
      });
    }

    await db.user.update(
      { id: user.id },
      { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date() },
    );
    await audit(ctx, { action: "user.passwordChanged", entity: "User", entityId: user.id });

    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { signedOut: true };
  });
}
