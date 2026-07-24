import { useEffect, useState, useTransition } from "react";
import { api, type MeshEntry, type Settings } from "./lib/api";

function formatSeen(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 1 / 24) return "just now";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h ago`;
  return `${Math.floor(days)}d ago`;
}

export function App() {
  const [entries, setEntries] = useState<MeshEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MeshEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [offlineDays, setOfflineDays] = useState(7);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [mesh, s] = await Promise.all([api.listMesh(), api.settings()]);
    setEntries(mesh.entries);
    setSettings(s);
    setOfflineDays(s.offlineDays);
  }

  useEffect(() => {
    startTransition(() => {
      void refresh().catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    });
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const loading = pending || busy;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>
            mesh<span>flare</span>
          </h1>
          <p>
            Manage Cloudflare Mesh nodes and devices, sync{" "}
            <span className="mono">*.{settings?.meshSuffix ?? "mesh"}</span> DNS when
            an IP is known, and keep offline devices tidy.
          </p>
        </div>
        <div className="toolbar">
          <button
            className="btn"
            disabled={loading}
            onClick={() => void run(async () => { await api.syncDns(); setNotice("DNS sync complete."); })}
          >
            Sync DNS
          </button>
          <button
            className="btn"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                const r = await api.cleanup();
                setNotice(`Cleanup finished: ${JSON.stringify(r.cleanup)}`);
              })
            }
          >
            Run cleanup
          </button>
          <button className="btn" disabled={loading} onClick={() => void run(async () => { await refresh(); })}>
            Refresh
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="btn btn-ghost" style={{ marginLeft: "0.75rem" }} onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>Create mesh node</h2>
          <div className="field">
            <label htmlFor="new-node">Name</label>
            <input
              id="new-node"
              type="text"
              value={newName}
              placeholder="edge-1"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  void run(async () => {
                    const r = await api.createNode(newName.trim());
                    setNewName("");
                    if (r.notice) setNotice(r.notice);
                    else setNotice(`Created node "${r.node.name}".`);
                  });
                }
              }}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={loading || !newName.trim()}
            onClick={() =>
              void run(async () => {
                const r = await api.createNode(newName.trim());
                setNewName("");
                if (r.notice) setNotice(r.notice);
                else setNotice(`Created node "${r.node.name}".`);
              })
            }
          >
            Create node
          </button>
          <p className="hint" style={{ marginTop: "0.85rem" }}>
            DNS for <span className="mono">name.mesh</span> appears only after the
            connector registers and Cloudflare assigns a Mesh IP.
          </p>
        </section>

        <section className="panel">
          <h2>Settings</h2>
          <div className="field">
            <label htmlFor="offline-days">Auto-delete devices offline after (days)</label>
            <input
              id="offline-days"
              type="number"
              min={1}
              max={365}
              value={offlineDays}
              onChange={(e) => setOfflineDays(Number(e.target.value))}
            />
          </div>
          <button
            className="btn"
            disabled={loading || !settings}
            onClick={() =>
              void run(async () => {
                await api.patchSettings({ offlineDays });
                setNotice(`Offline threshold set to ${offlineDays} days.`);
              })
            }
          >
            Save threshold
          </button>

          <div className="switch-row" style={{ marginTop: "1.25rem" }}>
            <div>
              <div>OISD Small</div>
              <p className="hint">
                Account-wide Gateway block lists. Status:{" "}
                <span className="mono">{settings?.oisdStatus ?? "…"}</span>
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={loading || !settings}
              onClick={() =>
                void run(async () => {
                  const next = !settings!.oisdEnabled;
                  await api.patchSettings({ oisdEnabled: next });
                  setNotice(
                    next
                      ? "OISD enable queued — lists sync over the next few cron ticks."
                      : "OISD disable queued.",
                  );
                })
              }
            >
              {settings?.oisdEnabled ? "Disable" : "Enable"}
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>
          Mesh inventory{" "}
          <span className="hint">({entries.length})</span>
        </h2>
        {entries.length === 0 ? (
          <div className="empty">{loading ? "Loading…" : "No nodes or devices yet."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>.mesh</th>
                  <th>IPv4</th>
                  <th>Last seen</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={`${e.kind}-${e.id}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelected(e);
                      setRenameValue(e.name);
                    }}
                  >
                    <td>
                      <strong>{e.name}</strong>
                    </td>
                    <td>
                      <span className={`badge ${e.kind}`}>{e.kind}</span>
                    </td>
                    <td className="mono">{e.meshHostname ?? "—"}</td>
                    <td className="mono">{e.ipv4 ?? "—"}</td>
                    <td>{formatSeen(e.lastSeenAt)}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(ev) => ev.stopPropagation()}>
            <h3>{selected.name}</h3>
            <div className="meta">
              <span className={`badge ${selected.kind}`}>{selected.kind}</span>
              {" · "}
              <span className="mono">{selected.id.slice(0, 8)}…</span>
            </div>

            <div className="field">
              <label htmlFor="rename">Name (also drives .mesh)</label>
              <input
                id="rename"
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <div className="row-actions" style={{ marginBottom: "1rem" }}>
              <button
                className="btn btn-primary"
                disabled={loading || !renameValue.trim()}
                onClick={() =>
                  void run(async () => {
                    const r = await api.rename(selected.kind, selected.id, renameValue.trim());
                    if (r.notice) setNotice(r.notice);
                    else setNotice(`Renamed to "${renameValue.trim()}".`);
                    setSelected(null);
                  })
                }
              >
                Save name
              </button>
            </div>

            <p className="hint">
              Hostname:{" "}
              <span className="mono">
                {selected.meshHostname ?? "(pending IP discovery)"}
              </span>
              <br />
              IPv4: <span className="mono">{selected.ipv4 ?? "—"}</span>
              <br />
              IPv6: <span className="mono">{selected.ipv6 ?? "—"}</span>
            </p>

            {selected.kind === "node" && (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  className="btn"
                  disabled={loading}
                  onClick={() =>
                    void run(async () => {
                      const r = await api.downloadWireGuard(selected.id, selected.name);
                      if ("needsDocker" in r && r.needsDocker) {
                        await navigator.clipboard.writeText(r.command);
                        setNotice(
                          `WireGuard extract needs Docker locally (copied command). ${r.note}`,
                        );
                      } else {
                        setNotice(
                          `Downloaded WireGuard conf for "${selected.name}". This creates a new connector registration.`,
                        );
                      }
                    })
                  }
                >
                  Download WireGuard .conf
                </button>
                <p className="hint" style={{ marginTop: "0.5rem" }}>
                  Enrollment uses warp-cli (proprietary API). On Workers Free we
                  copy a Docker one-liner; set WG_EXTRACTOR_URL or enable
                  Containers (Paid) for server-side .conf download.
                </p>
              </div>
            )}

            <div style={{ marginTop: "1.5rem" }}>
              <button
                className="btn btn-danger"
                disabled={loading}
                onClick={() =>
                  void run(async () => {
                    const label = selected.kind === "node" ? "node" : "device";
                    if (!confirm(`Delete ${label} "${selected.name}"?`)) return;
                    await api.remove(selected.kind, selected.id);
                    setNotice(`Deleted ${label} "${selected.name}".`);
                    setSelected(null);
                  })
                }
              >
                Delete {selected.kind}
              </button>
            </div>

            <button
              className="btn btn-ghost"
              style={{ marginTop: "1.5rem" }}
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
