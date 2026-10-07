type Pending = { id: string; path: string; init: RequestInit };
const store = "kirfit_pending";

export type RestTimerState = { startedAt: number; durationSeconds: number };
export function remainingRestSeconds(timer: RestTimerState, now = Date.now()) {
  return Math.max(
    0,
    Math.ceil(timer.durationSeconds - (now - timer.startedAt) / 1000),
  );
}
const read = (): Pending[] => JSON.parse(localStorage.getItem(store) || "[]");
export function queue(item: Pending) {
  const q = read();
  if (!q.some((x) => x.id === item.id)) q.push(item);
  localStorage.setItem(store, JSON.stringify(q));
}
export function discardWorkoutFinishes() {
  localStorage.setItem(
    store,
    JSON.stringify(read().filter((item) => !item.path.endsWith("/finish"))),
  );
}
export function discardWorkout(sessionId: string) {
  localStorage.setItem(
    store,
    JSON.stringify(
      read().filter((item) => !item.path.startsWith(`/workouts/${sessionId}/`)),
    ),
  );
}
type Sender = (p: string, i: RequestInit) => Promise<any>;
const inFlight = new Map<string, Promise<boolean>>();

function sendPending(item: Pending, sender: Sender) {
  const existing = inFlight.get(item.id);
  if (existing) return existing;
  // Online sync and workout finish must await the same write. Remove it only
  // after success, reading the latest queue to preserve newly queued writes.
  const sending = Promise.resolve()
    .then(() => sender(item.path, item.init))
    .then(() => {
      localStorage.setItem(
        store,
        JSON.stringify(read().filter((x) => x.id !== item.id)),
      );
      return true;
    })
    .catch(() => false)
    .finally(() => inFlight.delete(item.id));
  inFlight.set(item.id, sending);
  return sending;
}

async function flushMatching(sender: Sender, matches: (item: Pending) => boolean) {
  const q = read().filter(matches);
  if (!navigator.onLine) return q.length === 0;
  for (const item of q) {
    // Another flush may already have saved this snapshot entry.
    if (!read().some((x) => x.id === item.id)) continue;
    if (!(await sendPending(item, sender))) return false;
  }
  return !read().some(matches);
}

export function flush(sender: Sender) {
  return flushMatching(sender, () => true);
}

export function flushWorkoutSets(sender: Sender, sessionId: string) {
  return flushMatching(
    sender,
    (item) => item.path === `/workouts/${sessionId}/sets`,
  );
}
