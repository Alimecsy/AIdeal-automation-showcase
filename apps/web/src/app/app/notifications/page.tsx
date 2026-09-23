import Link from "next/link";
import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/server-api";

type NotificationRecord = {
  id: string;
  dealId: string | null;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

async function markRead(formData: FormData) {
  "use server";
  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) return;
  await apiFetch(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST" });
  revalidatePath("/app/notifications");
}

async function getNotifications() {
  const response = await apiFetch("/notifications");
  if (!response.ok) throw new Error(`Failed to load notifications: ${response.status}`);
  return (await response.json()) as NotificationRecord[];
}

export default async function NotificationsPage() {
  const notifications = await getNotifications();
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">Operational events and review decisions for this workspace.</p>
        </div>
        <span className="chip chip-blue">{unreadCount} unread</span>
      </header>

      <section className="panel" aria-label="Workspace notifications">
        {notifications.length === 0 ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          <div className="notification-list">
            {notifications.map((notification) => (
              <article className={`notification-row ${notification.readAt ? "" : "notification-unread"}`} key={notification.id}>
                <div>
                  <div className="notification-heading">
                    <strong>{notification.title}</strong>
                    <span className={`chip ${notification.priority === "high" || notification.priority === "urgent" ? "chip-warning" : "chip-blue"}`}>
                      {notification.priority}
                    </span>
                  </div>
                  <div className="muted">{notification.body ?? notification.type} · {new Date(notification.createdAt).toLocaleString()}</div>
                  {notification.dealId ? <Link className="text-link" href={`/app/deals/${notification.dealId}`}>Open deal</Link> : null}
                </div>
                {!notification.readAt ? (
                  <form action={markRead}>
                    <input type="hidden" name="notificationId" value={notification.id} />
                    <button className="button button-secondary" type="submit">Mark read</button>
                  </form>
                ) : <span className="muted">Read</span>}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
