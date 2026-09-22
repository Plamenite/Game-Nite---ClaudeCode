/**
 * WALKING SKELETON identity: a throw-away guest id that lives only until
 * the app is closed. Supabase login replaces this with a real user.
 */
const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();

export const guest = {
  /** Sent to the server as the auth token for now. */
  token: `guest-${suffix}`,
  /** Shown to other players at the table. */
  name: `Guest ${suffix}`,
};
