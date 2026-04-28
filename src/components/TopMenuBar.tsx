import React, { useState, useRef, useEffect } from 'react';

interface TopMenuBarProps {
  onOpenFolder?: () => void;
  onSave?: () => void;
}

interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  separator?: boolean;
}

const TopMenuBar: React.FC<TopMenuBarProps> = ({ onOpenFolder, onSave }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Open Folder...', action: () => { onOpenFolder?.(); setOpenMenu(null); }, shortcut: 'Ctrl+K Ctrl+O' },
      { label: 'Save', action: () => { onSave?.(); setOpenMenu(null); }, shortcut: 'Ctrl+S' },
      { label: '', separator: true },
      { label: 'Exit', action: () => setOpenMenu(null) },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', shortcut: 'Ctrl+Y' },
      { label: '', separator: true },
      { label: 'Find', shortcut: 'Ctrl+F' },
    ],
    View: [
      { label: 'Toggle Sidebar', shortcut: 'Ctrl+B' },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`' },
    ],
    Terminal: [
      { label: 'New Terminal', shortcut: 'Ctrl+Shift+`' },
    ],
    Help: [
      { label: 'About Local Cortex' },
    ],
  };

  return (
    <div className="top-menu-bar" ref={ref}>
      <div style={{ fontWeight: 'bold', color: 'var(--vscode-accent)', marginRight: '10px', fontSize: '14px' }}>
        ⬡
      </div>
      {Object.entries(menus).map(([name, items]) => (
        <div
          key={name}
          style={{ position: 'relative' }}
          onMouseEnter={() => { if (openMenu) setOpenMenu(name); }}
        >
          <div
            className="menu-item"
            onClick={() => setOpenMenu(openMenu === name ? null : name)}
            style={{ background: openMenu === name ? 'rgba(255,255,255,0.1)' : undefined }}
          >
            {name}
          </div>
          {openMenu === name && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: 'var(--modal-bg)',
              border: '1px solid var(--modal-border)',
              borderRadius: '4px',
              padding: '4px 0',
              minWidth: '220px',
              zIndex: 200,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              {items.map((item, i) =>
                item.separator ? (
                  <div key={i} style={{ height: '1px', background: 'var(--modal-border)', margin: '4px 0' }} />
                ) : (
                  <div
                    key={i}
                    onClick={item.action ?? (() => setOpenMenu(null))}
                    style={{
                      padding: '6px 24px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '13px',
                      color: 'var(--vscode-text)',
                      gap: '24px',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--vscode-accent)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--vscode-text)'; }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span style={{ opacity: 0.5, fontSize: '11px' }}>{item.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TopMenuBar;
