import React from 'react';
import { X, Moon, Sun, Minus, Plus } from 'lucide-react';

export const DEFAULT_SYSTEM_PROMPT = `You are a brilliant, direct AI assistant. Follow these rules absolutely:

1. Answer the actual question immediately. No preamble, no throat-clearing.
2. Format ALL code with markdown code blocks and the correct language tag (e.g. \`\`\`typescript).
3. Use headers and bullets only when structure genuinely helps — not by default.
4. When code snippets are provided between [WORKSPACE CONTEXT] tags, use them to give accurate, project-specific answers.
5. Never open with "Certainly!", "Of course!", "Great question!" or any filler phrase.
6. If you don't know something, say so directly. Never fabricate APIs, functions, or facts.
7. Keep answers tight. If the question is simple, the answer should be short.`;

export interface AppSettings {
  theme: 'dark' | 'light' | 'bearded' | 'github-dark';
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  terminalFontSize: number;
  enabledExtensions: string[];
  systemPrompt: string;
  ragEnabled: boolean;
  numCtx: number;
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

        {/* ── Chat AI ─────────────────────────────────────────── */}
        <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.5, marginBottom: '16px', marginTop: '8px' }}>
          Chat AI
        </div>

        <Row label="RAG Context" desc="Inject relevant workspace code into every chat reply">
          <Toggle value={settings.ragEnabled} onChange={v => set('ragEnabled', v)} />
        </Row>

        <Row label="Context Window" desc="Tokens the model can hold in memory (larger = more context, slower)">
          <div style={{ display: 'flex', gap: '6px' }}>
            {([2048, 4096, 8192] as const).map(n => (
              <button
                key={n}
                className="theme-toggle"
                onClick={() => set('numCtx', n)}
                style={{ border: settings.numCtx === n ? '1px solid var(--vscode-accent)' : undefined }}
              >
                {n === 2048 ? '2K' : n === 4096 ? '4K' : '8K'}
              </button>
            ))}
          </div>
        </Row>

        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>System Prompt</div>
          <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '8px' }}>The hidden instruction injected before every chat message. Defines the AI's personality and rules.</div>
          <textarea
            value={settings.systemPrompt}
            onChange={e => set('systemPrompt', e.target.value)}
            rows={8}
            style={{
              width: '100%',
              background: 'var(--vscode-input)',
              border: '1px solid var(--vscode-border)',
              color: 'var(--vscode-text)',
              padding: '8px 10px',
              fontSize: '12px',
              fontFamily: "'Cascadia Code', monospace",
              lineHeight: 1.6,
              borderRadius: '4px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => set('systemPrompt', DEFAULT_SYSTEM_PROMPT)}
            style={{
              marginTop: '6px', fontSize: '11px', opacity: 0.6,
              background: 'none', border: '1px solid var(--vscode-border)',
              color: 'var(--vscode-text)', padding: '3px 10px',
              borderRadius: '4px', cursor: 'pointer',
            }}
          >
            Reset to default
          </button>
        </div>

        {/* ── Info ──────────────────────────────────────────────── */}
        <div style={{ marginTop: '24px', padding: '12px', background: 'rgba(0,122,204,0.08)', borderRadius: '6px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.7, lineHeight: 1.6 }}>
          <strong>Local Cortex</strong> — v0.1.0<br />
          All AI inference runs locally on your hardware. No data leaves your machine.
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
