import { setTimeout as delay } from "node:timers/promises";

// Shared by tasks in this process. Waiting tasks recheck after waking so that
// only one request claims each slot; cancellation never reserves a future slot.
export function createOriginScheduler(
  now = Date.now,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> =
    (ms, signal) => delay(ms, undefined, { signal }),
) {
  const origins = new Map<string, { started: number; interval: number }>();
  return async (origin: string, interval: number, signal: AbortSignal) => {
    while (true) {
      signal.throwIfAborted();
      const time = now();
      for (const [key, entry] of origins)
        if (time - entry.started >= Math.max(10_000, entry.interval))
          origins.delete(key);
      const previous = origins.get(origin);
      const wait = previous
        ? previous.started + Math.max(interval, previous.interval) - time
        : 0;
      if (wait > 0) {
        await sleep(wait, signal);
        continue;
      }
      origins.set(origin, { started: time, interval });
      return;
    }
  };
}

export const waitForOrigin = createOriginScheduler();
