import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  FileJson, FileCode2, FileType, ChevronRight,
  ChevronDown, Search, FolderOpen, Save, Folder, File,
  Terminal as TerminalIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import TopMenuBar from './TopMenuBar';
import ModelSelector from './ModelSelector';
import TerminalPanel from './TerminalPanel';
import CommandPalette from './CommandPalette';
import type { AppSettings } from './SettingsModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  extension?: string;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

interface EditorViewProps {
  settings: AppSettings;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', css: 'css', html: 'html', json: 'json',
  md: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shell',
  c: 'c', cpp: 'cpp', java: 'java', go: 'go', rb: 'ruby', php: 'php',
  txt: 'plaintext',
};

const getLanguage = (ext?: string) => EXT_LANGUAGE_MAP[ext ?? ''] ?? 'plaintext';

const FILE_ICON_COLORS: Record<string, string> = {
  ts: '#519aba', tsx: '#519aba', js: '#cbcb41', jsx: '#cbcb41',
  json: '#cbcb41', py: '#3572A5', rs: '#dea584', css: '#563d7c',
  html: '#e34c26', md: '#888', yaml: '#cb171e', yml: '#cb171e',
};

function FileIcon({ ext, isDir }: { ext?: string; isDir: boolean }) {
  const color = FILE_ICON_COLORS[ext ?? ''] ?? '#858585';
  if (isDir) return <Folder size={14} color="#c09553" />;
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': return <FileCode2 size={14} color={color} />;
    case 'json': return <FileJson size={14} color={color} />;
    default: return <FileType size={14} color={color} />;
  }
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── FileTree ────────────────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, onFileClick, activeFilePath, searchQuery,
}: {
  node: FileNode; depth: number;
  onFileClick: (node: FileNode) => void;
  activeFilePath: string; searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isActive = node.path === activeFilePath;
  const matchesSearch = !searchQuery ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase());

  if (!matchesSearch && !node.is_dir) return null;

  return (
    <div>
      <div
        className={`file-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => {
          if (node.is_dir) setIsExpanded(e => !e);
          else onFileClick(node);
        }}
      >
        {node.is_dir && (
          isExpanded
            ? <ChevronDown size={12} style={{ flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ flexShrink: 0 }} />
        )}
        <FileIcon ext={node.extension} isDir={node.is_dir} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
      </div>
      {node.is_dir && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const EditorView: React.FC<EditorViewProps> = ({ settings }) => {
  const { fontSize, tabSize, wordWrap, lineNumbers, minimap, terminalFontSize, theme } = settings;

  const [currentModel, setCurrentModel] = useState('llama3.2:latest');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', content: 'Hi! I\'m your **Context-Aware Copilot**. Open a file and I\'ll be able to see what you\'re editing — ask me to explain, refactor, or debug!' }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);

  // File Explorer
  const [rootName, setRootName] = useState('LOCAL CORTEX');
  const [rootCwd, setRootCwd] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileSearch, setFileSearch] = useState('');

  // Tabs
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);

  // Terminal
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight] = useState(220);

  // Recent files
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  // Command palette
  const [showPalette, setShowPalette] = useState(false);

  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  // ── Load recent files on mount ────────────────────────────────────────────

  useEffect(() => {
    invoke<string[]>('load_recent_files').then(setRecentFiles).catch(() => {});
  }, []);

  const addRecentFile = useCallback((filePath: string) => {
    setRecentFiles(prev => {
      const next = [filePath, ...prev.filter(p => p !== filePath)].slice(0, 10);
      invoke('save_recent_files', { paths: next }).catch(console.error);
      return next;
    });
  }, []);

  // ── Keyboard: Ctrl+S ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ctrl+S = Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        await saveActiveFile();
      }
      // Ctrl+J = Toggle Terminal (VS Code style)
      if ((e.ctrlKey || e.metaKey) && e.key === 'j' && !e.shiftKey) {
        e.preventDefault();
        setShowTerminal(t => !t);
      }
      // Ctrl+Shift+P = Command Palette
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, openTabs, activeTabIndex]);

  const saveActiveFile = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    try {
      await invoke('write_file', { path: activeTab.path, content: activeTab.content });
      setOpenTabs(prev => prev.map((t, i) =>
        i === activeTabIndex ? { ...t, isDirty: false } : t
      ));
    } catch (e) { console.error('Save failed:', e); }
  }, [activeTab, activeTabIndex]);

  // ── Open Folder ───────────────────────────────────────────────────────────

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false }) as string | null;
      if (!selected) return;
      const name = selected.split(/[\\/]/).pop() ?? selected;
      setRootName(name.toUpperCase());
      setRootCwd(selected);
      const tree = await invoke<FileNode[]>('read_directory', { path: selected });
      setFileTree(tree);
    } catch (e) { console.error('Open folder failed:', e); }
  };

  // ── Open File ────────────────────────────────────────────────────────────

  const handleFileOpen = async (path: string, name: string, ext?: string) => {
    const existingIdx = openTabs.findIndex(t => t.path === path);
    if (existingIdx >= 0) { setActiveTabIndex(existingIdx); return; }

    try {
      const content = await invoke<string>('read_file', { path });
      const tab: OpenTab = { path, name, content, isDirty: false, language: getLanguage(ext) };
      setOpenTabs(prev => {
        const next = [...prev, tab];
        setActiveTabIndex(next.length - 1);
        return next;
      });
      addRecentFile(path);
    } catch (e) { console.error('Open file failed:', e); }
  };

  const handleFileClick = (node: FileNode) =>
    handleFileOpen(node.path, node.name, node.extension);

  const handleOpenRecentFile = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.includes('.') ? name.split('.').pop() : undefined;
    handleFileOpen(path, name, ext);
  };

  // ── Close Tab ─────────────────────────────────────────────────────────────

  const closeTab = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = openTabs[idx];
    if (tab.isDirty) {
      const confirmed = await confirm(
        `"${tab.name}" has unsaved changes. Close anyway?`,
        { title: 'Unsaved Changes', kind: 'warning' }
      );
      if (!confirmed) return;
    }
    const newTabs = openTabs.filter((_, i) => i !== idx);
    setOpenTabs(newTabs);
    if (activeTabIndex >= newTabs.length) setActiveTabIndex(newTabs.length - 1);
    else if (activeTabIndex > idx) setActiveTabIndex(activeTabIndex - 1);
  };

  // ── Editor change ─────────────────────────────────────────────────────────

  const handleEditorChange = (val: string | undefined) => {
    if (activeTabIndex < 0) return;
    setOpenTabs(prev => prev.map((t, i) =>
      i === activeTabIndex ? { ...t, content: val ?? '', isDirty: true } : t
    ));
  };

  // ── Copilot submit ────────────────────────────────────────────────────────

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;

    const userMsg = chatInput;
    setChatInput('');
    setIsGenerating(true);

    const systemContent = activeTab
      ? `You are an expert coding assistant embedded in "Local Cortex" IDE. The user has the following file open:\n\nFile: **${activeTab.name}** (${activeTab.language})\n\`\`\`${activeTab.language}\n${activeTab.content.slice(0, 8000)}\n\`\`\`\n\nAnswer concisely and reference the file content when relevant.`
      : 'You are a helpful coding assistant inside "Local Cortex" IDE. Be concise and clear.';

    const apiMessages = [
      { role: 'system', content: systemContent },
      ...messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content })),
      { role: 'user', content: userMsg },
    ];

    const aiPlaceholder: ChatMessage = { role: 'ai', content: '' };
    setMessages(prev => [...prev, { role: 'user', content: userMsg }, aiPlaceholder]);

    const streamId = generateId();

    const unlistenStream = await listen<string>(`chat-stream-${streamId}`, (event) => {
      setMessages(prev => {
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (!last || last.role !== 'ai') return prev;
        return [...prev.slice(0, lastIdx), { ...last, content: last.content + event.payload }];
      });
    });

    const unlistenDone = await listen(`chat-stream-done-${streamId}`, () => {
      setIsGenerating(false);
      unlistenStream();
      unlistenDone();
    });

    try {
      await invoke('generate_response', { streamId, model: currentModel, messages: apiMessages });
    } catch (error) {
      setIsGenerating(false);
      unlistenStream();
      unlistenDone();
      setMessages(prev => {
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (!last || last.role !== 'ai') return prev;
        return [...prev.slice(0, lastIdx), { ...last, content: `**Error:** Ollama not reachable.\n\n\`${error}\`` }];
      });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onOpenFolder={handleOpenFolder}
        onToggleTerminal={() => setShowTerminal(t => !t)}
        recentFiles={recentFiles}
        onOpenRecentFile={handleOpenRecentFile}
      />
      <TopMenuBar
        onOpenFolder={handleOpenFolder}
        onSave={saveActiveFile}
        onToggleTerminal={() => setShowTerminal(t => !t)}
        onOpenCommandPalette={() => setShowPalette(true)}
        recentFiles={recentFiles}
        onOpenRecentFile={handleOpenRecentFile}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="editor-mode" style={{ flex: 1, minHeight: 0 }}>

          {/* ── File Explorer ── */}
          <div className="editor-sidebar">
            <div className="editor-sidebar-header" style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', opacity: 1, padding: '10px 12px 10px 20px',
            }}>
              <span style={{ opacity: 0.7, fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Explorer
              </span>
              <button onClick={handleOpenFolder} title="Open Folder"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}>
                <FolderOpen size={16} />
              </button>
            </div>

            <div className="editor-search">
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--vscode-input)', border: '1px solid var(--vscode-border)', padding: '2px 6px' }}>
                <Search size={12} color="var(--vscode-text)" style={{ opacity: 0.5, marginRight: '4px', flexShrink: 0 }} />
                <input
                  placeholder="Search files…"
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--vscode-text)', fontSize: '12px', outline: 'none', width: '100%' }}
                />
              </div>
            </div>

            <div className="file-tree">
              <div className="file-item" style={{ color: 'var(--vscode-text)', fontWeight: 'bold', opacity: 0.8, paddingLeft: '12px' }}>
                <ChevronDown size={14} /> {rootName}
              </div>
              {fileTree.length === 0 ? (
                <div onClick={handleOpenFolder}
                  style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, cursor: 'pointer', lineHeight: 1.6 }}>
                  No folder open.<br />
                  <span style={{ color: 'var(--vscode-accent)' }}>Click to Open Folder</span>
                </div>
              ) : (
                fileTree.map(node => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={1}
                    onFileClick={handleFileClick}
                    activeFilePath={activeTab?.path ?? ''}
                    searchQuery={fileSearch}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Main Editor + Terminal ── */}
          <div className="editor-main">
            {/* Tabs */}
            <div className="editor-tabs">
              {openTabs.map((tab, i) => (
                <div
                  key={tab.path}
                  className={`editor-tab ${i === activeTabIndex ? 'active' : ''}`}
                  onClick={() => setActiveTabIndex(i)}
                >
                  <FileIcon ext={tab.name.split('.').pop()} isDir={false} />
                  {tab.name}
                  {tab.isDirty && <span style={{ color: 'var(--vscode-accent)', marginLeft: '2px', fontSize: '16px', lineHeight: 1 }}>●</span>}
                  <span
                    onClick={e => closeTab(i, e)}
                    style={{ marginLeft: '6px', opacity: 0.4, cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                    title="Close"
                  >
                    ✕
                  </span>
                </div>
              ))}
              {/* Terminal toggle button in tab bar */}
              <div
                className={`editor-tab ${showTerminal ? 'active' : ''}`}
                style={{ marginLeft: 'auto', cursor: 'pointer' }}
                onClick={() => setShowTerminal(t => !t)}
                title="Toggle Terminal (Ctrl+`)"
              >
                <TerminalIcon size={13} /> Terminal
              </div>
            </div>

            {/* Monaco Editor area + Terminal (vertical split) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="editor-container" style={{ flex: showTerminal ? 1 : 1 }}>
                {activeTab ? (
                  <Editor
                    height="100%"
                    language={activeTab.language}
                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                    value={activeTab.content}
                    onChange={handleEditorChange}
                    options={{
                      minimap: { enabled: minimap },
                      fontSize,
                      fontFamily: 'var(--font-mono)',
                      tabSize,
                      padding: { top: 16 },
                      smoothScrolling: true,
                      wordWrap: wordWrap ? 'on' : 'off',
                      lineNumbers: lineNumbers ? 'on' : 'off',
                      renderWhitespace: 'selection',
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : (
                  <div style={{
                    height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '16px',
                    color: 'var(--vscode-text)', opacity: 0.3,
                  }}>
                    <File size={56} strokeWidth={1} />
                    <div style={{ textAlign: 'center', fontSize: '14px', lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>No file open</div>
                      <div>Open a folder from the Explorer or File menu</div>
                    </div>
                  </div>
                )}
              </div>

              {showTerminal && (
                <div style={{ height: `${terminalHeight}px`, flexShrink: 0 }}>
                  <TerminalPanel
                    cwd={rootCwd || 'C:\\'}
                    fontSize={terminalFontSize}
                    onClose={() => setShowTerminal(false)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── AI Copilot Panel ── */}
          <div className="editor-chat-panel">
            <div className="chat-panel-header">
              <span>AI Copilot</span>
              {activeTab && (
                <span style={{ fontSize: '10px', opacity: 0.5, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📄 {activeTab.name}
                </span>
              )}
            </div>

            <div className="panel-chat-messages" style={{ fontSize: `${Math.max(12, fontSize - 2)}px` }}>
              {messages.map((msg, i) => (
                <div key={i} className={`panel-message ${msg.role}`}>
                  <div style={{
                    fontWeight: 'bold', marginBottom: '4px',
                    color: msg.role === 'user' ? 'var(--vscode-text-active)' : 'var(--vscode-accent)',
                  }}>
                    {msg.role === 'user' ? 'You' : 'Copilot'}
                  </div>
                  {msg.role === 'ai' && msg.content === '' ? (
                    <span className="spin" style={{
                      display: 'inline-block', width: 12, height: 12,
                      border: '2px solid var(--vscode-accent)',
                      borderTopColor: 'transparent', borderRadius: '50%',
                    }} />
                  ) : (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  )}
                </div>
              ))}
            </div>

            <div className="panel-input-container">
              <form onSubmit={handleChatSubmit} className="panel-input-wrapper" style={{ alignItems: 'flex-start' }}>
                <div style={{ marginRight: '8px', paddingTop: '2px' }}>
                  <ModelSelector currentModel={currentModel} onSelect={setCurrentModel} iconOnly direction="up" />
                </div>
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSubmit(e); }
                  }}
                  placeholder={activeTab ? `Ask about ${activeTab.name}…` : 'Ask Copilot…'}
                  className="panel-input"
                  rows={3}
                  style={{ fontSize: `${Math.max(12, fontSize - 2)}px` }}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isGenerating}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: isGenerating ? 'var(--vscode-text)' : 'var(--vscode-accent)',
                    paddingTop: '2px', opacity: isGenerating ? 0.5 : 1,
                  }}
                  title="Send (Enter)"
                >
                  <Save size={14} />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditorView;
