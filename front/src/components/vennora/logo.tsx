import { cn } from "@/lib/utils";

/**
 * Marque Vennora.
 *
 * Un « V » dans un cadre de visée : les quatre coins rappellent le scan de
 * l'étiquette, les deux branches à nœuds convergent vers un point ambre,
 * l'équipement sur lequel tout se rattache.
 *
 * Même géométrie que `public/icons/vennora.svg`, sans le fond pétrole et
 * recadrée sur le dessin : la marque prend la couleur du texte
 * (`currentColor`) et se pose sur n'importe quel fond. En monochrome, le
 * point ambre passe à la couleur du texte, atténuée.
 */
export function VennoraMark({
  className,
  monochrome = false,
}: {
  className?: string;
  monochrome?: boolean;
}) {
  return (
    <svg
      viewBox="123 123 266 266"
      fill="none"
      className={cn("size-8", className)}
      aria-hidden="true"
    >
      <path
        d="M140.5 198.5V140.5H198.5M313.5 140.5H371.5V198.5M371.5 313.5V371.5H313.5M198.5 371.5H140.5V313.5"
        stroke="currentColor"
        strokeWidth="23"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M207.5 208L256 300L304.5 208"
        stroke="currentColor"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="207.5" cy="208" r="21" fill="currentColor" />
      <circle cx="304.5" cy="208" r="21" fill="currentColor" />
      <circle
        cx="256"
        cy="304"
        r="31"
        fill={monochrome ? "currentColor" : "var(--brand)"}
        opacity={monochrome ? 0.55 : 1}
      />
    </svg>
  );
}

export function VennoraLogo({
  className,
  showWordmark = true,
  subtitle,
  badge,
}: {
  className?: string;
  showWordmark?: boolean;
  subtitle?: string;
  /** Pastille posée à côté du sous-titre — l'offre, dans la barre latérale. */
  badge?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <VennoraMark className="size-7 shrink-0" />
      {showWordmark && (
        <div className="min-w-0 leading-none">
          <div className="font-heading text-[17px] font-semibold tracking-tight">
            Vennora Ramonage
          </div>
          {subtitle && (
            // La pastille passe à la ligne plutôt que de rogner le nom de
            // l'entreprise : « Ramonage Cév… » est une information perdue,
            // une seconde ligne n'est qu'un peu de place.
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="truncate text-[11px] font-medium opacity-60">
                {subtitle}
              </span>
              {badge}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
