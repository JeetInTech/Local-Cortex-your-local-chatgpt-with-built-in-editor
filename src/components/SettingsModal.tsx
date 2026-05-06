import React, { useState } from 'react';
import { X, Minus, Plus, Settings, Code, Terminal as TerminalIcon, Bot, Moon, Sun } from 'lucide-react';

export const DEFAULT_SYSTEM_PROMPT = `You are a precise, honest AI coding assistant running locally. Follow these rules absolutely:

1. Answer the actual question immediately. No preamble, no filler phrases like "Certainly!" or "Great question!".
2. Format ALL code with markdown code blocks and the correct language tag (e.g. \`\`\`typescript).
3. HONESTY OVER HELPFULNESS — if you are not sure about something, say so explicitly.
   - Use phrases like "I believe...", "I'm not certain, but...", or "You should verify this."
   - Never invent library names, API signatures, CLI flags, crate names, or function names. If you don't know the exact API, say so and tell the user to check the docs.
4. DETECT MIXED CONCEPTS — if a question combines things that don't go together (e.g. "React Tauri" instead of "Rust Tauri"), point out the inconsistency BEFORE answering. Do not silently answer a question that seems to contain a typo or confused terminology.
   - Example: "You mentioned 'React Tauri' — I think you may mean Tauri with a Rust backend? Tauri's backend is written in Rust, not React. React is only used for the frontend UI. Let me answer based on that assumption."
5. When code snippets are provided between [WORKSPACE CONTEXT] tags, use them to give accurate, project-specific answers.
6. Keep answers tight. Short question → short answer. Complex question → thorough but no padding.
7. Never claim something works if you haven't seen it work in the provided context.`;

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
  temperature: number;   // 0.0–1.0; lower = less hallucination
  clarifyMode: boolean;  // ask model to restate ambiguous queries first
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

              <div style={{ padding: '20px 0', borderBottom: '1px solid var(--vscode-border)' }}>
                <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--vscode-text)', marginBottom: '6px' }}>Context Window</div>
                <div style={{ fontSize: '13px', opacity: 0.5, lineHeight: 1.4, marginBottom: '12px' }}>Max tokens the model sees at once. llama3.2 supports up to 128K. Requires more RAM the higher you go.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, background: 'var(--vscode-input)', padding: '6px', borderRadius: '8px', border: '1px solid var(--vscode-border)' }}>
                  {([
                    { val: 2048,   label: '2K',   hint: '< 3 GB' },
                    { val: 4096,   label: '4K',   hint: '~3 GB' },
                    { val: 8192,   label: '8K',   hint: '~4 GB' },
                    { val: 16384,  label: '16K',  hint: '~5 GB' },
                    { val: 32768,  label: '32K',  hint: '~6 GB' },
                    { val: 65536,  label: '64K',  hint: '~8 GB' },
                    { val: 131072, label: '128K', hint: '~12 GB' },
                  ] as const).map(({ val, label, hint }) => (
                    <button
                      key={val}
                      onClick={() => set('numCtx', val)}
                      title={`Requires ${hint} RAM`}
                      style={{
                        flex: 1,
                        background: settings.numCtx === val ? 'var(--vscode-accent)' : 'transparent',
                        color: settings.numCtx === val ? '#fff' : 'var(--vscode-text)',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: settings.numCtx === val ? 600 : 400,
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        lineHeight: 1.2,
                        minWidth: '50px',
                      }}
                    >
                      <span>{label}</span>
                      <span style={{ fontSize: '10px', opacity: 0.65 }}>{hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Row label="Temperature" desc="Lower = more focused & accurate. Higher = more creative but hallucinates more. Recommended: 0.2–0.5 for coding.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={settings.temperature ?? 0.3}
                    onChange={e => set('temperature', parseFloat(e.target.value))}
                    style={{ width: 120 }}
                  />
                  <span style={{ fontSize: 13, minWidth: 32, fontFamily: 'monospace' }}>{(settings.temperature ?? 0.3).toFixed(2)}</span>
                </div>
              </Row>

              <Row label="Clarify Mode" desc="Before answering, the AI will restate what it understood from your question and flag any ambiguous terms (e.g. 'React Tauri' vs 'Rust Tauri'). Adds one extra step but reduces confident wrong answers.">
                <Toggle value={settings.clarifyMode ?? false} onChange={v => set('clarifyMode', v)} />
              </Row>

              <Row label="Recommended Models" desc="Run 'ollama run <model>' in your terminal to download these.">
                <div style={{ fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.8, lineHeight: 1.5, background: 'var(--vscode-input)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--vscode-border)', width: '300px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong style={{ color: 'var(--vscode-accent)' }}>qwen2.5-coder:7b</strong> <span>~8GB RAM</span></div>
                  <div style={{ marginBottom: 12, fontSize: '11px', opacity: 0.7 }}>The absolute best local model for coding right now. Highly recommended.</div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong style={{ color: 'var(--vscode-accent)' }}>llama3.2</strong> <span>~4GB RAM</span></div>
                  <div style={{ marginBottom: 12, fontSize: '11px', opacity: 0.7 }}>Extremely fast, lightweight, great for older laptops.</div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong style={{ color: 'var(--vscode-accent)' }}>qwen2.5-coder:32b</strong> <span>~24GB RAM</span></div>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>Desktop-class. Matches GPT-4 on coding, but requires a heavy GPU.</div>
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
