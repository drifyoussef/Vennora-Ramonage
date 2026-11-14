/**
 * Appels à l'API.
 *
 * Même origine que la page (Vite relaie `/api` en développement) : le cookie
 * de session part tout seul. Chaque appel porte l'en-tête `x-vennora`, exigé
 * par l'API sur toute écriture (garde CSRF).
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Les dates arrivent en texte ISO : on les rend en `Date`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-vennora": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(
      "Connexion impossible. Vérifiez votre réseau et réessayez.",
      0,
      "NETWORK",
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? JSON.parse(text, reviveDates) : undefined;

  if (!response.ok) {
    throw new ApiError(
      data?.error ?? "Une erreur est survenue. Réessayez dans un instant.",
      response.status,
      data?.code ?? "INTERNAL",
      data?.fieldErrors,
    );
  }
  return data as T;
}

/** Chaîne de requête sans les valeurs vides. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
