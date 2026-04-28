import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Clock, FolderOpen, File, Terminal } from 'lucide-react';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  category: 'file' | 'recent' | 'action';
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFolder: () => void;
  onToggleTerminal: () => void;
  recentFiles: string[];
  onOpenRecentFile: (path: string) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen, onClose, onOpenFolder, onToggleTerminal, recentFiles, onOpenRecentFile,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const buildCommands = useCallback((): Command[] => {
    const cmds: Command[] = [
      {
        id: 'open-folder',
        label: 'Open Folder…',
        description: 'Open a folder in the Explorer',
        icon: <FolderOpen size={14} />,
        action: () => { onOpenFolder(); onClose(); },
        category: 'action',
      },
      {
        id: 'toggle-terminal',
        label: 'Toggle Terminal',
        description: 'Show or hide the integrated terminal',
        icon: <Terminal size={14} />,
        action: () => { onToggleTerminal(); onClose(); },
        category: 'action',
      },
    ];

    recentFiles.forEach((path, i) => {
      const name = path.split(/[\\/]/).pop() ?? path;
      const dir = path.split(/[\\/]/).slice(0, -1).join('/');
      cmds.push({
        id: `recent-${i}`,
        label: name,
        description: dir,
        icon: <File size={14} />,
        action: () => { onOpenRecentFile(path); onClose(); },
        category: 'recent',
      });
    });

    return cmds;
  }, [recentFiles, onOpenFolder, onToggleTerminal, onOpenRecentFile, onClose]);

  const filtered = buildCommands().filter(cmd =>
    !query ||
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    (cmd.description?.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[selected]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const grouped: { label: string; cmds: Command[] }[] = [];
  const actions = filtered.filter(c => c.category === 'action');
  const recents = filtered.filter(c => c.category === 'recent');
  if (actions.length > 0) grouped.push({ label: 'Commands', cmds: actions });
  if (recents.length > 0) grouped.push({ label: 'Recent Files', cmds: recents });

  let runningIdx = 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '80px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '560px', maxHeight: '400px',
          background: 'var(--modal-bg)', border: '1px solid var(--modal-border)',
          borderRadius: '8px', overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '12px 16px',
          borderBottom: '1px solid var(--modal-border)', gap: '10px',
        }}>
          <Search size={16} style={{ opacity: 0.5, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or file name…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--vscode-text)', fontSize: '14px',
            }}
          />
          <span style={{ fontSize: '11px', opacity: 0.4, flexShrink: 0 }}>ESC to close</span>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', maxHeight: '340px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', opacity: 0.4, fontSize: '13px' }}>
              No results for "{query}"
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label}>
                <div style={{
                  padding: '6px 16px 4px',
                  fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase',
                  letterSpacing: '0.8px', opacity: 0.4,
                  borderTop: '1px solid var(--modal-border)',
                }}>
                  {group.label === 'Recent Files' && <Clock size={10} style={{ marginRight: '4px' }} />}
                  {group.label}
                </div>
                {group.cmds.map(cmd => {
                  const idx = runningIdx++;
                  const isSelected = idx === selected;
                  return (
                    <div
                      key={cmd.id}
                      onClick={cmd.action}
                      onMouseEnter={() => setSelected(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '8px 16px', cursor: 'pointer',
                        background: isSelected ? 'var(--vscode-accent)' : 'transparent',
                        color: isSelected ? '#fff' : 'var(--vscode-text)',
                        transition: 'background 0.1s',
                      }}
                    >
                      <span style={{ opacity: 0.7, flexShrink: 0 }}>{cmd.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{cmd.label}</div>
                        {cmd.description && (
                          <div style={{
                            fontSize: '11px', opacity: 0.6,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {cmd.description}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
