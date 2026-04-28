import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  FileJson, FileCode2, FileType, ChevronRight,
  ChevronDown, Search, FolderOpen, Save, Folder, File
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import TopMenuBar from './TopMenuBar';
import ModelSelector from './ModelSelector';

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
  fontSize: number;
  theme: 'dark' | 'light';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', css: 'css', html: 'html', json: 'json',
  md: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shell',
  c: 'c', cpp: 'cpp', java: 'java', go: 'go', rb: 'ruby', php: 'php',
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

// ─── FileTree Component ───────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, onFileClick, activeFilePath, searchQuery
}: {
  node: FileNode;
  depth: number;
  onFileClick: (node: FileNode) => void;
  activeFilePath: string;
  searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isActive = node.path === activeFilePath;

  const visible = !searchQuery ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (node.is_dir && node.children?.some(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())));

  if (!visible && !node.is_dir) return null;

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

const EditorView: React.FC<EditorViewProps> = ({ fontSize, theme }) => {
  const [currentModel, setCurrentModel] = useState('llama3.2:latest');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', content: 'Hi! I am your **Context-Aware Copilot**. Open a file and ask me to explain, refactor, or write code — I can see what you\'re editing!' }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);

  const [rootName, setRootName] = useState<string>('LOCAL CORTEX');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileSearch, setFileSearch] = useState('');

  // Tabs State
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);

  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  // ── Streaming listeners ───────────────────────────────────────────────────


  // ── Keyboard: Ctrl+S to save ──────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        await saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, openTabs]);

  const saveActiveFile = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    try {
      await invoke('write_file', { path: activeTab.path, content: activeTab.content });
      setOpenTabs(prev => prev.map((t, i) =>
        i === activeTabIndex ? { ...t, isDirty: false } : t
      ));
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, [activeTab, activeTabIndex]);

  // ── Open Folder ───────────────────────────────────────────────────────────

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false }) as string | null;
      if (!selected) return;

      const name = selected.split(/[\\/]/).pop() ?? selected;
      setRootName(name.toUpperCase());
      const tree = await invoke<FileNode[]>('read_directory', { path: selected });
      setFileTree(tree);
    } catch (e) {
      console.error('Open folder failed:', e);
    }
  };

  // ── Open File from tree ───────────────────────────────────────────────────

  const handleFileClick = async (node: FileNode) => {
    // Check if already open
    const existingIdx = openTabs.findIndex(t => t.path === node.path);
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
      return;
    }

    try {
      const content = await invoke<string>('read_file', { path: node.path });
      const tab: OpenTab = {
        path: node.path,
        name: node.name,
        content,
        isDirty: false,
        language: getLanguage(node.extension),
      };
      setOpenTabs(prev => [...prev, tab]);
      setActiveTabIndex(openTabs.length); // will be the new last index
    } catch (e) {
      console.error('Open file failed:', e);
    }
  };

  // ── Close Tab ─────────────────────────────────────────────────────────────

  const closeTab = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = openTabs.filter((_, i) => i !== idx);
    setOpenTabs(newTabs);
    if (activeTabIndex >= newTabs.length) {
      setActiveTabIndex(newTabs.length - 1);
    }
  };

  // ── Monaco content change ─────────────────────────────────────────────────

  const handleEditorChange = (val: string | undefined) => {
    if (activeTabIndex < 0) return;
    setOpenTabs(prev => prev.map((t, i) =>
      i === activeTabIndex ? { ...t, content: val ?? '', isDirty: true } : t
    ));
  };

  // ── AI Copilot submit ─────────────────────────────────────────────────────

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;

    const userMsg = chatInput;
    setChatInput('');
    setIsGenerating(true);

    // Build context-aware messages with current file content as system message
    const systemContent = activeTab
      ? `You are a coding assistant inside "Local Cortex" IDE. The user is currently editing a file named "${activeTab.name}".\n\nFile content:\n\`\`\`${activeTab.language}\n${activeTab.content.slice(0, 6000)}\n\`\`\`\n\nAnswer questions about this file directly and concisely.`
      : 'You are a helpful coding assistant inside "Local Cortex" IDE. Help the user with their code questions.';

    const apiMessages = [
      { role: 'system', content: systemContent },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMsg },
    ];

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'ai', content: '' }
    ]);

    const streamId = Date.now().toString();

    // Per-request unique listeners — no cross-component pollution
    const unlistenStream = await listen<string>(`chat-stream-${streamId}`, (event) => {
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'ai') last.content += event.payload;
        return next;
      });
    });
    const unlistenDone = await listen(`chat-stream-done-${streamId}`, () => {
      setIsGenerating(false);
      unlistenStream();
      unlistenDone();
    });

    try {
      await invoke('generate_response', {
        streamId,
        model: currentModel,
        messages: apiMessages,
      });
    } catch (error) {
      setIsGenerating(false);
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'ai') {
          last.content = `**Error:** Could not connect to Ollama. Is it running?\n\n\`${error}\``;
        }
        return next;
      });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <TopMenuBar onOpenFolder={handleOpenFolder} onSave={saveActiveFile} />

      <div className="editor-mode" style={{ flex: 1, minHeight: 0 }}>

        {/* ── File Explorer Sidebar ── */}
        <div className="editor-sidebar">
          <div className="editor-sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 1, padding: '10px 12px 10px 20px' }}>
            <span style={{ opacity: 0.7 }}>Explorer</span>
            <button
              onClick={handleOpenFolder}
              title="Open Folder"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}
            >
              <FolderOpen size={16} />
            </button>
          </div>

          <div className="editor-search">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--vscode-input)', border: '1px solid var(--vscode-border)', padding: '2px 6px' }}>
              <Search size={12} color="var(--vscode-text)" style={{ opacity: 0.5, marginRight: '4px', flexShrink: 0 }} />
              <input
                placeholder="Search files..."
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--vscode-text)', fontSize: '12px', outline: 'none', width: '100%' }}
              />
            </div>
          </div>

          <div className="file-tree">
            {/* Root folder label */}
            <div className="file-item" style={{ color: 'var(--vscode-text)', fontWeight: 'bold', opacity: 0.8, paddingLeft: '12px' }}>
              <ChevronDown size={14} /> {rootName}
            </div>

            {fileTree.length === 0 && (
              <div
                onClick={handleOpenFolder}
                style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, cursor: 'pointer', lineHeight: 1.5 }}
              >
                No folder open. <br />
                <span style={{ color: 'var(--vscode-accent)' }}>Click to Open Folder</span>
              </div>
            )}

            {fileTree.map(node => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={1}
                onFileClick={handleFileClick}
                activeFilePath={activeTab?.path ?? ''}
                searchQuery={fileSearch}
              />
            ))}
          </div>
        </div>

        {/* ── Main Editor Area ── */}
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
                {tab.isDirty && <span style={{ color: 'var(--vscode-accent)', marginLeft: '2px' }}>●</span>}
                <span
                  onClick={e => closeTab(i, e)}
                  style={{ marginLeft: '6px', opacity: 0.5, cursor: 'pointer', fontSize: '12px' }}
                  title="Close"
                >
                  ✕
                </span>
              </div>
            ))}
          </div>

          {/* Monaco Editor */}
          <div className="editor-container">
            {activeTab ? (
              <Editor
                height="100%"
                language={activeTab.language}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={activeTab.content}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: true },
                  fontSize,
                  fontFamily: 'var(--font-mono)',
                  padding: { top: 16 },
                  smoothScrolling: true,
                  wordWrap: 'on',
                  renderWhitespace: 'selection',
                }}
              />
            ) : (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '16px',
                color: 'var(--vscode-text)', opacity: 0.4,
              }}>
                <File size={48} strokeWidth={1} />
                <div style={{ textAlign: 'center', fontSize: '14px', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>No file open</div>
                  <div>Open a folder and click a file to start editing</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right AI Copilot Panel ── */}
        <div className="editor-chat-panel">
          <div className="chat-panel-header">
            <span>AI Copilot</span>
            {activeTab && (
              <span style={{ fontSize: '10px', opacity: 0.5, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ctx: {activeTab.name}
              </span>
            )}
          </div>

          <div className="panel-chat-messages" style={{ fontSize: `${Math.max(12, fontSize - 2)}px` }}>
            {messages.map((msg, i) => (
              <div key={i} className={`panel-message ${msg.role}`}>
                <div style={{
                  fontWeight: 'bold', marginBottom: '4px',
                  color: msg.role === 'user' ? 'var(--vscode-text-active)' : 'var(--vscode-accent)'
                }}>
                  {msg.role === 'user' ? 'You' : 'Copilot'}
                </div>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
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
                placeholder={activeTab ? `Ask about ${activeTab.name}...` : 'Ask Copilot...'}
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
                  paddingTop: '2px', opacity: isGenerating ? 0.5 : 1
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
  );
};

export default EditorView;
