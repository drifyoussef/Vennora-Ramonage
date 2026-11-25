# Vennora Ramonage

**Gérez vos interventions. Maîtrisez vos équipements.**

SaaS B2B de gestion des interventions techniques. Premier vertical métier :
le **ramonage**.

Le produit tient en une chaîne :

```
Client → Site → Équipement → Intervention → Rapport → Historique
```

---

## Démarrage

```bash
npm install
cp back/.env.example back/.env   # puis renseigner DATABASE_URL et AUTH_SECRET
npm run db:indexes          # crée les index MongoDB
npm run db:seed             # jeu de démonstration « Ramonage Cévennes »
npm run dev                 # API sur :4000, interface sur http://localhost:5173
```

L'interface relaie `/api` vers l'API : en développement comme en production,
le navigateur ne voit qu'une seule adresse, et le cookie de session suit sans
réglage CORS. Pour tester sur téléphone, ouvrir l'adresse réseau affichée par
Vite (même Wi-Fi).

### Variables indispensables

| Variable       | Rôle                                                             |
| -------------- | ---------------------------------------------------------------- |
| `DATABASE_URL` | URI MongoDB Atlas, **nom de base inclus** (`…mongodb.net/vennora`) |
| `AUTH_SECRET`  | 32 caractères au moins, aléatoires (voir `back/.env.example`)      |

Le reste — stockage, IA, e-mail — a des valeurs par défaut simulées : voir
`back/.env.example`. La configuration est validée au démarrage par
`back/src/env.ts` : une clé manquante fait échouer le démarrage plutôt que
de produire une erreur obscure à la première requête.

**Atlas refuse la connexion (« tlsv1 alert internal error ») ?** L'adresse IP
de la machine n'est pas autorisée : Atlas → Security → Network Access → Add
Current IP Address. Fréquent en partage de connexion, où l'IP change.

### Comptes de démonstration

| Rôle           | E-mail                          | Mot de passe  |
| -------------- | ------------------------------- | ------------- |
| Administrateur | celine@ramonage-cevennes.fr     | vennora2026   |
| Technicien     | ludovic@ramonage-cevennes.fr    | vennora2026   |

`npm run db:seed` **efface et recrée** l'organisation « Ramonage Cévennes ».

## Scripts

| Commande                | Effet                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `npm run dev`           | API (rechargée à chaque modification) et interface ensemble    |
| `npm run build`         | construit l'interface dans `front/dist`                     |
| `npm start`             | API en production, qui sert aussi l'interface construite       |
| `npm run typecheck`     | vérifie les types des trois espaces de travail                 |
| `npm run lint`          | ESLint, règles des hooks React comprises                       |
| `npm test`              | tests de l'API, contre la vraie base (organisations jetables)  |
| `npm run db:indexes`    | crée les index manquants (idempotent)                          |
| `npm run db:seed`       | jeu de démonstration                                           |
| `npm run org:create`    | crée une entreprise et son administrateur                      |
| `npm run org:plan`      | consulte ou change l'offre d'une entreprise                    |
| `npm run user:password` | réinitialise un mot de passe                                   |
| `npm run stripe:setup`  | crée produits, prix et portail sur le compte Stripe de test    |

---

## Embarquer un client

Il n'existe pas d'inscription en libre-service, et c'est délibéré tant qu'il
n'y a ni vérification d'adresse ni limitation des créations. Une entreprise se
crée en ligne de commande :

```bash
npm run org:create -- --nom "Ramonage du Gard" \
    --admin-email celine@ramonage-du-gard.fr \
    --admin-prenom Céline --admin-nom Mazel --ville Nîmes
```

Le mot de passe est tiré au sort et affiché **une seule fois** — sauf si
`--mot-de-passe` en impose un. Le client le change ensuite depuis son profil.
La commande synchronise les catalogues métier au passage : l'entreprise créée
trouve ses types d'équipement dès la première intervention.

La règle métier vit dans `back/src/data/onboarding.ts`. Le jour où une inscription
en libre-service existera, elle appellera la même fonction — pas une copie.

**Reprise du fichier clients.** Un nouveau client arrive avec un tableur :
`/clients/import` lit un CSV — point-virgule, accents Windows-1252 et marque
d'ordre d'octets compris — montre ce qu'il a compris, puis écrit sur
validation. L'opération est idempotente sur le couple nom + code postal :
relancée, elle n'ajoute rien.

**Mot de passe perdu.** Un administrateur réinitialise celui de ses
techniciens depuis l'application. Pour l'administrateur unique qui perd le
sien, il reste la ligne de commande :

```bash
npm run user:password -- --email celine@ramonage-cevennes.fr [--reactiver]
```

**Export des données.** `Paramètres → Vos données` construit à la demande une
archive ZIP : six fichiers CSV lisibles dans un tableur, les rapports PDF
signés, et un fichier de lecture. Rien n'est stocké au passage.

---

## Offres

`Organization.plan` porte l'offre souscrite, et `shared/src/plans.ts` dit ce que
chacune donne. C'est la seule matrice : l'interface la lit pour flouter, le
serveur la lit pour refuser.

| | Essentiel | Fondateur | Pro | Business | Entreprise |
| --- | --- | --- | --- | --- | --- |
| Clients, sites, équipements, planning, photos, QR, rapport PDF | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dictée et compte-rendu assisté | | ✅ | ✅ | ✅ | ✅ |
| Envoi du rapport par e-mail | ✅ | ✅ | ✅ | ✅ | ✅ |
| Suivi des échéances | | ✅ | ✅ | ✅ | ✅ |
| Export complet depuis l'application | | | | ✅ | ✅ |

« Fondateur » est une offre de lancement et non un palier : mêmes
fonctionnalités que Pro, prix tenu dans la durée. Elle est volontairement
absente de l'échelle commerciale du code — l'application ne proposera jamais
d'y « passer », puisqu'elle ne se souscrit plus.

**Le floutage n'est pas la protection.** Une zone verrouillée n'est pas rendue
avec ses données — le composant réel n'est jamais affiché — et la route
d'API correspondante appelle `exigerFonctionnalite`, qui refuse. Retirer un
filtre CSS ne révèle donc rien, et forger la requête ne fait rien.

Le nombre d'utilisateurs compris n'est appliqué **qu'avec le paiement en
ligne** (section suivante) : Essentiel refuse un deuxième compte actif et
propose Pro ; Pro et Business acceptent tout le monde et facturent chaque
utilisateur en plus. Paiement en ligne coupé, rien n'est bloqué — mieux vaut
un client servi qu'un client bloqué un samedi.

Changer l'offre d'un client se fait hors de l'application, ou par le
paiement en ligne quand il est activé. Un client facturé à la main se met en
Fondateur ou Entreprise : le paiement en ligne ne touche jamais ces deux-là.

```bash
npm run org:plan                                    # état des lieux
npm run org:plan -- --slug ramonage-cevennes --offre PRO
```

### Paiement en ligne (Stripe) — phase de test

Le parcours commercial, de la création du compte au renouvellement :

1. **Essai Pro automatique.** Une entreprise créée par `npm run org:create`
   démarre sur l'offre Pro pour 14 jours (`STRIPE_TRIAL_DAYS`), sans carte ni
   démarche. Un bandeau compte les jours restants.
2. **Choisir pendant l'essai ne l'écourte pas.** Depuis **Paramètres →
   Abonnement**, l'administrateur choisit Essentiel, Pro ou Business ; Stripe
   ne prélève qu'à la fin prévue de l'essai. Une entreprise plus ancienne,
   sans essai passé, en obtient un à la souscription, sans carte.
3. **Fin d'essai sans offre : lecture seule.** Tout reste consultable, rien
   ne s'enregistre (une garde sur toute l'API, `registerGardeLectureSeule`).
   Restent permis : se connecter, souscrire, désactiver un membre, changer un
   mot de passe. Même chose après une résiliation ou un impayé définitif.
4. **Tarif de lancement** (`STRIPE_TARIF=lancement`, par défaut) : 31 / 79 /
   199 € HT au lieu de 39 / 99 / 249 €, comme sur le site. L'abonné le garde,
   y compris en changeant d'offre ; passer à `public` ne concerne que les
   nouveaux venus.
5. **Utilisateurs en plus** : 20 € HT par utilisateur actif au-delà du forfait
   (Pro : 3, Business : 10), recalculés à chaque ajout ou désactivation.
6. **Changement d'offre dans l'application**, immédiat, au prorata. Le
   portail Stripe sert à la carte, aux factures et à la résiliation.

**Stripe décide, Vennora recopie.** Le retour de Checkout n'ouvre rien —
n'importe qui peut ouvrir cette adresse. `Organization.plan` ne bouge que sur
un abonnement relu chez Stripe : événement signé reçu sur
`/api/stripe/webhook`, ou réponse de Stripe à un changement d'offre (voir
`back/src/services/billing`). Impayé : l'offre reste ouverte pendant les
relances de Stripe. Fondateur et Entreprise ne sont jamais touchées. Hors
production, une clé `sk_live_` fait échouer le démarrage.

Mise en route, sur un compte Stripe en **mode test** :

1. Dans `back/.env` : `STRIPE_SECRET_KEY=sk_test_…` (tableau de bord Stripe,
   Développeurs → Clés API).
2. `npm run stripe:setup` : crée les produits, les prix publics et de
   lancement, le prix de l'utilisateur supplémentaire (montants dans
   `TARIFS`, `back/scripts/stripe-configurer.ts`, à tenir à jour avec
   `vennora-landing/src/components/tarifs.tsx`) et la configuration du
   portail client. Recopier l'identifiant `bpc_…` affiché dans
   `STRIPE_PORTAL_CONFIGURATION`. Relançable sans doublon.
3. Installer la [CLI Stripe](https://docs.stripe.com/stripe-cli), puis
   `stripe login` et, dans un terminal à part :
   `stripe listen --forward-to localhost:4000/api/stripe/webhook`. Recopier le
   secret `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET`.
4. `BILLING_DRIVER=stripe`, puis `npm run db:indexes` et `npm run dev`.

Attention : une fois `BILLING_DRIVER=stripe`, une entreprise sans essai ni
abonnement — le jeu de démonstration, par exemple — passe en lecture seule.
C'est voulu ; pour la rouvrir, souscrire en mode test (essai sans carte) ou
`npm run org:plan -- --slug … --offre ENTREPRISE`.

Scénarios à dérouler (cartes rappelées sur la page en mode test) :

| Scénario | Comment | Attendu |
| --- | --- | --- |
| Essai automatique | `npm run org:create …`, se connecter | Pro ouvert, bandeau « encore 14 jours » |
| Souscrire pendant l'essai | Choisir Pro, carte `4242 4242 4242 4242` | Abonné, premier prélèvement à la fin de l'essai |
| Essai à la souscription | Entreprise ancienne, choisir Pro sans carte | « Essai gratuit » 14 jours |
| 3-D Secure | `4000 0025 0000 3155` | Authentification demandée, puis actif |
| Carte refusée | `4000 0000 0000 9995` | Checkout refuse, rien ne change |
| Fin d'essai | Passer `trialEndsAt` dans le passé, ou une [horloge de test](https://docs.stripe.com/billing/testing/test-clocks) | Bandeau « Lecture seule », enregistrements refusés (402) |
| Deuxième membre sur Essentiel | Ajouter un membre | Refus, Pro proposé |
| Membre en plus sur Pro | 4ᵉ membre actif | Ligne « utilisateur supplémentaire » × 1 chez Stripe |
| Changement d'offre | Pro → Business, confirmer | Export débloqué aussitôt, tarif de lancement gardé |
| Résiliation | Portail → annuler | « Résiliation programmée », offre gardée jusqu'à l'échéance |
| Fin d'abonnement | `stripe trigger customer.subscription.deleted` | Lecture seule |

Les tests automatiques (`back/tests/abonnement.test.ts`) couvrent la
traduction abonnement → offre, l'accès (essai, lecture seule), les
utilisateurs facturés en plus et la signature du webhook, sans appel réseau.

---

## Architecture

Un seul dépôt, trois dossiers, TypeScript partout :

```
Vennora-Ramonage/
├── back/                Node.js + Fastify
│   ├── src/
│   │   ├── db/          accès MongoDB : collections, lectures avec relations,
│   │   │                cloisonnement, index
│   │   ├── auth/        session (cookie httpOnly signé), mots de passe
│   │   ├── data/        lectures et règles métier, une par agrégat
│   │   ├── routes/      routes HTTP, une famille par fichier
│   │   ├── services/    stockage, PDF, IA, e-mail, QR codes
│   │   ├── context.ts   point d'entrée unique de tout accès aux données
│   │   ├── tenant.ts    isolation multi-tenant
│   │   └── types.ts     types des réponses, importés par le front
│   ├── scripts/         seed, index, administration
│   ├── tests/           vitest, contre la vraie base
│   ├── .env             configuration et secrets (jamais dans git)
│   └── .storage/        photos, signatures, PDF stockés en local
├── front/               React (TSX) + Vite + React Router + TanStack Query
│   └── src/
│       ├── pages/       un écran par fichier (ou par dossier)
│       ├── components/  ui/ (shadcn), shell/ (navigation), vennora/ (métier)
│       └── lib/         appels d'API, session, cache, utilitaires
└── shared/              code commun au back et au front : énumérations,
                         libellés, droits, offres, schémas Zod, verticaux
```

Le back se lance seul avec `npm run dev -w @vennora/back`, le front avec
`npm run dev -w @vennora/front` ; `npm run dev` lance les deux.

L'interface importe les **types** des réponses depuis `@vennora/back/types`
(types seulement, aucun code serveur n'atteint le navigateur) : une route qui
change sa réponse casse la compilation de l'écran qui la lit.

### Ajouter un métier

Le cœur est agnostique. Un nouveau vertical se résume à :

1. écrire `shared/src/verticals/<metier>/index.ts` (types
   d'équipement, types d'intervention, sections du rapport, vocabulaire) ;
2. l'enregistrer dans `shared/src/verticals/registry.ts` avec
   `active: true` ;
3. relancer `npm run db:seed` — ou appeler `syncTradeCatalogs()` — pour
   projeter les catalogues en base.

---

## Isolation multi-tenant

Toutes les données sont cloisonnées par `Organization`. Le risque n'est pas
d'écrire un mauvais filtre, c'est d'en **oublier** un : un `find` sans
`orgId` compile et passe les tests sur un jeu mono-entreprise.

La possibilité de l'oublier a donc été supprimée. Une route commence par :

```ts
const { db, user, ctx } = await requireContext(request, "customer.view");
```

Le `db` retourné injecte `orgId` dans le filtre de chaque lecture et de
chaque écriture, dans chaque document créé, et dans chaque `$lookup` des
lectures avec relations. Le client racine (`rootDb`) n'est utilisé que par
l'authentification, le seed, les scripts et `tenant.ts`.

Deux garde-fous complètent le dispositif :

- **l'utilisateur est relu en base à chaque requête** : un compte désactivé ou
  un mot de passe changé coupe l'accès immédiatement, sans attendre
  l'expiration du jeton ;
- **l'interface ne protège rien** : masquer un bouton n'est qu'un confort.
  Chaque route vérifie elle-même session, droit, organisation — et, pour un
  technicien, que l'intervention lui est bien assignée.

---

## Choix techniques notables

**MongoDB, avec le driver officiel.** Pas d'ORM : une couche fine
(`back/src/db`) décrit les collections, convertit les identifiants
(`_id`/`ObjectId` en base, `id` en texte dans l'application), applique
valeurs par défaut et horodatages, et charge les relations par `$lookup` —
**une requête par écran**, quelle que soit la profondeur, avec un résultat
typé d'après ce qu'on a demandé. Conséquence assumée de MongoDB : aucune
contrainte d'intégrité ni cascade au niveau base. Les suppressions en cascade
sont écrites dans les routes, et refusées dès qu'elles emporteraient un
historique à valeur probante.

**Dates calculées par le navigateur.** « Aujourd'hui », « cette semaine », un
créneau à 9 h : ces instants dépendent du fuseau de l'utilisateur, pas de
celui du serveur (souvent UTC). L'interface les calcule et les envoie à l'API.

**Recherche par expression régulière échappée.** Toute saisie utilisateur
passe par `escapeSearch()` avant de devenir un `$regex`.

**Fichiers.** Type déterminé par la signature binaire, jamais par le nom ni
le `Content-Type` annoncé ; liens signés qui expirent ; la clé de stockage ne
quitte jamais le serveur.

**Jeton de QR code opaque et régénérable.** L'étiquette collée sur un appareil
ne porte jamais un identifiant de base. Elle est révocable sans toucher aux
données.

---

## Fournisseurs externes

Trois briques tournent en implémentation simulée tant qu'aucune clé n'est
fournie : la transcription vocale, la rédaction assistée et l'envoi
d'e-mails. Le paiement en ligne, lui, est coupé (`BILLING_DRIVER=off`) tant
qu'il n'est pas configuré — voir « Paiement en ligne » plus haut. Chacune est derrière une interface — voir `AI_PROVIDER`,
`TRANSCRIPTION_PROVIDER` et `MAIL_DRIVER` dans `back/.env.example`.

**E-mail.** `MAIL_DRIVER=smtp` envoie par nodemailer, avec les variables
`SMTP_*`. N'importe quel serveur SMTP fait l'affaire — celui de l'hébergeur du
domaine, un routeur transactionnel, ou celui de l'entreprise elle-même : pas
de compte à ouvrir chez un fournisseur d'API, et le rapport peut partir de
l'adresse professionnelle de l'artisan. Le chiffrement est déduit du port
(465 implicite, STARTTLS ailleurs) sauf si `SMTP_SECURE` le force.

**Rédaction assistée.** `AI_PROVIDER=groq` branche un modèle ouvert servi par
Groq — `qwen/qwen3.8-27b` par défaut — avec le même contrat que l'adaptateur
Anthropic : les six sections sont imposées par un schéma JSON strict, pas
demandées dans le prompt.

Deux contraintes valent d'être connues avant de brancher ce modèle, l'une
comme l'autre mesurées :

- **le raisonnement du modèle est conservé, et il coûte onze secondes** par
  compte-rendu contre une seule sans lui. Il les vaut pour la fidélité aux
  notes : privé de réflexion, le modèle comble les trous — « tirage conforme
  aux normes » là où la note dit « tirage conforme », conseils d'entretien
  que personne n'a donnés. Avec, il écrit « l'étanchéité n'a pas été
  contrôlée lors de cette intervention ». Sur une pièce remise au client,
  dire ce qu'on n'a pas fait vaut mieux que meubler ;
- **le palier gratuit plafonne à 8 000 jetons par minute** pour ce modèle,
  budget de sortie demandé compris. Une génération en consomme environ 5 500 :
  au-delà d'une par minute, l'API répond 429 et l'interface propose de rédiger
  à la main.

**Dictée.** `TRANSCRIPTION_PROVIDER=groq` branche Whisper large v3 servi par
Groq, dont le palier gratuit suffit largement à une entreprise de terrain. La
route est compatible avec celle d'OpenAI : les deux fournisseurs partagent le
même adaptateur, changer revient à changer une ligne de configuration. Le
modèle par défaut est `whisper-large-v3` : mesurée sur une note française de
quinze secondes, la variante « turbo » ne rend rien d'exploitable pour trente
millisecondes gagnées. La langue est envoyée d'office (`fr`), et le vocabulaire
du métier est passé en amorce — « débistrage » ou « boisseau » ne sont pas
dans le vocabulaire courant d'un modèle généraliste.
