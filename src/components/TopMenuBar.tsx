import React, { useState, useRef, useEffect } from 'react';

interface TopMenuBarProps {
  onOpenFolder?: () => void;
  onSave?: () => void;
  onToggleTerminal?: () => void;
  onOpenCommandPalette?: () => void;
  recentFiles?: string[];
  onOpenRecentFile?: (path: string) => void;
}

interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  separator?: boolean;
  submenu?: MenuItem[];
}

const TopMenuBar: React.FC<TopMenuBarProps> = ({
  onOpenFolder,
  onSave,
  onToggleTerminal,
  onOpenCommandPalette,
  recentFiles = [],
  onOpenRecentFile,
}) => {
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

  const recentItems: MenuItem[] = recentFiles.length > 0
    ? recentFiles.slice(0, 10).map(p => ({
        label: p.split(/[\\/]/).pop() ?? p,
        action: () => { onOpenRecentFile?.(p); setOpenMenu(null); },
      }))
    : [{ label: '(No recent files)', action: () => setOpenMenu(null) }];

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Open Folder…', action: () => { onOpenFolder?.(); setOpenMenu(null); }, shortcut: 'Ctrl+K Ctrl+O' },
      { label: 'Open Recent', submenu: recentItems },
      { label: '', separator: true },
      { label: 'Save', action: () => { onSave?.(); setOpenMenu(null); }, shortcut: 'Ctrl+S' },
      { label: '', separator: true },
      { label: 'Exit', action: () => setOpenMenu(null) },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', shortcut: 'Ctrl+Y' },
      { label: '', separator: true },
      { label: 'Command Palette…', action: () => { onOpenCommandPalette?.(); setOpenMenu(null); }, shortcut: 'Ctrl+Shift+P' },
      { label: 'Find', shortcut: 'Ctrl+F' },
      { label: 'Replace', shortcut: 'Ctrl+H' },
    ],
    View: [
      { label: 'Toggle Sidebar', shortcut: 'Ctrl+B' },
      { label: 'Toggle Terminal', action: () => { onToggleTerminal?.(); setOpenMenu(null); }, shortcut: 'Ctrl+J' },
    ],
    Terminal: [
      { label: 'New Terminal', action: () => { onToggleTerminal?.(); setOpenMenu(null); }, shortcut: 'Ctrl+J' },
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
        <MenuDropdown
          key={name}
          name={name}
          items={items}
          isOpen={openMenu === name}
          onOpen={() => setOpenMenu(openMenu === name ? null : name)}
          onMouseEnterMenu={() => { if (openMenu) setOpenMenu(name); }}
        />
      ))}
    </div>
  );
};

// ─── MenuDropdown sub-component ───────────────────────────────────────────────

function MenuDropdown({
  name, items, isOpen, onOpen, onMouseEnterMenu,
}: {
  name: string;
  items: MenuItem[];
  isOpen: boolean;
  onOpen: () => void;
  onMouseEnterMenu: () => void;
}) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  return (
    <div style={{ position: 'relative' }} onMouseEnter={onMouseEnterMenu}>
      <div
        className="menu-item"
        onClick={onOpen}
        style={{ background: isOpen ? 'rgba(255,255,255,0.1)' : undefined }}
      >
        {name}
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0,
          background: 'var(--modal-bg)', border: '1px solid var(--modal-border)',
          borderRadius: '4px', padding: '4px 0', minWidth: '220px',
          zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} style={{ height: '1px', background: 'var(--modal-border)', margin: '4px 0' }} />
            ) : item.submenu ? (
              <div
                key={i}
                style={{ position: 'relative' }}
                onMouseEnter={() => setOpenSubmenu(i)}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                <MenuRowItem item={item} hasSubmenu />
                {openSubmenu === i && (
                  <div style={{
                    position: 'absolute', top: 0, left: '100%',
                    background: 'var(--modal-bg)', border: '1px solid var(--modal-border)',
                    borderRadius: '4px', padding: '4px 0', minWidth: '200px',
                    zIndex: 201, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  }}>
                    {item.submenu!.map((sub, si) => (
                      <MenuRowItem key={si} item={sub} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <MenuRowItem key={i} item={item} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function MenuRowItem({ item, hasSubmenu }: { item: MenuItem; hasSubmenu?: boolean }) {
  return (
    <div
      onClick={item.action ?? (() => {})}
      style={{
        padding: '6px 24px',
        cursor: item.action ? 'pointer' : 'default',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '13px', color: 'var(--vscode-text)', gap: '24px',
        opacity: item.action ? 1 : 0.5,
      }}
      onMouseEnter={e => {
        if (item.action) {
          (e.currentTarget as HTMLElement).style.background = 'var(--vscode-accent)';
          (e.currentTarget as HTMLElement).style.color = '#fff';
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--vscode-text)';
      }}
    >
      <span>{item.label}</span>
      <span style={{ opacity: 0.5, fontSize: '11px' }}>
        {hasSubmenu ? '▶' : item.shortcut}
      </span>
    </div>
  );
}

export default TopMenuBar;
