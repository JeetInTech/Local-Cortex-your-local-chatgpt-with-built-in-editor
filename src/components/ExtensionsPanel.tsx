import React from 'react';
import { Blocks, Play, Globe, Sparkles, Paintbrush, FileCode2 } from 'lucide-react';
import type { AppSettings } from './SettingsModal';

interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'Feature' | 'Theme' | 'Language';
}

const AVAILABLE_EXTENSIONS: ExtensionInfo[] = [
  {
    id: 'ext.code-runner',
    name: 'Code Runner',
    description: 'Run code snippet or code file for multiple languages (Python, Java, C++, Rust, Node.js).',
    icon: <Play size={20} color="#e2a856" />,
    category: 'Feature'
  },
  {
    id: 'ext.live-server',
    name: 'Live Server',
    description: 'Launch a local development server with live reload feature for static & dynamic pages.',
    icon: <Globe size={20} color="#4caf50" />,
    category: 'Feature'
  },
  {
    id: 'ext.prettier',
    name: 'Prettier - Code formatter',
    description: 'Code formatter using Prettier. Format your JavaScript, HTML, CSS, and more.',
    icon: <Sparkles size={20} color="#ffeb3b" />,
    category: 'Feature'
  },
  {
    id: 'ext.language-support',
    name: 'Advanced Language Support',
    description: 'Enhanced Syntax highlighting and basic IntelliSense for C++, Rust, Python, Java.',
    icon: <FileCode2 size={20} color="#7c7cff" />,
    category: 'Language'
  },
  {
    id: 'ext.theme-bearded',
    name: 'Bearded Theme',
    description: 'A vibrant, colorful theme for an aesthetic coding experience.',
    icon: <Paintbrush size={20} color="#ff6b6b" />,
    category: 'Theme'
  },
  {
    id: 'ext.theme-github',
    name: 'GitHub Dark Theme',
    description: 'Classic GitHub dark mode syntax highlighting.',
    icon: <Paintbrush size={20} color="#a1a1aa" />,
    category: 'Theme'
  }
];

interface ExtensionsPanelProps {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({ settings, setSettings }) => {
  const exts = settings.enabledExtensions || [];

  const toggleExtension = (id: string) => {
    const isEnabled = exts.includes(id);
    const newExts = isEnabled 
      ? exts.filter(e => e !== id)
      : [...exts, id];
    
    setSettings({ ...settings, enabledExtensions: newExts });
  };

  return (
    <div className="extensions-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--vscode-border)', flexShrink: 0 }}>
        <Blocks size={14} />
        <span style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Extensions</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {['Feature', 'Language', 'Theme'].map(category => (
          <div key={category} style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--vscode-text)', opacity: 0.5, marginBottom: '8px', fontWeight: 600 }}>
              {category}s
            </div>
            {AVAILABLE_EXTENSIONS.filter(e => e.category === category).map(ext => {
              const enabled = exts.includes(ext.id);
              return (
                <div key={ext.id} style={{
                  display: 'flex', padding: '10px', background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--vscode-border)', borderRadius: '6px', marginBottom: '8px',
                  alignItems: 'flex-start', gap: '12px'
                }}>
                  <div style={{ padding: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                    {ext.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--vscode-text-active)', marginBottom: '4px' }}>
                      {ext.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--vscode-text)', opacity: 0.7, lineHeight: 1.4, marginBottom: '8px' }}>
                      {ext.description}
                    </div>
                    <button
                      onClick={() => toggleExtension(ext.id)}
                      style={{
                        background: enabled ? 'rgba(255,255,255,0.1)' : 'var(--vscode-accent)',
                        color: enabled ? 'var(--vscode-text)' : '#fff',
                        border: 'none', padding: '4px 12px', borderRadius: '4px',
                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {enabled ? 'Disable' : 'Install'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExtensionsPanel;
