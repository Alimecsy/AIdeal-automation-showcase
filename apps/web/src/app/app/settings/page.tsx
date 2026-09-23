import { apiFetch } from "@/lib/server-api";
import { requireWorkspace } from "@/lib/workspace";

type UsageSummary = {
  windowDays: number;
  totalEvents: number;
  totals: Array<{ eventType: string; count: number; quantity: number }>;
};

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  let usage: UsageSummary | null = null;
  if (workspace.membership.role === "owner_admin") {
    const response = await apiFetch("/usage/summary?days=30");
    if (response.ok) usage = (await response.json()) as UsageSummary;
  }

  return (
    <section>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">
        Manage workspace profile, users, roles, notification preferences, and security.
      </p>
      {workspace.membership.role === "owner_admin" ? (
        <div className="panel" style={{ marginTop: 24 }}>
          <h2 className="panel-title">Usage summary</h2>
          <p className="muted">Operational activity for the last 30 days. This is not billing or quota usage.</p>
          {!usage ? <p className="muted">Usage data is currently unavailable.</p> : (
            <>
              <div className="metric-grid" style={{ marginTop: 16 }}>
                <div className="metric-card"><div className="metric-label">Recorded events</div><div className="metric-value">{usage.totalEvents}</div></div>
                <div className="metric-card"><div className="metric-label">Event categories</div><div className="metric-value">{usage.totals.length}</div></div>
              </div>
              <div style={{ marginTop: 20 }}>
                {usage.totals.map((item) => (
                  <div className="deal-row" key={item.eventType}>
                    <strong>{item.eventType}</strong>
                    <span className="muted">{item.count} records</span>
                    <span className="chip chip-blue">{item.quantity} units</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
