# Vennora Ramonage — notes pour les agents

SaaS B2B de gestion des interventions techniques. Vertical actif : ramonage.
Interface entièrement en français, y compris les routes
(`/clients`, `/equipements`, `/interventions/nouvelle`, `/api/rappels`).

Monorepo npm, TypeScript partout :

- `apps/api` — Node.js + **Fastify**, MongoDB Atlas par le **driver officiel**
  `mongodb` (pas de Prisma, pas d'ORM) ;
- `apps/web` — **React (TSX)** + Vite + React Router + TanStack Query ;
- `packages/core` — métier partagé : énumérations, libellés, droits, offres,
  schémas Zod, verticaux, formats. Aucune dépendance serveur ni navigateur.

Lire `README.md` pour l'architecture et les choix techniques. Les points
ci-dessous sont ceux qu'on casse le plus facilement sans s'en apercevoir.

## Accès aux données

Toute route métier commence par le contexte :

```ts
const { db, user, ctx } = await requireContext(request, "customer.view");
```

Le `db` retourné injecte `orgId` dans chaque filtre, chaque écriture, chaque
document créé et chaque `$lookup`. **Ne jamais utiliser `rootDb`** (client
racine, non cloisonné) dans une route ou un module `data/` — il est réservé à
l'authentification, aux catalogues partagés, à `tenant.ts`, aux scripts et
aux tests.

Sur les créations, écrire quand même `orgId: ctx.orgId` : le typage l'exige,
et le client cloisonné écrase toute valeur divergente.

Lectures : `db.x.find(filtre, spec, options)` / `findOne`. La `spec` décrit
champs, relations (`one`, `maybeOne`, `backOne`, `many`) et compteurs
(`count`) ; tout est chargé en **une requête** (`$lookup`) et le résultat est
typé d'après la spec. Ne pas enchaîner des lectures relation par relation.

Filtres et données s'écrivent en forme applicative : `id` (pas `_id`),
identifiants en chaînes. La conversion vers `ObjectId` est faite par
`apps/api/src/db/convert.ts`, jamais à la main.

Une relation filtrée (« les anomalies des interventions de ce client ») se
résout en deux temps : `distinct("id", …)` sur la collection liée, puis
`{ champId: { $in: ids } }`.

## Collections et index

La forme des documents, les champs `ObjectId`, les valeurs par défaut et les
horodatages sont déclarés dans `apps/api/src/db/models.ts` — c'est l'ancien
`schema.prisma`. Ajouter un champ : le déclarer là. Ajouter un index :
`INDEXES` dans `apps/api/src/db/index.ts`, puis `npm run db:indexes`.

Ajouter un champ **requis** demande de **compléter les documents déjà en
base** : la valeur par défaut ne s'applique qu'à la création.

Aucune contrainte d'intégrité côté base. Les suppressions en cascade sont
écrites à la main dans les routes, dans l'ordre inverse des dépendances, et
refusées dès qu'elles emporteraient un historique à valeur probante.

## Énumérations

Source de vérité : `packages/core/src/enums.ts`. Importer depuis
`@vennora/core/enums`. Une valeur ajoutée demande ses libellés dans
`packages/core/src/labels.ts` (le typage l'exige).

## Interface et API

- L'interface ne protège rien : masquer un bouton n'est qu'un confort. Chaque
  route vérifie session, permission, organisation, et pour un technicien que
  l'intervention lui est assignée (`requireVisibleIntervention`,
  `requireEditableIntervention`).
- Types des réponses : exportés par `apps/api/src/types.ts`, importés côté
  front avec `import type … from "@vennora/api/types"` — **types seulement**.
- Écritures côté front : `act(() => api.post(…))` (forme `ActionResult`,
  erreurs champ par champ), puis `useRefresh()` pour relire les écrans.
- Toute écriture porte l'en-tête `x-vennora: 1` (garde CSRF) — le client
  `api` de `apps/web/src/lib/api.ts` l'ajoute.
- **Dates :** un instant qui dépend du fuseau de l'utilisateur (aujourd'hui,
  cette semaine, un créneau à 9 h) est calculé par le navigateur et envoyé à
  l'API, jamais déduit côté serveur (souvent en UTC).
- Hooks React : jamais après un retour anticipé (`if (state) return state`).

## Offres

`Organization.plan` décide des fonctionnalités servies. La matrice est dans
`packages/core/src/plans.ts` et nulle part ailleurs.

Toute fonctionnalité payante se garde **des deux côtés** :

```ts
exigerFonctionnalite(context, "export");   // route : refuse
autorise(user.org.plan, "export")          // page : ne rend pas le composant
```

Le composant `ZoneVerrouillee` ne reçoit qu'un décor. Ne jamais y passer de
données réelles en comptant sur le flou : c'est du CSS, ça se retire.

## Fichiers

Tout passe par `apps/api/src/services/storage` : `storeFile`, `fileUrl`,
`deleteFile`. Les fichiers locaux vont dans `.storage/` à la racine du dépôt
— jamais dans `apps/web/public/`, servi sans contrôle, or il s'agit de photos
de chantier et de signatures clients.

`storeFile` détermine le type par la **signature binaire**, pas par le
`Content-Type` annoncé ni par l'extension, et n'accepte que les catégories
passées en second argument. Le nom d'origine ne sert jamais à construire un
chemin.

`fileUrl` renvoie un lien signé qui expire. L'audience par défaut est
`tenant` : une session de la bonne organisation est exigée en plus de la
signature. Réserver `public` aux destinataires sans compte. **La clé de
stockage ne quitte jamais le serveur** : une réponse d'API porte un lien
signé (`withUrl`), pas une clé.

Obtenir une URL n'autorise rien : c'est à l'appelant d'avoir vérifié les
droits par une lecture cloisonnée avant d'appeler `fileUrl`.

## Verticaux

Le vocabulaire, les types d'équipement, les types d'intervention et les
sections du rapport appartiennent à `packages/core/src/verticals/<metier>/`.
Ne rien coder en dur dans `apps/` qui soit propre au ramonage.

## Interface

- Champs de saisie en `h-11` (44 px) : le technicien saisit au doigt.
- Libellés d'énumération dans `packages/core/src/labels.ts`, jamais en dur
  dans un composant.
- Couleurs par jeton (`bg-severity-high`, `text-status-done`, `text-brand`),
  jamais de hex en dur, sauf pour les couleurs venant de la base (type
  d'intervention, technicien) qui passent par `style`.
- Tableau sur écran large, cartes sous 768 px. Pas de scroll horizontal de page.

## Vérifications avant de rendre la main

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` tourne contre la vraie base (organisations jetables, effacées à la
fin) : l'adresse IP doit être autorisée dans Atlas (Network Access).
