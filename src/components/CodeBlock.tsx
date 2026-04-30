import React, { useState, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Download, Send, ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
  onSendToEditor?: (name: string, content: string, language: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx',
  python: 'py', rust: 'rs', go: 'go', java: 'java',
  html: 'html', css: 'css', scss: 'scss',
  json: 'json', yaml: 'yml', toml: 'toml',
  bash: 'sh', shell: 'sh', sh: 'sh', powershell: 'ps1',
  c: 'c', cpp: 'cpp', 'c++': 'cpp',
  markdown: 'md', md: 'md', sql: 'sql', r: 'r',
};

function langToExt(lang: string): string {
  return EXT[lang.toLowerCase()] ?? lang.toLowerCase();
}

function defaultFilename(lang: string): string {
  const ext = langToExt(lang);
  const base: Record<string, string> = {
    html: 'index', css: 'styles', javascript: 'script',
    typescript: 'index', python: 'main', rust: 'main',
  };
  return `${base[lang.toLowerCase()] ?? 'snippet'}.${ext}`;
}

// ─── "Open in editor" dropdown ────────────────────────────────────────────────

const EDITORS = [
  { id: 'cortex', label: 'Local Cortex', icon: '🧠' },
  { id: 'vscode', label: 'VS Code', icon: '💙', cmd: 'code' },
  { id: 'cursor', label: 'Cursor', icon: '⚡', cmd: 'cursor' },
  { id: 'notepad', label: 'Notepad++', icon: '📝', cmd: 'notepad++' },
];

async function openInExternalEditor(cmd: string, filename: string, content: string) {
  // Write to temp then open
  const tempPath = `${await invoke<string>('get_temp_dir')}\\${filename}`;
  await invoke('write_file', { path: tempPath, content });
  await invoke('run_terminal_command', {
    streamId: `open-${Date.now()}`,
    command: `${cmd} "${tempPath}"`,
    cwd: 'C:\\',
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, filename, onSendToEditor }) => {
  const [copied, setCopied] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const resolvedFilename = filename || defaultFilename(language);
  const lang = language || 'text';

  // ── Copy ──────────────────────────────────────────────────────────────────

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resolvedFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Send to Local Cortex editor ───────────────────────────────────────────

  const handleSendToCortex = () => {
    setOpenMenuOpen(false);
    onSendToEditor?.(resolvedFilename, code, lang);
  };

  // ── Open in external editor ───────────────────────────────────────────────

  const handleOpenIn = async (editor: typeof EDITORS[number]) => {
    setOpenMenuOpen(false);
    if (editor.id === 'cortex') { handleSendToCortex(); return; }
    if (!editor.cmd) return;
    try {
      await openInExternalEditor(editor.cmd, resolvedFilename, code);
    } catch (err) {
      console.error('Open in editor failed:', err);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'relative', borderRadius: '8px', overflow: 'hidden',
      border: '1px solid #333', marginBottom: '12px', background: '#1e1e1e',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#2d2d2d', padding: '6px 12px',
        borderBottom: '1px solid #333',
      }}>
        {/* Language + filename badge */}
        <span style={{
          fontSize: '11px', color: '#888',
          fontFamily: "'Cascadia Code', monospace",
          flex: 1,
        }}>
          {lang} · <span style={{ color: '#4ec9b0' }}>{resolvedFilename}</span>
        </span>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>

          {/* Copy */}
          <IconBtn onClick={handleCopy} title={copied ? 'Copied!' : 'Copy code'}>
            {copied ? <Check size={13} color="#4caf50" /> : <Copy size={13} />}
          </IconBtn>

          {/* Download */}
          <IconBtn onClick={handleDownload} title={`Download as ${resolvedFilename}`}>
            <Download size={13} />
          </IconBtn>

          {/* Send to Editor → with dropdown */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <div style={{ display: 'flex', borderRadius: '4px', overflow: 'hidden' }}>
              {/* Main button: send to Local Cortex */}
              <IconBtn
                onClick={handleSendToCortex}
                title="Send to Local Cortex Editor"
                style={{ borderRadius: '4px 0 0 4px', paddingRight: '6px' }}
              >
                <Send size={13} />
                <span style={{ fontSize: '11px', marginLeft: '4px', color: '#ccc' }}>Open in</span>
              </IconBtn>

              {/* Dropdown arrow */}
              <IconBtn
                onClick={() => setOpenMenuOpen(p => !p)}
                title="Open in other editor"
                style={{ borderRadius: '0 4px 4px 0', borderLeft: '1px solid #555', paddingLeft: '4px' }}
              >
                <ChevronDown size={12} />
              </IconBtn>
            </div>

            {/* Dropdown menu */}
            {openMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                  onClick={() => setOpenMenuOpen(false)}
                />
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 4px)',
                  background: '#252526', border: '1px solid #454545',
                  borderRadius: '6px', zIndex: 999, minWidth: '180px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    fontSize: '10px', color: '#666', padding: '6px 12px 4px',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    Open in editor
                  </div>
                  {EDITORS.map(ed => (
                    <div
                      key={ed.id}
                      onClick={() => handleOpenIn(ed)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', cursor: 'pointer', fontSize: '13px',
                        color: ed.id === 'cortex' ? '#4ec9b0' : '#ccc',
                        fontWeight: ed.id === 'cortex' ? 600 : 400,
                        borderLeft: ed.id === 'cortex' ? '2px solid #4ec9b0' : '2px solid transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#37373d'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <span>{ed.icon}</span>
                      <span>{ed.label}</span>
                      {ed.id === 'cortex' && (
                        <span style={{
                          marginLeft: 'auto', fontSize: '10px',
                          background: '#007acc22', color: '#007acc',
                          padding: '1px 5px', borderRadius: '4px',
                        }}>default</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Code content */}
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '14px 16px',
          background: '#1e1e1e',
          fontSize: '13px',
          lineHeight: '1.5',
        }}
        showLineNumbers
        lineNumberStyle={{ color: '#555', minWidth: '2.5em' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

// ─── Icon Button helper ───────────────────────────────────────────────────────

function IconBtn({
  children, onClick, title, style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '2px',
        padding: '4px 8px', cursor: 'pointer', borderRadius: '4px',
        color: '#888', transition: 'all 0.1s',
        ...style,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#3c3c3c';
        (e.currentTarget as HTMLElement).style.color = '#fff';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = '#888';
      }}
    >
      {children}
    </div>
  );
}

export default CodeBlock;
