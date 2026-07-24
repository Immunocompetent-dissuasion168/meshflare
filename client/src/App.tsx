import { useEffect, useMemo, useState, useTransition } from "react";
import { api, type MeshEntry, type Settings } from "./lib/api";
import { ToastStack, useToasts } from "./lib/toasts";
import {
  copyText,
  isNodeOffline,
  oisdStatusMeta,
  warpConnectorInstallCommand,
} from "./lib/warp";

type KindFilter = "all" | "node" | "device";
type SortKey = "name" | "kind" | "meshHostname" | "ipv4" | "lastSeenAt" | "status" | "createdAt";

function formatSeen(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 1 / 24) return "just now";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h ago`;
  return `${Math.floor(days)}d ago`;
}

function sortValue(entry: MeshEntry, key: SortKey): string | number {
  switch (key) {
    case "name":
      return entry.name.toLowerCase();
    case "kind":
      return entry.kind;
    case "meshHostname":
      return entry.meshHostname?.toLowerCase() ?? "";
    case "ipv4":
      return entry.ipv4 ?? "";
    case "lastSeenAt":
      return Date.parse(entry.lastSeenAt ?? "") || 0;
    case "status":
      return entry.status.toLowerCase();
    case "createdAt":
      return Date.parse(entry.createdAt) || 0;
  }
}

export function App() {
  const [entries, setEntries] = useState<MeshEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<MeshEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [offlineDays, setOfflineDays] = useState(7);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [installLoading, setInstallLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { toasts, push, dismiss } = useToasts();

  async function refresh() {
    const [mesh, s] = await Promise.all([api.listMesh(), api.settings()]);
    setEntries(mesh.entries);
    setSettings(s);
    setOfflineDays(s.offlineDays);
    return mesh.entries;
  }

  useEffect(() => {
    startTransition(() => {
      void refresh().catch((e: unknown) =>
        push(e instanceof Error ? e.message : String(e), "error"),
      );
    });
  }, []);

  useEffect(() => {
    if (!selected || selected.kind !== "node" || !isNodeOffline(selected.status)) {
      setInstallCmd(null);
      return;
    }

    let cancelled = false;
    setInstallLoading(true);
    void api
      .getNodeToken(selected.id)
      .then((r) => {
        if (!cancelled) setInstallCmd(warpConnectorInstallCommand(r.token));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setInstallCmd(null);
          push(e instanceof Error ? e.message : String(e), "error");
        }
      })
      .finally(() => {
        if (!cancelled) setInstallLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.kind, selected?.status]);

  const visibleEntries = useMemo(() => {
    const filtered =
      kindFilter === "all" ? entries : entries.filter((e) => e.kind === kindFilter);
    const sorted = [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, kindFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "kind" || key === "status" ? "asc" : "desc");
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function createNode() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await api.createNode(name);
      setNewName("");
      const list = await refresh();
      const created =
        list.find((e) => e.kind === "node" && e.id === r.node.id) ??
        ({
          kind: "node",
          id: r.node.id,
          name: r.node.name,
          meshHostname: null,
          ipv4: null,
          ipv6: null,
          status: "down",
          lastSeenAt: null,
          createdAt: r.node.created_at ?? new Date().toISOString(),
          tunnelType: "warp_connector",
          isConnector: true,
        } satisfies MeshEntry);

      setSelected(created);
      setRenameValue(created.name);
      push(r.notice ?? `Created node "${r.node.name}".`, r.notice ? "info" : "success");
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCreating(false);
    }
  }

  const loading = pending || busy;
  const oisdMeta = oisdStatusMeta(settings?.oisdStatus ?? "idle", settings?.oisdEnabled ?? false);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>
            mesh<span>flare</span>
          </h1>
          <p>Manage Cloudflare Mesh nodes and devices.</p>
        </div>
        <div className="toolbar">
          <button
            className="btn"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                await api.syncDns();
                push("DNS sync complete.", "success");
              })
            }
          >
            Sync DNS
          </button>
          <button
            className="btn"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                const r = await api.cleanup();
                push(`Cleanup finished: ${JSON.stringify(r.cleanup)}`, "success");
              })
            }
          >
            Run cleanup
          </button>
          <button
            className="btn"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                await refresh();
                push("Refreshed.", "success");
              })
            }
          >
            Refresh
          </button>
        </div>
      </header>

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
              disabled={creating}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) void createNode();
              }}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={creating || !newName.trim()}
            onClick={() => void createNode()}
          >
            {creating ? "Creating…" : "Create node"}
          </button>
          <p className="hint" style={{ marginTop: "0.85rem" }}>
            DNS for <span className="mono">name.mesh</span> appears only after an IP is
            known.
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
                push(`Offline threshold set to ${offlineDays} days.`, "success");
              })
            }
          >
            Save threshold
          </button>

          <div className="switch-row" style={{ marginTop: "1.25rem" }}>
            <div>
              <div className="status-label">
                OISD Small
                <span
                  className="status-dot"
                  data-tone={oisdMeta.tone}
                  data-tip={oisdMeta.tip}
                  tabIndex={0}
                  aria-label={oisdMeta.tip}
                />
              </div>
              <p className="hint">Account-wide Gateway block lists. Refreshes every 6 hours when on.</p>
            </div>
            <button
              className="btn btn-primary"
              disabled={loading || !settings}
              onClick={() =>
                void run(async () => {
                  const next = !settings!.oisdEnabled;
                  await api.patchSettings({ oisdEnabled: next });
                  push(next ? "OISD enable queued." : "OISD disable queued.", "success");
                })
              }
            >
              {settings?.oisdEnabled ? "Disable" : "Enable"}
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>
            Mesh inventory{" "}
            <span className="hint">({visibleEntries.length})</span>
          </h2>
          <div className="filters">
            {([
              ["all", "All"],
              ["node", "Nodes"],
              ["device", "Devices"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn ${kindFilter === value ? "btn-active" : ""}`}
                onClick={() => setKindFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="empty">{loading ? "Loading…" : "No nodes or devices yet."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      ["name", "Name"],
                      ["kind", "Type"],
                      ["meshHostname", ".mesh"],
                      ["ipv4", "IPv4"],
                      ["lastSeenAt", "Last seen"],
                      ["status", "Status"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className={`sortable ${sortKey === key ? "sorted" : ""}`}
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((e) => (
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
                    push(
                      r.notice ?? `Renamed to "${renameValue.trim()}".`,
                      r.notice ? "info" : "success",
                    );
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

            {selected.kind === "node" && isNodeOffline(selected.status) && (
              <div className="install-box">
                <div className="row-actions">
                  <strong style={{ fontSize: "0.85rem" }}>Install &amp; connect (warp-cli)</strong>
                  <button
                    className="btn"
                    disabled={!installCmd || installLoading}
                    onClick={() =>
                      void (async () => {
                        if (!installCmd) return;
                        try {
                          await copyText(installCmd);
                          push("Install command copied.", "success");
                        } catch (e) {
                          push(
                            e instanceof Error ? e.message : "Could not copy",
                            "error",
                          );
                        }
                      })()
                    }
                  >
                    Copy
                  </button>
                </div>
                <p className="hint" style={{ marginTop: "0.4rem" }}>
                  Run on the host that should join this mesh node (Debian/Ubuntu).
                </p>
                <pre>{installLoading ? "Loading token…" : installCmd ?? "—"}</pre>
              </div>
            )}

            {selected.kind === "node" && (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  className="btn"
                  disabled={loading}
                  onClick={() =>
                    void run(async () => {
                      await api.downloadWireGuard(selected.id, selected.name);
                      push(`Downloaded WireGuard conf for "${selected.name}".`, "success");
                    })
                  }
                >
                  Download WireGuard .conf
                </button>
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
                    push(`Deleted ${label} "${selected.name}".`, "success");
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

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
