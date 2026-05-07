import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, X, RefreshCw, ChevronDown, ChevronUp, Sparkles, CheckCircle2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface UpdateInfo {
  available: boolean;
  version: string | null;
  current_version: string | null;
  body: string | null;
  date: string | null;
}

interface ProgressEvent {
  status: "downloading" | "installing" | "done";
  downloaded?: number;
  total?: number;
}

type UpdateState = "idle" | "checking" | "available" | "downloading" | "installing" | "done" | "error";

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Converts a GitHub-flavoured release body (markdown) into structured
 * sections for rendering as a pretty update log.
 */
function parseChangelog(body: string | null): { heading: string; items: string[] }[] {
  if (!body) return [];
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      if (current) sections.push(current);
      current = { heading: trimmed.replace(/^#{2,3}\s*/, ""), items: [] };
    } else if ((trimmed.startsWith("- ") || trimmed.startsWith("* ")) && current) {
      current.items.push(trimmed.replace(/^[-*]\s+/, ""));
    } else if (trimmed && !trimmed.startsWith("#") && current && current.items.length === 0) {
      // paragraph text — treat as a single item
      current.items.push(trimmed);
    }
  }
  if (current) sections.push(current);
  return sections.filter(s => s.items.length > 0);
}

// ─────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────

export default function UpdateNotification() {
  const [state, setState]         = useState<UpdateState>("idle");
  const [info, setInfo]           = useState<UpdateInfo | null>(null);
  const [visible, setVisible]     = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded]   = useState(false);
  const [progress, setProgress]   = useState({ downloaded: 0, total: 0 });
  const [error, setError]         = useState<string | null>(null);
  const unlistenRef               = useRef<(() => void) | null>(null);

  // ── Check for updates on mount ────────────────────────────────
  useEffect(() => {
    const check = async () => {
      setState("checking");
      try {
        const result = await invoke<UpdateInfo>("check_for_updates");
        setInfo(result);
        if (result.available) {
          setState("available");
          // slight delay so page renders first, then slide in
          setTimeout(() => setVisible(true), 1200);
        } else {
          setState("idle");
        }
      } catch (err) {
        // silently fail — don't nag user about network errors
        setState("idle");
      }
    };
    check();

    // Listen for progress events from the Rust backend
    listen<ProgressEvent>("update-progress", (event) => {
      const p = event.payload;
      if (p.status === "downloading") {
        setState("downloading");
        setProgress({ downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      } else if (p.status === "installing") {
        setState("installing");
      } else if (p.status === "done") {
        setState("done");
      }
    }).then(unlisten => { unlistenRef.current = unlisten; });

    return () => { unlistenRef.current?.(); };
  }, []);

  const handleInstall = async () => {
    setState("downloading");
    setError(null);
    try {
      await invoke("install_update");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => setDismissed(true), 400);
  };

  if (dismissed || !visible) return null;

  const changelog = parseChangelog(info?.body ?? null);
  const progressPct = progress.total > 0
    ? Math.round((progress.downloaded / progress.total) * 100)
    : 0;

  return (
    <>
      {/* ── Backdrop blur overlay (subtle) ── */}
      <div
        className="update-backdrop"
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      />

      {/* ── Main card ── */}
      <div
        id="update-notification-card"
        className="update-card"
        style={{
          transform: visible ? "translateY(0) scale(1)" : "translateY(120%) scale(0.95)",
          opacity:   visible ? 1 : 0,
          transition: "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease",
        }}
        aria-live="polite"
        role="dialog"
        aria-label="Update available"
      >
        {/* ── Header ── */}
        <div className="update-header">
          <div className="update-header-left">
            <div className="update-icon-ring">
              <Sparkles size={16} className="update-sparkle" />
            </div>
            <div>
              <div className="update-title">Update Available</div>
              <div className="update-versions">
                <span className="update-ver-old">{info?.current_version ?? "..."}</span>
                <span className="update-arrow">→</span>
                <span className="update-ver-new">{info?.version ?? "..."}</span>
              </div>
            </div>
          </div>
          <button
            id="update-dismiss-btn"
            className="update-close-btn"
            onClick={handleDismiss}
            aria-label="Dismiss"
            title="Remind me later"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Changelog / Update Log ── */}
        {changelog.length > 0 && (
          <div className="update-changelog-wrapper">
            <button
              id="update-toggle-changelog-btn"
              className="update-changelog-toggle"
              onClick={() => setExpanded(p => !p)}
            >
              <span>What's new in {info?.version}</span>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {expanded && (
              <div className="update-changelog-body">
                {changelog.map((section, si) => (
                  <div key={si} className="update-changelog-section">
                    {/* Only show heading if it's not the top-level release heading */}
                    {section.heading && !section.heading.startsWith("Local Cortex") && (
                      <div className="update-changelog-heading">{section.heading}</div>
                    )}
                    <ul className="update-changelog-list">
                      {section.items.map((item, ii) => (
                        <li key={ii} className="update-changelog-item">
                          <span className="update-changelog-bullet">▸</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Progress Bar (downloading / installing) ── */}
        {(state === "downloading" || state === "installing") && (
          <div className="update-progress-area">
            <div className="update-progress-label">
              {state === "downloading"
                ? `Downloading… ${progress.total > 0 ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}` : ""}`
                : "Installing update…"}
            </div>
            <div className="update-progress-track">
              <div
                className="update-progress-fill"
                style={{ width: state === "installing" ? "100%" : `${progressPct}%` }}
              />
            </div>
            {state === "downloading" && progress.total > 0 && (
              <div className="update-progress-pct">{progressPct}%</div>
            )}
          </div>
        )}

        {/* ── Done state ── */}
        {state === "done" && (
          <div className="update-done">
            <CheckCircle2 size={16} className="update-done-icon" />
            <span>Installed! Restarting…</span>
          </div>
        )}

        {/* ── Error state ── */}
        {state === "error" && (
          <div className="update-error">⚠ {error ?? "Update failed. Please try again."}</div>
        )}

        {/* ── Action Buttons ── */}
        {(state === "available" || state === "error") && (
          <div className="update-actions">
            <button
              id="update-later-btn"
              className="update-btn-later"
              onClick={handleDismiss}
            >
              Later
            </button>
            <button
              id="update-now-btn"
              className="update-btn-now"
              onClick={handleInstall}
            >
              <Download size={14} />
              Update Now
            </button>
          </div>
        )}

        {state === "checking" && (
          <div className="update-checking">
            <RefreshCw size={13} className="update-spin" />
            <span>Checking for updates…</span>
          </div>
        )}
      </div>
    </>
  );
}
