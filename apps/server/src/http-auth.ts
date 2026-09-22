import { authenticate, type PlayerAuth } from "./auth.js";

/** Verify the bearer token the SDK attaches to every http call. */
export async function playerFromHeader(header: string | null): Promise<PlayerAuth | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return await authenticate(token, {}, {} as never);
  } catch {
    return null;
  }
}

/**
 * A request body validator in the router's "standard schema" shape, from a
 * plain function that returns the typed value or an error message.
 */
export function bodySchema<T>(check: (value: unknown) => T | string) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "gamenite",
      validate: (value: unknown): { value: T } | { issues: { message: string }[] } => {
        const result = check(value);
        return typeof result === "string" ? { issues: [{ message: result }] } : { value: result };
      },
      /** Type-only: what the validator accepts and produces. */
      types: undefined as unknown as { input: unknown; output: T },
    },
  };
}
