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
export async function flush(
  sender: (p: string, i: RequestInit) => Promise<any>,
) {
  if (!navigator.onLine) return false;
  const q = read();
  for (const item of q) {
    try {
      await sender(item.path, item.init);
      localStorage.setItem(
        store,
        JSON.stringify(read().filter((x) => x.id !== item.id)),
      );
    } catch {
      return false;
    }
  }
  return read().length === 0;
}
