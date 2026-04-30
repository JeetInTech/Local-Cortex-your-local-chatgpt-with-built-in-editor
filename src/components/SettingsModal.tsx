import React from 'react';
import { X, Moon, Sun, Minus, Plus } from 'lucide-react';

export interface AppSettings {
  theme: 'dark' | 'light' | 'bearded' | 'github-dark';
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  terminalFontSize: number;
  enabledExtensions: string[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

function Row({ label, children, desc }: { label: string; children: React.ReactNode; desc?: string }) {
  return (
    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>{label}</div>
          {desc && <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '2px' }}>{desc}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ value, min, max, step = 1, unit = '', onChange }: {
  value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <button className="btn-small" onClick={() => onChange(Math.max(min, value - step))}><Minus size={14} /></button>
      <span style={{ minWidth: '44px', textAlign: 'center', fontSize: '14px' }}>{value}{unit}</span>
      <button className="btn-small" onClick={() => onChange(Math.min(max, value + step))}><Plus size={14} /></button>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer',
        background: value ? 'var(--vscode-accent)' : 'var(--vscode-border)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: '3px',
        left: value ? '23px' : '3px',
        width: '18px', height: '18px', borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, setSettings }) => {
  if (!isOpen) return null;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings({ ...settings, [key]: value });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '480px', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <span>Settings</span>
          <X size={20} cursor="pointer" onClick={onClose} />
        </div>

        {/* ── Appearance ──────────────────────────────────────────── */}
        <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.5, marginBottom: '16px' }}>
          Appearance
        </div>

        <Row label="Theme" desc="Application color scheme">
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['dark', 'light'] as const).map(t => (
              <button
                key={t}
                className="theme-toggle"
                onClick={() => set('theme', t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  border: settings.theme === t ? '1px solid var(--vscode-accent)' : undefined,
                }}
              >
                {t === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </Row>

        {/* ── Editor ──────────────────────────────────────────────── */}
        <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.5, marginBottom: '16px', marginTop: '8px' }}>
          Editor
        </div>

        <Row label="Font Size" desc="Editor and chat font size">
          <Stepper value={settings.fontSize} min={10} max={28} unit="px" onChange={v => set('fontSize', v)} />
        </Row>

        <Row label="Tab Size" desc="Number of spaces per indent level">
          <Stepper value={settings.tabSize} min={1} max={8} onChange={v => set('tabSize', v)} />
        </Row>

        <Row label="Word Wrap" desc="Wrap long lines in the editor">
          <Toggle value={settings.wordWrap} onChange={v => set('wordWrap', v)} />
        </Row>

        <Row label="Line Numbers" desc="Show line numbers in the editor gutter">
          <Toggle value={settings.lineNumbers} onChange={v => set('lineNumbers', v)} />
        </Row>

        <Row label="Minimap" desc="Show the code minimap on the right">
          <Toggle value={settings.minimap} onChange={v => set('minimap', v)} />
        </Row>

        {/* ── Terminal ────────────────────────────────────────────── */}
        <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.5, marginBottom: '16px', marginTop: '8px' }}>
          Terminal
        </div>

        <Row label="Terminal Font Size" desc="Font size inside the integrated terminal">
          <Stepper value={settings.terminalFontSize} min={10} max={20} unit="px" onChange={v => set('terminalFontSize', v)} />
        </Row>

        {/* ── Info ────────────────────────────────────────────────── */}
        <div style={{ marginTop: '24px', padding: '12px', background: 'rgba(0,122,204,0.08)', borderRadius: '6px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.7, lineHeight: 1.6 }}>
          <strong>Local Cortex</strong> — v0.1.0<br />
          All AI inference runs locally on your hardware. No data leaves your machine.
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
