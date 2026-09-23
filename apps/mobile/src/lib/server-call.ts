/**
 * Every call to the game server goes through here, so that nothing on the
 * phone can wait forever. Windows' firewall silently drops requests to a
 * port nobody is listening on (for example when the server window was
 * closed), which otherwise leaves the app spinning with no error at all.
 */

const NETWORK_FAILURE = /network request failed|failed to fetch|econnrefused|econnreset|enetunreach|ehostunreach|etimedout|timed out|aborted|abort/i;

export function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { message, code, name } = error as { message?: unknown; code?: unknown; name?: unknown };
  return [message, code, name].some((part) => typeof part === 'string' && NETWORK_FAILURE.test(part));
}

export interface CallOptions {
  timeoutMs: number;
  /** Shown when the server cannot be reached or does not answer in time. */
  unreachable: string;
}

/**
 * Run one server call. `work` receives an AbortSignal to hand to fetch-style
 * calls. After `timeoutMs` it gives up with the `unreachable` message; a
 * room that connects after that is left straight away, never half-joined.
 */
export async function callWithTimeout<T>(work: (signal: AbortSignal) => Promise<T>, options: CallOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = work(controller.signal);
  // A late success after we gave up: close any room connection it opened.
  attempt
    .then((result) => {
      const room = result as { leave?: (consented?: boolean) => unknown } | null;
      if (timedOut && room && typeof room.leave === 'function') void Promise.resolve(room.leave(true)).catch(() => {});
    })
    .catch(() => {});

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(options.unreachable));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([attempt, deadline]);
  } catch (error) {
    if (!timedOut && isNetworkFailure(error)) throw new Error(options.unreachable);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
