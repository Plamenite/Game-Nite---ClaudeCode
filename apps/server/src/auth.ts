import { ServerError, type AuthContext } from "colyseus";

/** What every room learns about a connected player. */
export interface PlayerAuth {
  userId: string;
}

/**
 * Shared by every room. Runs at matchmaking time, before a seat is taken.
 *
 * WALKING SKELETON: the app sends a temporary guest token and we trust it.
 * Once Supabase login exists, this verifies a Supabase JWT and returns its
 * real user id, and guests become Supabase anonymous users.
 */
export async function authenticate(token: string, _options: unknown, _context: AuthContext): Promise<PlayerAuth> {
  if (!token) {
    throw new ServerError(401, "missing auth token");
  }
  // TODO(supabase): verify the token as a Supabase JWT.
  return { userId: token };
}
