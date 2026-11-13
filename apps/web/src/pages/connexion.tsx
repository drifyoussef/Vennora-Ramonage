import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { AlertCircle, Camera, Eye, EyeOff, FileCheck2, History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VennoraMark } from "@/components/vennora/logo";
import { ApiError } from "@/lib/api";
import { useDocumentTitle } from "@/lib/title";
import { useLogin, useMe } from "@/lib/session";

/**
 * Ce que fait l'outil, dit avec les mots du métier.
 *
 * Trois promesses seulement, et uniquement des choses réellement livrées :
 * annoncer sur l'écran d'accueil une fonction qui n'existe pas se paie au
 * premier chantier.
 */
const ARGUMENTS = [
  {
    icon: Camera,
    title: "Le chantier se saisit sur place",
    body: "Photos, notes et dictée depuis le téléphone, au doigt, pendant l'intervention.",
  },
  {
    icon: FileCheck2,
    title: "Le rapport passe par vous",
    body: "Le texte proposé ne part jamais au client sans votre relecture et votre validation.",
  },
  {
    icon: History,
    title: "L'historique suit l'équipement",
    body: "Chaque conduit conserve ses passages, ses anomalies et ses rapports signés.",
  },
];

export function LoginPage() {
  useDocumentTitle("Connexion");
  const [searchParams] = useSearchParams();
  const suite = searchParams.get("suite") ?? undefined;
  const me = useMe();

  // Déjà connecté (l'API l'a confirmé en relisant la base) : on entre.
  if (me.data) return <Navigate to="/" replace />;

  return (
    <main className="min-h-dvh bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Panneau de marque. Sur mobile il se réduit à une bande : l'écran
          appartient au clavier et aux deux champs, pas au discours. */}
      {/* Le filet de droite est invisible en clair (fort contraste sable /
          pétrole) mais sépare les deux panneaux en sombre, où ils sont
          presque de la même valeur. */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border relative isolate flex flex-col overflow-hidden px-6 pt-12 pb-10 lg:border-r lg:px-12 lg:py-14">
        {/* Filigrane : la marque agrandie et recadrée, assez faible pour ne
            jamais concurrencer le texte. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -bottom-24 opacity-[0.055] lg:-right-28 lg:-bottom-28"
        >
          <VennoraMark monochrome className="size-[22rem] lg:size-[32rem]" />
        </div>

        <div className="relative">
          <VennoraMark className="size-10 lg:size-12" />
          <h1 className="font-heading text-sidebar-accent-foreground mt-5 text-3xl font-semibold tracking-tight lg:mt-6 lg:text-4xl">
            Vennora
          </h1>
          <p className="text-sidebar-foreground/75 mt-3 max-w-sm text-pretty lg:text-lg">
            Gérez vos interventions. Maîtrisez vos équipements.
          </p>
        </div>

        <ul className="relative mt-12 hidden space-y-7 lg:block">
          {ARGUMENTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="bg-sidebar-accent text-sidebar-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sidebar-accent-foreground text-sm font-medium">
                  {title}
                </p>
                <p className="text-sidebar-foreground/65 mt-1 text-sm text-pretty">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-sidebar-foreground/40 relative mt-auto hidden pt-12 text-xs lg:block">
          Vennora — gestion des interventions techniques
        </p>
      </aside>

      {/* Panneau du formulaire. */}
      <div className="flex flex-col px-4 py-10 sm:px-8 lg:justify-center lg:px-12 lg:py-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Connexion
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Accédez à votre espace de travail.
          </p>


          {searchParams.get("motdepasse") === "change" && (
            <p
              role="status"
              className="border-border bg-muted text-foreground mt-6 rounded-lg border px-4 py-3 text-sm text-pretty"
            >
              Mot de passe modifié. Reconnectez-vous avec le nouveau — vos
              autres appareils ont également été déconnectés.
            </p>
          )}

          <div className="mt-6">
            <LoginForm suite={suite} />
          </div>

          <p className="text-muted-foreground mt-6 text-xs text-pretty">
            Mot de passe oublié ? Votre administrateur peut le réinitialiser
            depuis les paramètres de l&apos;entreprise.
          </p>

          {import.meta.env.DEV && (
            <div className="border-border bg-muted/60 mt-8 rounded-lg border px-4 py-3 text-xs leading-relaxed">
              <p className="text-foreground mb-1.5 font-medium">
                Jeu de démonstration
              </p>
              <p className="text-muted-foreground">
                Administrateur · celine@ramonage-cevennes.fr
                <br />
                Technicien · ludovic@ramonage-cevennes.fr
                <br />
                Mot de passe · vennora2026
              </p>
            </div>
          )}

          <p className="text-muted-foreground/70 pb-safe mt-10 text-center text-xs lg:hidden">
            Vennora — gestion des interventions techniques
          </p>
        </div>
      </div>
    </main>
  );
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      Se connecter
    </Button>
  );
}

function LoginForm({ suite }: { suite?: string }) {
  const navigate = useNavigate();
  const login = useLogin();
  const error = login.error instanceof ApiError ? login.error : null;
  const state = {
    error: login.error
      ? (error?.message ?? "Connexion impossible. Réessayez dans un instant.")
      : undefined,
    fieldErrors: error?.fieldErrors,
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate(
      { email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") },
      {
        // Retour à la page demandée avant la connexion — un technicien qui
        // ouvre un QR code doit atterrir sur l'équipement scanné. Chemin
        // interne uniquement : `?suite=https://…` ferait sinon de la page
        // de connexion une redirection vers n'importe quel site.
        onSuccess: () =>
          navigate(suite && suite.startsWith("/") && !suite.startsWith("//") ? suite : "/", {
            replace: true,
          }),
      },
    );
  }
  // Saisir un mot de passe à l'aveugle sur un téléphone, dehors, est la
  // première cause d'échec de connexion sur le terrain.
  const [revealed, setRevealed] = useState(false);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>

      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Adresse e-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className="h-11"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email && (
          <p id="email-error" className="text-sm text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={revealed ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="h-11 pr-12"
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby={
              state.fieldErrors?.password ? "password-error" : undefined
            }
          />
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-pressed={revealed}
            aria-controls="password"
            aria-label={
              revealed ? "Masquer le mot de passe" : "Afficher le mot de passe"
            }
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md focus-visible:ring-2 focus-visible:outline-none"
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {state.fieldErrors?.password && (
          <p id="password-error" className="text-sm text-destructive">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <SubmitButton pending={login.isPending} />
    </form>
  );
}
