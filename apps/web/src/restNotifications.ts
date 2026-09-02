const dismissedKey = "kirfit_rest_notifications_prompt_dismissed";
const notificationTag = "kirfit-rest-timer";
type MobileNotificationOptions = NotificationOptions & {
  timestamp?: number;
  renotify?: boolean;
};

export type RestNotificationPermission = NotificationPermission | "unsupported";

export function restNotificationsSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

export function restNotificationPermission(): RestNotificationPermission {
  return restNotificationsSupported()
    ? Notification.permission
    : "unsupported";
}

export function restNotificationPromptDismissed() {
  return localStorage.getItem(dismissedKey) === "1";
}

export function setRestNotificationPromptDismissed(dismissed: boolean) {
  if (dismissed) localStorage.setItem(dismissedKey, "1");
  else localStorage.removeItem(dismissedKey);
}

export function shouldPromptForRestNotifications() {
  return (
    restNotificationPermission() === "default" &&
    !restNotificationPromptDismissed()
  );
}

export async function requestRestNotificationPermission() {
  if (!restNotificationsSupported()) return "unsupported" as const;
  return Notification.requestPermission();
}

async function registration() {
  if (!restNotificationsSupported()) return null;
  return navigator.serviceWorker.ready;
}

export async function showRestTimerNotification(
  title: string,
  body: string,
  endsAt: number,
) {
  if (restNotificationPermission() !== "granted") return false;
  try {
    const serviceWorker = await registration();
    if (!serviceWorker) return false;
    const options: MobileNotificationOptions = {
      body,
      tag: notificationTag,
      icon: "/icon.svg",
      timestamp: endsAt,
      requireInteraction: true,
      silent: true,
    };
    await serviceWorker.showNotification(title, options);
    return true;
  } catch {
    return false;
  }
}

export async function showRestFinishedNotification(
  title: string,
  body: string,
) {
  if (restNotificationPermission() !== "granted") return false;
  try {
    const serviceWorker = await registration();
    if (!serviceWorker) return false;
    const options: MobileNotificationOptions = {
      body,
      tag: notificationTag,
      icon: "/icon.svg",
      requireInteraction: true,
      renotify: true,
    };
    await serviceWorker.showNotification(title, options);
    return true;
  } catch {
    return false;
  }
}

export async function closeRestTimerNotification() {
  if (restNotificationPermission() !== "granted") return;
  try {
    const serviceWorker = await registration();
    const notifications = await serviceWorker?.getNotifications({
      tag: notificationTag,
    });
    notifications?.forEach((notification) => notification.close());
  } catch {
    // Notification cleanup must never interrupt a workout action.
  }
}
