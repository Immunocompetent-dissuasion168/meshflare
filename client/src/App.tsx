import { useEffect, useMemo, useState, useTransition, type TransitionEvent } from "react";
import {
  Loader2,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  Smartphone,
  X,
} from "lucide-react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router";
import { api, type MeshEntry, type Settings } from "./lib/api";
import { ToastStack, useToasts } from "./lib/toasts";
import {
  copyText,
  isNodeOffline,
  dnsFilterStatusMeta,
  machineStatusMeta,
  warpConnectorInstallCommand,
} from "./lib/warp";

type Tab = "machines" | "settings";
type KindFilter = "all" | "node" | "device";
type SortKey = "name" | "kind" | "meshHostname" | "ipv4" | "lastSeenAt" | "status" | "createdAt";
type Busy =
  | null
  | "sync"
  | "cleanup"
  | "refresh"
  | "settings"
  | "dns-filter"
  | "rename"
  | "wg"
  | "delete"
  | "domain"
  | "filter-url";

const SORT_KEYS: SortKey[] = [
  "name",
  "kind",
  "meshHostname",
  "ipv4",
  "lastSeenAt",
  "status",
  "createdAt",
];

function parseKind(value: string | null): KindFilter {
  return value === "node" || value === "device" ? value : "all";
}

function parseSort(value: string | null): SortKey {
  return value && SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : "createdAt";
}

function formatSeen(iso: string | null | undefined, empty = "—"): string {
  if (!iso) return empty;
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

function KindBadge({ kind }: { kind: "node" | "device" }) {
  const Icon = kind === "node" ? Server : Smartphone;
  return (
    <span className={`badge ${kind}`}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {kind}
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="btn-spin">
      <Loader2 size={14} strokeWidth={2.5} className="spin" aria-hidden />
      {label}
    </span>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

function CopyValue({
  value,
  onCopied,
}: {
  value: string | null;
  onCopied: (label: string) => void;
}) {
  if (!value) return <span className="mono muted">—</span>;
  return (
    <button
      type="button"
      className="copy-chip mono"
      title="Click to copy"
      onClick={(e) => {
        e.stopPropagation();
        void (async () => {
          try {
            await copyText(value);
            onCopied(value);
          } catch {
            /* toast handled by caller if needed */
          }
        })();
      }}
    >
      {value}
    </button>
  );
}

export function App() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = location.pathname.startsWith("/settings") ? "settings" : "machines";

  const kindFilter = parseKind(searchParams.get("kind"));
  const search = searchParams.get("q") ?? "";
  const sortKey = parseSort(searchParams.get("sort"));
  const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const selectedId = searchParams.get("id");

  const [entries, setEntries] = useState<MeshEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drawerEntry, setDrawerEntry] = useState<MeshEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [offlineDays, setOfflineDays] = useState(7);
  const [meshSuffixDraft, setMeshSuffixDraft] = useState("mesh");
  const [filterUrlDraft, setFilterUrlDraft] = useState("https://small.oisd.nl/");
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [installLoading, setInstallLoading] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const locked = busy !== null || creating;
  const selected =
    selectedId && drawerEntry?.id === selectedId
      ? drawerEntry
      : selectedId
        ? (entries.find((e) => e.id === selectedId) ?? drawerEntry)
        : drawerEntry;

  function patchParams(mutate: (next: URLSearchParams) => void) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace: true },
    );
  }

  function openEntry(entry: MeshEntry) {
    setDrawerEntry(entry);
    setRenameValue(entry.name);
    patchParams((next) => {
      next.set("id", entry.id);
    });
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    if (selectedId) {
      patchParams((next) => {
        next.delete("id");
      });
    }
  }

  function onDrawerTransitionEnd(e: TransitionEvent<HTMLDivElement>) {
    if (e.propertyName !== "opacity" || drawerOpen) return;
    setDrawerEntry(null);
  }

  async function refresh() {
    const [mesh, s] = await Promise.all([api.listMesh(), api.settings()]);
    setEntries(mesh.entries);
    setSettings(s);
    setOfflineDays(s.offlineDays);
    setMeshSuffixDraft(s.meshSuffix);
    setFilterUrlDraft(s.dnsFilterUrl);
    setReady(true);
    return mesh.entries;
  }

  useEffect(() => {
    startTransition(() => {
      void refresh().catch((e: unknown) => {
        setReady(true);
        push(e instanceof Error ? e.message : String(e), "error");
      });
    });
  }, []);

  // DNS filter enable/disable runs in the background cron — poll while in flight.
  useEffect(() => {
    const status = settings?.dnsFilterStatus;
    if (
      !status ||
      !["pending_enable", "syncing", "pending_refresh", "pending_disable"].includes(status)
    ) {
      return;
    }
    const id = window.setInterval(() => {
      void api
        .settings()
        .then((s) => {
          setSettings(s);
        })
        .catch(() => {
          /* ignore transient poll errors */
        });
    }, 3000);
    return () => window.clearInterval(id);
  }, [settings?.dnsFilterStatus]);

  useEffect(() => {
    if (!selectedId) {
      if (drawerOpen) setDrawerOpen(false);
      return;
    }
    const found = entries.find((e) => e.id === selectedId);
    if (!found) return;
    setDrawerEntry((prev) => (prev?.id === found.id ? prev : found));
    setRenameValue(found.name);
    requestAnimationFrame(() => setDrawerOpen(true));
  }, [selectedId, entries]);

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
    const q = search.trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.meshHostname?.toLowerCase().includes(q) ?? false) ||
        (e.ipv4?.includes(q) ?? false) ||
        e.status.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [entries, kindFilter, sortKey, sortDir, search]);

  function toggleSort(key: SortKey) {
    patchParams((next) => {
      if (sortKey === key) {
        next.set("dir", sortDir === "asc" ? "desc" : "asc");
      } else {
        next.set("sort", key);
        next.set(
          "dir",
          key === "name" || key === "kind" || key === "status" ? "asc" : "desc",
        );
      }
      if (next.get("sort") === "createdAt") next.delete("sort");
      if (next.get("dir") === "desc" && (next.get("sort") ?? "createdAt") === "createdAt") {
        next.delete("dir");
      }
    });
  }

  async function run(key: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      await refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function createNode() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await api.createNode(name);
      setNewName("");
      setCreateOpen(false);
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

      openEntry(created);
      push(r.notice ?? `Created node "${r.node.name}".`, r.notice ? "info" : "success");
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCreating(false);
    }
  }

  const filterMeta = dnsFilterStatusMeta(settings?.dnsFilterStatus ?? "idle", settings?.dnsFilterEnabled ?? false);
  const settingsReady = ready && settings !== null;
  const accountLine = settings?.accountName
    ? settings.accountEmail
      ? `${settings.accountName} · ${settings.accountEmail}`
      : settings.accountName
    : ready
      ? "Cloudflare account"
      : "Loading…";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Link to="/machines" className="brand-link" title="Machines">
            <img src="/icon-192.png" alt="" className="brand-mark" width={32} height={32} />
            <h1>
              mesh<span>flare</span>
            </h1>
          </Link>
          <p className="account-line">{accountLine}</p>
        </div>
        <nav className="tabs" aria-label="Primary">
          <NavLink
            to="/machines"
            className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
          >
            <Server size={14} strokeWidth={2.25} aria-hidden />
            Machines
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
          >
            <SettingsIcon size={14} strokeWidth={2.25} aria-hidden />
            Settings
          </NavLink>
        </nav>
      </header>

      {tab === "machines" && (
        <>
          <section className="panel">
            <div className="machines-toolbar">
              <div className="search-wrap">
                <Search size={15} strokeWidth={2.25} aria-hidden />
                <input
                  type="search"
                  placeholder="Search machines…"
                  value={search}
                  onChange={(e) => {
                    const value = e.target.value;
                    patchParams((next) => {
                      if (value) next.set("q", value);
                      else next.delete("q");
                    });
                  }}
                  disabled={!ready}
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={locked}
                onClick={() => {
                  setNewName("");
                  setCreateOpen(true);
                }}
              >
                Create node
              </button>
            </div>
          </section>

          <section className="panel" aria-busy={!ready}>
            <div className="panel-head">
              <h2>
                Machines{" "}
                <span className="hint">({ready ? visibleEntries.length : "…"})</span>
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
                    disabled={!ready}
                    onClick={() =>
                      patchParams((next) => {
                        if (value === "all") next.delete("kind");
                        else next.set("kind", value);
                      })
                    }
                  >
                    {value === "node" ? (
                      <span className="filter-label">
                        <Server size={13} strokeWidth={2.25} aria-hidden />
                        {label}
                      </span>
                    ) : value === "device" ? (
                      <span className="filter-label">
                        <Smartphone size={13} strokeWidth={2.25} aria-hidden />
                        {label}
                      </span>
                    ) : (
                      label
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-icon"
                  disabled={locked}
                  title="Refresh"
                  aria-label="Refresh"
                  onClick={() =>
                    void run("refresh", async () => {
                      push("Refreshed.", "success");
                    })
                  }
                >
                  {busy === "refresh" ? (
                    <Loader2 size={15} strokeWidth={2.25} className="spin" aria-hidden />
                  ) : (
                    <RefreshCw size={15} strokeWidth={2.25} aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {!ready ? (
              <div className="table-wrap" aria-label="Loading machines">
                <table>
                  <thead>
                    <tr>
                      {["Name", "Type", "Domain", "IPv4", "Last seen", "Status"].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 5 }, (_, i) => (
                      <tr key={i} className="skeleton-row-tr">
                        {Array.from({ length: 6 }, (_, j) => (
                          <td key={j}>
                            <SkeletonBlock className="skeleton-cell" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="empty">
                {search.trim() || kindFilter !== "all"
                  ? "No machines match this filter."
                  : "No machines yet."}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {(
                        [
                          ["name", "Name"],
                          ["kind", "Type"],
                          ["meshHostname", "Domain"],
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
                        onClick={() => openEntry(e)}
                      >
                        <td>
                          <strong className="name-cell">
                            {e.kind === "node" ? (
                              <Server
                                size={14}
                                strokeWidth={2.25}
                                className="kind-icon node"
                                aria-hidden
                              />
                            ) : (
                              <Smartphone
                                size={14}
                                strokeWidth={2.25}
                                className="kind-icon device"
                                aria-hidden
                              />
                            )}
                            {e.name}
                          </strong>
                        </td>
                        <td>
                          <KindBadge kind={e.kind} />
                        </td>
                        <td>
                          <CopyValue
                            value={e.meshHostname}
                            onCopied={(v) => push(`Copied ${v}`, "success")}
                          />
                        </td>
                        <td>
                          <CopyValue
                            value={e.ipv4}
                            onCopied={(v) => push(`Copied ${v}`, "success")}
                          />
                        </td>
                        <td>{formatSeen(e.lastSeenAt)}</td>
                        <td>
                          {(() => {
                            const meta = machineStatusMeta(e.status);
                            return (
                              <span className="machine-status">
                                <span
                                  className="status-dot"
                                  data-tone={meta.tone}
                                  aria-hidden
                                />
                                {meta.label}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "settings" && (
        <section className="panel settings-panel" aria-busy={!settingsReady}>
          <h2>Settings</h2>
          {!settingsReady ? (
            <div className="skeleton-stack">
              <SkeletonBlock className="skeleton-label" />
              <SkeletonBlock className="skeleton-input" />
              <SkeletonBlock className="skeleton-btn" />
              <SkeletonBlock className="skeleton-row" />
            </div>
          ) : (
            <div className="settings-grid">
              <div className="settings-block">
                <h3>Mesh domain</h3>
                <p className="hint">Hostname suffix for machine DNS overrides.</p>
                <div className="field">
                  <label htmlFor="mesh-suffix">Domain</label>
                  <div className="suffix-input">
                    <span className="suffix-dot">.</span>
                    <input
                      id="mesh-suffix"
                      type="text"
                      value={meshSuffixDraft}
                      disabled={locked}
                      onChange={(e) => setMeshSuffixDraft(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={
                    locked ||
                    !meshSuffixDraft.trim() ||
                    meshSuffixDraft.trim().replace(/^\.+/, "") === settings.meshSuffix
                  }
                  onClick={() =>
                    void run("domain", async () => {
                      await api.patchSettings({ meshSuffix: meshSuffixDraft });
                      push(`Mesh domain set to .${meshSuffixDraft.replace(/^\.+/, "")}.`, "success");
                    })
                  }
                >
                  {busy === "domain" ? <Spinner label="Saving…" /> : "Save domain"}
                </button>
              </div>

              <div className="settings-block">
                <h3>Auto-delete</h3>
                <p className="hint">Remove devices offline longer than this threshold. Nodes are never auto-deleted.</p>
                <div className="field">
                  <label htmlFor="offline-days">Days offline</label>
                  <input
                    id="offline-days"
                    type="number"
                    min={1}
                    max={365}
                    value={offlineDays}
                    disabled={locked}
                    onChange={(e) => setOfflineDays(Number(e.target.value))}
                  />
                </div>
                <button
                  className="btn"
                  disabled={locked || offlineDays === settings.offlineDays}
                  onClick={() =>
                    void run("settings", async () => {
                      await api.patchSettings({ offlineDays });
                      push(`Offline threshold set to ${offlineDays} days.`, "success");
                    })
                  }
                >
                  {busy === "settings" ? <Spinner label="Saving…" /> : "Save threshold"}
                </button>
              </div>

              <div className="settings-block">
                <h3>DNS filtering</h3>
                <div className="status-label" style={{ marginBottom: "0.35rem" }}>
                  Status
                  <span
                    className="status-dot"
                    data-tone={filterMeta.tone}
                    data-tip={filterMeta.tip}
                    tabIndex={0}
                    aria-label={filterMeta.tip}
                  />
                  <span className="hint">{filterMeta.tip}</span>
                </div>
                <p className="hint">
                  Account-wide Gateway block list from any domain-list URL.
                  {filterMeta.tone === "ok" && settings.dnsFilterLastSyncedAt
                    ? ` Last refresh ${formatSeen(settings.dnsFilterLastSyncedAt)}.`
                    : null}
                </p>
                <div className="field">
                  <label htmlFor="filter-url">List URL</label>
                  <input
                    id="filter-url"
                    type="url"
                    value={filterUrlDraft}
                    disabled={locked}
                    onChange={(e) => setFilterUrlDraft(e.target.value)}
                  />
                </div>
                <div className="row-actions">
                  <button
                    className="btn"
                    disabled={
                      locked ||
                      !filterUrlDraft.trim() ||
                      filterUrlDraft.trim() === settings.dnsFilterUrl
                    }
                    onClick={() =>
                      void run("filter-url", async () => {
                        await api.patchSettings({ dnsFilterUrl: filterUrlDraft });
                        push(
                          settings.dnsFilterEnabled
                            ? "Filter URL updated; rebuilding lists."
                            : "Filter URL saved.",
                          "success",
                        );
                      })
                    }
                  >
                    {busy === "filter-url" ? <Spinner label="Saving…" /> : "Save URL"}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={locked}
                    onClick={() =>
                      void run("dns-filter", async () => {
                        const next = !settings.dnsFilterEnabled;
                        await api.patchSettings({ dnsFilterEnabled: next });
                        push(next ? "DNS filter enable queued." : "DNS filter disable queued.", "success");
                      })
                    }
                  >
                    {busy === "dns-filter" ? (
                      <Spinner label={settings.dnsFilterEnabled ? "Disabling…" : "Enabling…"} />
                    ) : settings.dnsFilterEnabled ? (
                      "Disable"
                    ) : (
                      "Enable"
                    )}
                  </button>
                </div>
              </div>

              <div className="settings-block">
                <h3>Maintenance</h3>
                <div className="maint-row">
                  <div>
                    <strong>Sync DNS</strong>
                    <p className="hint">Last run {formatSeen(settings.lastDnsSyncAt, "never")}.</p>
                  </div>
                  <button
                    className="btn"
                    disabled={locked}
                    onClick={() =>
                      void run("sync", async () => {
                        await api.syncDns();
                        push("DNS sync complete.", "success");
                      })
                    }
                  >
                    {busy === "sync" ? <Spinner label="Syncing…" /> : "Run now"}
                  </button>
                </div>
                <div className="maint-row">
                  <div>
                    <strong>Cleanup</strong>
                    <p className="hint">Last run {formatSeen(settings.lastCleanupAt, "never")}.</p>
                  </div>
                  <button
                    className="btn"
                    disabled={locked}
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete devices offline longer than ${offlineDays} day${offlineDays === 1 ? "" : "s"}? Nodes are never deleted.`,
                        )
                      ) {
                        return;
                      }
                      void run("cleanup", async () => {
                        const r = await api.cleanup();
                        const c = r.cleanup;
                        if (c.deleted === 0) {
                          push(
                            `Cleanup done — no devices offline longer than ${offlineDays} days (${c.scanned} scanned).`,
                            "success",
                          );
                        } else {
                          const names = c.deletedNames.slice(0, 3).join(", ");
                          const more =
                            c.deletedNames.length > 3
                              ? ` +${c.deletedNames.length - 3} more`
                              : "";
                          push(
                            `Cleanup deleted ${c.deleted} device${c.deleted === 1 ? "" : "s"}: ${names}${more}.`,
                            "success",
                          );
                        }
                      });
                    }}
                  >
                    {busy === "cleanup" ? <Spinner label="Cleaning…" /> : "Run now"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {createOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!creating) setCreateOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-node-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="create-node-title">Create mesh node</h3>
            <div className="field">
              <label htmlFor="new-node">Name</label>
              <input
                id="new-node"
                type="text"
                value={newName}
                placeholder="edge-1"
                autoFocus
                disabled={creating}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) void createNode();
                  if (e.key === "Escape" && !creating) setCreateOpen(false);
                }}
              />
            </div>
            <div className="row-actions modal-actions">
              <button
                className="btn btn-ghost"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={creating || !newName.trim()}
                onClick={() => void createNode()}
              >
                {creating ? <Spinner label="Creating…" /> : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerEntry && (
        <div
          className={`drawer-backdrop${drawerOpen ? " is-open" : ""}`}
          onClick={closeDrawer}
          onTransitionEnd={onDrawerTransitionEnd}
        >
          <aside className="drawer" onClick={(ev) => ev.stopPropagation()}>
            <div className="drawer-head">
              <h3 className="drawer-title">
                {drawerEntry.kind === "node" ? (
                  <Server size={18} strokeWidth={2.25} className="kind-icon node" aria-hidden />
                ) : (
                  <Smartphone size={18} strokeWidth={2.25} className="kind-icon device" aria-hidden />
                )}
                {drawerEntry.name}
              </h3>
              <button
                type="button"
                className="btn btn-icon drawer-close"
                title="Close"
                aria-label="Close"
                disabled={locked}
                onClick={closeDrawer}
              >
                <X size={16} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <div className="meta">
              <KindBadge kind={drawerEntry.kind} />
              {" · "}
              <span className="mono">{drawerEntry.id.slice(0, 8)}…</span>
            </div>

            <div className="field">
              <label htmlFor="rename">Name (also drives .{settings?.meshSuffix ?? "mesh"})</label>
              <input
                id="rename"
                type="text"
                value={renameValue}
                disabled={locked}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <div className="row-actions" style={{ marginBottom: "1rem" }}>
              <button
                className="btn btn-primary"
                disabled={locked || !renameValue.trim()}
                onClick={() =>
                  void run("rename", async () => {
                    const r = await api.rename(drawerEntry.kind, drawerEntry.id, renameValue.trim());
                    push(
                      r.notice ?? `Renamed to "${renameValue.trim()}". DNS updated.`,
                      r.notice ? "info" : "success",
                    );
                    closeDrawer();
                  })
                }
              >
                {busy === "rename" ? <Spinner label="Saving…" /> : "Save name"}
              </button>
            </div>

            <p className="hint drawer-meta-lines">
              Hostname:{" "}
              <CopyValue
                value={drawerEntry.meshHostname}
                onCopied={(v) => push(`Copied ${v}`, "success")}
              />
              <br />
              IPv4:{" "}
              <CopyValue
                value={drawerEntry.ipv4}
                onCopied={(v) => push(`Copied ${v}`, "success")}
              />
              <br />
              IPv6:{" "}
              <CopyValue
                value={drawerEntry.ipv6}
                onCopied={(v) => push(`Copied ${v}`, "success")}
              />
            </p>

            {drawerEntry.kind === "node" && isNodeOffline(drawerEntry.status) && (
              <div className="install-box">
                <div className="row-actions">
                  <strong style={{ fontSize: "0.85rem" }}>Install &amp; connect (warp-cli)</strong>
                  <button
                    className="btn"
                    disabled={!installCmd || installLoading || locked}
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
                <pre>
                  {installLoading ? (
                    <span className="btn-spin">
                      <Loader2 size={14} strokeWidth={2.5} className="spin" aria-hidden />
                      Loading token…
                    </span>
                  ) : (
                    (installCmd ?? "—")
                  )}
                </pre>
              </div>
            )}

            {drawerEntry.kind === "node" && (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  className="btn"
                  disabled={locked}
                  onClick={() =>
                    void run("wg", async () => {
                      await api.downloadWireGuard(drawerEntry.id, drawerEntry.name);
                      push(`Downloaded WireGuard conf for "${drawerEntry.name}".`, "success");
                    })
                  }
                >
                  {busy === "wg" ? <Spinner label="Downloading…" /> : "Download WireGuard .conf"}
                </button>
              </div>
            )}

            <div style={{ marginTop: "1.5rem" }}>
              <button
                className="btn btn-danger"
                disabled={locked}
                onClick={() => {
                  const label = drawerEntry.kind === "node" ? "node" : "device";
                  if (!confirm(`Delete ${label} "${drawerEntry.name}"?`)) return;
                  void run("delete", async () => {
                    await api.remove(drawerEntry.kind, drawerEntry.id);
                    push(`Deleted ${label} "${drawerEntry.name}". DNS updated.`, "success");
                    closeDrawer();
                  });
                }}
              >
                {busy === "delete" ? <Spinner label="Deleting…" /> : `Delete ${drawerEntry.kind}`}
              </button>
            </div>
          </aside>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
