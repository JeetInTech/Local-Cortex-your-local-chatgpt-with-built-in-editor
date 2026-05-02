import React, { useState } from 'react';
import { X, Minus, Plus, Settings, Code, Terminal as TerminalIcon, Bot, Moon, Sun } from 'lucide-react';

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
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      padding: '20px 0',
      borderBottom: '1px solid var(--vscode-border)'
    }}>
      <div style={{ flex: 1, paddingRight: '20px' }}>
        <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--vscode-text)' }}>{label}</div>
        {desc && <div style={{ fontSize: '13px', opacity: 0.5, marginTop: '6px', lineHeight: 1.4 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Stepper({ value, min, max, step = 1, unit = '', onChange }: {
  value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--vscode-input)', padding: '4px', borderRadius: '6px', border: '1px solid var(--vscode-border)' }}>
      <button 
        onClick={() => onChange(Math.max(min, value - step))}
        style={{ background: 'none', border: 'none', color: 'var(--vscode-text)', cursor: 'pointer', padding: '4px', opacity: 0.7, display: 'flex' }}
      ><Minus size={14} /></button>
      <span style={{ minWidth: '40px', textAlign: 'center', fontSize: '13px', fontWeight: 500 }}>{value}{unit}</span>
      <button 
        onClick={() => onChange(Math.min(max, value + step))}
        style={{ background: 'none', border: 'none', color: 'var(--vscode-text)', cursor: 'pointer', padding: '4px', opacity: 0.7, display: 'flex' }}
      ><Plus size={14} /></button>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer',
        background: value ? 'var(--vscode-accent)' : 'var(--vscode-border)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: '2px',
        left: value ? '20px' : '2px',
        width: '18px', height: '18px', borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

function SidebarTab({ label, icon, active, onClick }: { label: string, icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        borderRadius: '8px',
        cursor: 'pointer',
        background: active ? 'var(--vscode-input)' : 'transparent',
        color: active ? 'var(--vscode-text-active)' : 'var(--vscode-text)',
        fontWeight: active ? 500 : 400,
        fontSize: '13px',
        transition: 'all 0.15s ease'
      }}
    >
      <div style={{ display: 'flex', opacity: active ? 1 : 0.7 }}>{icon}</div>
      {label}
    </div>
  );
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, setSettings }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'terminal' | 'chat'>('general');

  if (!isOpen) return null;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings({ ...settings, [key]: value });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          width: '800px', 
          height: '600px', 
          padding: 0,
          display: 'flex',
          overflow: 'hidden',
          background: 'var(--vscode-bg)',
          borderRadius: '12px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          border: '1px solid var(--vscode-border)'
        }}
      >
        
        {/* ── Left Sidebar ──────────────────────────────────────── */}
        <div style={{ 
          width: '240px', 
          background: 'var(--vscode-sidebar)', 
          borderRight: '1px solid var(--vscode-border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 12px'
        }}>
          <div style={{ padding: '4px 8px 24px', display: 'flex', alignItems: 'center' }}>
            <div 
              onClick={onClose}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', background: 'transparent', transition: 'background 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-input)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <X size={18} style={{ opacity: 0.8 }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <SidebarTab label="General" icon={<Settings size={18} strokeWidth={1.5}/>} active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
            <SidebarTab label="Editor" icon={<Code size={18} strokeWidth={1.5}/>} active={activeTab === 'editor'} onClick={() => setActiveTab('editor')} />
            <SidebarTab label="Terminal" icon={<TerminalIcon size={18} strokeWidth={1.5}/>} active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} />
            <SidebarTab label="Chat AI" icon={<Bot size={18} strokeWidth={1.5}/>} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          </div>

          <div style={{ marginTop: 'auto', padding: '12px', fontSize: '11px', color: 'var(--vscode-text)', opacity: 0.4, lineHeight: 1.5, textAlign: 'center' }}>
            Local Cortex v0.1.0<br/>All inference runs locally.
          </div>
        </div>

        {/* ── Right Content ─────────────────────────────────────── */}
        <div style={{ 
          flex: 1, 
          padding: '32px 48px', 
          overflowY: 'overlay',
          background: 'var(--vscode-bg)'
        }}>
          
          <h2 style={{ 
            fontSize: '20px', 
            fontWeight: 500, 
            margin: '0 0 16px 0', 
            paddingBottom: '16px', 
            borderBottom: '1px solid var(--vscode-border)' 
          }}>
            {activeTab === 'general' && 'General Settings'}
            {activeTab === 'editor' && 'Editor Settings'}
            {activeTab === 'terminal' && 'Terminal Settings'}
            {activeTab === 'chat' && 'Chat AI Settings'}
          </h2>

          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Row label="Theme" desc="Application color scheme">
                <div style={{ display: 'flex', background: 'var(--vscode-input)', padding: '4px', borderRadius: '8px', border: '1px solid var(--vscode-border)' }}>
                  {(['dark', 'light'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => set('theme', t)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        background: settings.theme === t ? 'var(--vscode-sidebar)' : 'transparent',
                        color: settings.theme === t ? 'var(--vscode-text-active)' : 'var(--vscode-text)',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: settings.theme === t ? 500 : 400,
                        transition: 'all 0.2s'
                      }}
                    >
                      {t === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                      {t === 'dark' ? 'Dark' : 'Light'}
                    </button>
                  ))}
                </div>
              </Row>

              <Row label="Global Font Size" desc="Base font size used throughout the application">
                <Stepper value={settings.fontSize} min={10} max={28} unit="px" onChange={v => set('fontSize', v)} />
              </Row>
            </div>
          )}

          {activeTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Row label="Tab Size" desc="Number of spaces per indent level">
                <Stepper value={settings.tabSize} min={1} max={8} onChange={v => set('tabSize', v)} />
              </Row>

              <Row label="Word Wrap" desc="Wrap long lines in the editor">
                <Toggle value={settings.wordWrap} onChange={v => set('wordWrap', v)} />
              </Row>

              <Row label="Line Numbers" desc="Show line numbers in the editor gutter">
                <Toggle value={settings.lineNumbers} onChange={v => set('lineNumbers', v)} />
              </Row>

              <Row label="Minimap" desc="Show the code minimap on the right side of the editor">
                <Toggle value={settings.minimap} onChange={v => set('minimap', v)} />
              </Row>
            </div>
          )}

          {activeTab === 'terminal' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Row label="Terminal Font Size" desc="Font size inside the integrated terminal">
                <Stepper value={settings.terminalFontSize} min={10} max={20} unit="px" onChange={v => set('terminalFontSize', v)} />
              </Row>
            </div>
          )}

          {activeTab === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Row label="RAG Context" desc="Automatically search and inject relevant workspace code into every chat reply.">
                <Toggle value={settings.ragEnabled} onChange={v => set('ragEnabled', v)} />
              </Row>

              <Row label="Context Window" desc="Tokens the model can hold in memory. Larger means more context, but uses more RAM and runs slower.">
                <div style={{ display: 'flex', background: 'var(--vscode-input)', padding: '4px', borderRadius: '8px', border: '1px solid var(--vscode-border)' }}>
                  {([2048, 4096, 8192] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => set('numCtx', n)}
                      style={{ 
                        background: settings.numCtx === n ? 'var(--vscode-sidebar)' : 'transparent',
                        color: settings.numCtx === n ? 'var(--vscode-text-active)' : 'var(--vscode-text)',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: settings.numCtx === n ? 500 : 400,
                        transition: 'all 0.2s'
                      }}
                    >
                      {n === 2048 ? '2K' : n === 4096 ? '4K' : '8K'}
                    </button>
                  ))}
                </div>
              </Row>

              <div style={{ padding: '20px 0' }}>
                <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '6px', color: 'var(--vscode-text)' }}>System Prompt</div>
                <div style={{ fontSize: '13px', opacity: 0.5, marginBottom: '12px', lineHeight: 1.4 }}>The hidden instruction injected before every chat message. Defines the AI's personality and rules.</div>
                <textarea
                  value={settings.systemPrompt}
                  onChange={e => set('systemPrompt', e.target.value)}
                  rows={8}
                  style={{
                    width: '100%',
                    background: 'var(--vscode-input)',
                    border: '1px solid var(--vscode-border)',
                    color: 'var(--vscode-text)',
                    padding: '12px 14px',
                    fontSize: '13px',
                    fontFamily: "'Cascadia Code', 'JetBrains Mono', monospace",
                    lineHeight: 1.5,
                    borderRadius: '8px',
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--vscode-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--vscode-border)'}
                />
                <button
                  onClick={() => set('systemPrompt', DEFAULT_SYSTEM_PROMPT)}
                  style={{
                    marginTop: '10px', fontSize: '12px', opacity: 0.7,
                    background: 'transparent', border: '1px solid var(--vscode-border)',
                    color: 'var(--vscode-text)', padding: '6px 14px',
                    borderRadius: '6px', cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-input)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Reset to default
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
