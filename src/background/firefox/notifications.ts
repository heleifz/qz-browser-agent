/** Recreate a notification Firefox would otherwise dismiss. priority has no equivalent. */

const RENEWALS = 12;

export function installNotificationRenewal(chromeApi: NotificationChrome): void {
  const notifications = chromeApi.notifications;
  if (!notifications?.create || (notifications.create as Marked).qzFirefoxRenewal) return;
  const original = notifications.create.bind(notifications);
  const pending = new Map<string, { options: NotificationOptions; left: number }>();
  const wrapped: Marked = async (notificationId: string, options: NotificationOptions = {}) => {
    const created = await original(notificationId, options);
    const id = String(created || notificationId || "");
    if (options.requireInteraction && id) pending.set(id, { options, left: RENEWALS });
    return created;
  };
  wrapped.qzFirefoxRenewal = true;
  notifications.create = wrapped;
  notifications.onClosed?.addListener((id, byUser) => {
    const state = pending.get(id);
    if (!state) return;
    if (byUser === true || state.left <= 0) {
      pending.delete(id);
      return;
    }
    state.left -= 1;
    void original(id, state.options);
  });
  notifications.onClicked?.addListener(id => { pending.delete(id); });
}

interface NotificationOptions { requireInteraction?: boolean; priority?: number }
type Create = (notificationId: string, options?: NotificationOptions) => Promise<string> | string;
type Marked = Create & { qzFirefoxRenewal?: boolean };
interface NotificationChrome {
  notifications?: {
    create: Marked;
    onClosed?: { addListener(listener: (id: string, byUser: boolean) => void): void };
    onClicked?: { addListener(listener: (id: string) => void): void };
  };
}
