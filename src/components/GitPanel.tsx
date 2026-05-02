import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, GitCommit, RefreshCw, ChevronDown, ChevronRight,
  Upload, Download, Plus, Minus, FileEdit, AlertCircle, Check,
  Loader2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitFile {
  status: string; // 'M', 'A', 'D', '?', 'R', etc.
  path: string;
  staged: boolean;
}

interface GitPanelProps {
  rootCwd: string;
  onOpenFile: (path: string, name: string, ext?: string) => void;
  onDiffFile?: (path: string, diffContent: string) => void;
  onBranchChange?: (branch: string) => void;
  onDirtyCountChange?: (count: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(s: string): { label: string; color: string; icon: React.ReactNode } {
  switch (s.toUpperCase()) {
    case 'M': return { label: 'Modified', color: '#e2a856', icon: <FileEdit size={12} /> };
    case 'A': return { label: 'Added',    color: '#4caf50', icon: <Plus size={12} /> };
    case 'D': return { label: 'Deleted',  color: '#f44336', icon: <Minus size={12} /> };
    case '?': return { label: 'Untracked',color: '#888',    icon: <AlertCircle size={12} /> };
    case 'R': return { label: 'Renamed',  color: '#7c7cff', icon: <FileEdit size={12} /> };
    default:  return { label: s,          color: '#888',    icon: <AlertCircle size={12} /> };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const GitPanel: React.FC<GitPanelProps> = ({
  rootCwd,
  onOpenFile,
  onDiffFile,
  onBranchChange,
  onDirtyCountChange,
}) => {
  const [branch, setBranch] = useState<string>('');
  const [files, setFiles] = useState<GitFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Modified: true, Added: true, Deleted: true, Untracked: true,
  });
  const [statusMsg, setStatusMsg] = useState('');
  const commitRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    if (!rootCwd) return;
    setLoading(true);
    try {
      const [br, gitFiles] = await Promise.all([
        invoke<string>('get_git_branch', { dir: rootCwd }),
        invoke<GitFile[]>('git_status', { dir: rootCwd }),
      ]);
      setBranch(br);
      setFiles(gitFiles);
      onBranchChange?.(br);
      onDirtyCountChange?.(gitFiles.length);
    } catch {
      setBranch('');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [rootCwd, onBranchChange, onDirtyCountChange]);

  useEffect(() => { refresh(); }, [refresh]);

  const showMsg = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setIsCommitting(true);
    try {
      await invoke('git_commit', { dir: rootCwd, message: commitMsg.trim() });
      setCommitMsg('');
      showMsg('✓ Committed successfully');
      await refresh();
    } catch (e) {
      showMsg(`Error: ${e}`);
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      await invoke('git_push', { dir: rootCwd });
      showMsg('✓ Pushed successfully');
    } catch (e) {
      showMsg(`Push failed: ${e}`);
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    try {
      await invoke('git_pull', { dir: rootCwd });
      showMsg('✓ Pulled successfully');
      await refresh();
    } catch (e) {
      showMsg(`Pull failed: ${e}`);
    } finally {
      setIsPulling(false);
    }
  };

  const handleViewDiff = async (filePath: string) => {
    try {
      const diff = await invoke<string>('git_diff', { dir: rootCwd, filePath });
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      onDiffFile?.(filePath, diff);
      onOpenFile(filePath, fileName, fileName.includes('.') ? fileName.split('.').pop() : undefined);
    } catch (e) {
      showMsg(`Diff failed: ${e}`);
    }
  };

  // Group files by status label
  const grouped: Record<string, GitFile[]> = {};
  for (const f of files) {
    const { label } = statusLabel(f.status);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(f);
  }

  const toggleGroup = (group: string) =>
    setExpandedGroups(p => ({ ...p, [group]: !p[group] }));

  return (
    <div className="git-panel">
      {/* Header */}
      <div className="git-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <GitBranch size={13} />
          <span style={{ fontWeight: 600 }}>Source Control</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <GitBtn onClick={handlePull} title="Pull" disabled={isPulling || !branch}>
            {isPulling ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
          </GitBtn>
          <GitBtn onClick={handlePush} title="Push" disabled={isPushing || !branch}>
            {isPushing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
          </GitBtn>
          <GitBtn onClick={refresh} title="Refresh">
            {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          </GitBtn>
        </div>
      </div>

      {/* Branch pill */}
      {branch ? (
        <div className="git-branch-pill">
          <GitBranch size={11} />
          <span>{branch}</span>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.4 }}>
          Not a git repository
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div style={{
          margin: '6px 12px', padding: '6px 10px', borderRadius: '4px', fontSize: '11px',
          background: statusMsg.startsWith('✓') ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
          color: statusMsg.startsWith('✓') ? '#4caf50' : '#f44336',
          border: `1px solid ${statusMsg.startsWith('✓') ? '#4caf5033' : '#f4433633'}`,
        }}>
          {statusMsg}
        </div>
      )}

      {/* Commit box */}
      {branch && (
        <div className="git-commit-box">
          <textarea
            ref={commitRef}
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            className="git-commit-input"
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleCommit(); }}
            rows={2}
          />
          <button
            className={`git-commit-btn ${commitMsg.trim() ? 'active' : ''}`}
            onClick={handleCommit}
            disabled={!commitMsg.trim() || isCommitting}
          >
            {isCommitting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <GitCommit size={12} />}
            {isCommitting ? 'Committing…' : 'Commit'}
          </button>
        </div>
      )}

      {/* File groups */}
      <div className="git-file-list">
        {files.length === 0 && !loading && branch && (
          <div style={{ padding: '16px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.4, textAlign: 'center' }}>
            <Check size={20} style={{ marginBottom: '8px', display: 'block', margin: '0 auto 8px' }} />
            No changes
          </div>
        )}
        {Object.entries(grouped).map(([groupName, groupFiles]) => {
          const { color, icon } = statusLabel(groupFiles[0]?.status ?? '');
          const isExpanded = expandedGroups[groupName] !== false;
          return (
            <div key={groupName}>
              <div className="git-group-header" onClick={() => toggleGroup(groupName)}>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span style={{ color, display: 'flex', alignItems: 'center', gap: '4px' }}>{icon}</span>
                <span style={{ flex: 1 }}>{groupName}</span>
                <span className="git-group-count">{groupFiles.length}</span>
              </div>
              {isExpanded && groupFiles.map(f => {
                const name = f.path.split(/[/\\]/).pop() ?? f.path;
                const ext = name.includes('.') ? name.split('.').pop() : undefined;
                const { color: fc } = statusLabel(f.status);
                return (
                  <div
                    key={f.path}
                    className="git-file-item"
                    onClick={() => onOpenFile(f.path.startsWith('/') || /^[A-Z]:/i.test(f.path)
                      ? f.path
                      : `${rootCwd}/${f.path}`, name, ext)}
                    title={f.path}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ fontSize: '10px', color: '#555', opacity: 0.7, maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.path.replace(name, '').replace(/[/\\]$/, '')}
                    </span>
                    <span style={{ color: fc, fontWeight: 700, fontSize: '11px', flexShrink: 0, marginLeft: '4px' }}>
                      {f.status}
                    </span>
                    <button
                      className="git-diff-btn"
                      onClick={e => { e.stopPropagation(); handleViewDiff(
                        f.path.startsWith('/') || /^[A-Z]:/i.test(f.path) ? f.path : `${rootCwd}/${f.path}`
                      ); }}
                      title="View diff"
                    >
                      ~
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function GitBtn({ children, onClick, title, disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--vscode-text)' : 'var(--vscode-text)',
        opacity: disabled ? 0.3 : 0.7, padding: '3px', borderRadius: '4px',
        display: 'flex', alignItems: 'center', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'var(--vscode-input)'; } }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = disabled ? '0.3' : '0.7'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

export default GitPanel;
