import React, { useState, useEffect, useCallback, useRef } from 'react';

import {
  ChevronRight, Search,
  Bot,
  GitBranch, Blocks, Folder,
} from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import TopMenuBar from './TopMenuBar';
import TerminalPanel from './TerminalPanel';
import CommandPalette from './CommandPalette';
import type { AppSettings } from './SettingsModal';
import type { EditorFile } from '../App';
import AgentPanel from './AgentPanel';
import GitPanel from './GitPanel';
import SearchPanel from './SearchPanel';
import ExtensionsPanel from './ExtensionsPanel';
import StatusBar from './StatusBar';
import { BeardedTheme, GitHubDarkTheme } from '../themes';
import EditorExplorerPanel from './EditorExplorerPanel';
import EditorTabsBar from './EditorTabsBar';
import EditorCodeArea from './EditorCodeArea';
import CopilotChatPanel from './CopilotChatPanel';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  extension?: string;
}

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

interface EditorViewProps {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  pendingEditorFile?: EditorFile | null;
  onEditorFileConsumed?: () => void;
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

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}



// ─── Main Component ───────────────────────────────────────────────────────────

const EditorView: React.FC<EditorViewProps> = ({ settings, setSettings, pendingEditorFile, onEditorFileConsumed }) => {
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

  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [copilotWidth, setCopilotWidth] = useState(720);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showCopilot, setShowCopilot] = useState(true);

  // Recent files
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  // Command palette
  const [showPalette, setShowPalette] = useState(false);
  // Copilot side-panel mode: standard chat or autonomous agent
  const [copilotMode, setCopilotMode] = useState<'chat' | 'agent'>('agent');
  // Index status from Rust backend
  const [indexChunks, setIndexChunks] = useState(0);
  const [indexing, setIndexing] = useState(false);

  // ── New: Sidebar tab ────────────────────────────────────────────────────────
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git' | 'search' | 'extensions'>('explorer');

  // ── New: Git state ──────────────────────────────────────────────────────────
  const [gitBranch, setGitBranch] = useState('');
  const [gitDirtyCount, setGitDirtyCount] = useState(0);
  const [diffContent, setDiffContent] = useState<string | null>(null);

  // ── New: Inline AI (Ctrl+K) ─────────────────────────────────────────────────
  const [showInlineAI, setShowInlineAI] = useState(false);
  const [inlineAILine, setInlineAILine] = useState(1);

  // ── New: Split editor ───────────────────────────────────────────────────────
  const [splitTabIndex, setSplitTabIndex] = useState<number | null>(null);

  // ── New: Markdown preview mode ──────────────────────────────────────────────
  const [mdPreviewOnly, setMdPreviewOnly] = useState(false);

  // ── New: Cursor position ────────────────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const editorRef = useRef<any>(null);

  // ── Code Runner Logic ───────────────────────────────────────────────────────


  // ── Live Server Logic ───────────────────────────────────────────────────────
  const handleLiveServer = useCallback(async () => {
    if (!rootCwd) return;
    const command = `python -m http.server 5500`;
    setShowTerminal(true);
    await emit('run-terminal-command', { command });
    setTimeout(() => {
      Command.create('cmd', ['/C', 'start', 'http://localhost:5500']).spawn().catch(console.error);
    }, 1000);
  }, [rootCwd]);

  // ── Formatter ───────────────────────────────────────────────────────────────
  const handleFormatDocument = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  }, []);

  useEffect(() => {
    // Poll chunk count from Rust on mount
    invoke<{ chunks: number }>('get_index_status')
      .then(s => setIndexChunks(s.chunks))
      .catch(() => {});
    // Listen for live indexing progress
    const unP = listen<{ done: number; total: number }>('index-progress', () => setIndexing(true));
    const unD = listen<{ chunks: number }>('index-done', e => {
      setIndexing(false);
      setIndexChunks(e.payload.chunks);
    });
    return () => { unP.then(f => f()); unD.then(f => f()); };
  }, []);

  // ── Generic drag-to-resize ────────────────────────────────────────────────

  const handleEditorWillMount = (monaco: any) => {
    monaco.editor.defineTheme('bearded', BeardedTheme);
    monaco.editor.defineTheme('github-dark', GitHubDarkTheme);
  };

  const getEditorThemeName = () => {
    if (theme === 'bearded') return 'bearded';
    if (theme === 'github-dark') return 'github-dark';
    return theme === 'dark' ? 'vs-dark' : 'light';
  };

  const startDrag = useCallback(
    (e: React.MouseEvent, setter: (v: number) => void, current: number, opts: {
      axis: 'x' | 'y'; invert?: boolean; min: number; max: number;
    }) => {
      e.preventDefault();
      const start = opts.axis === 'x' ? e.clientX : e.clientY;
      const handle = e.currentTarget as HTMLElement;
      handle.classList.add('dragging');
      document.body.style.cursor = opts.axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const pos = opts.axis === 'x' ? ev.clientX : ev.clientY;
        const delta = opts.invert ? start - pos : pos - start;
        setter(Math.max(opts.min, Math.min(opts.max, current + delta)));
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }, []);

  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  // ── Code Runner Logic ───────────────────────────────────────────────────────
  const handleRunCode = useCallback(async () => {
    if (!activeTab) return;
    const path = activeTab.path;
    const noExt = path.replace(/\.[^/.]+$/, '');
    const filenameNoExt = path.split(/[/\\]/).pop()?.split('.')[0] || '';
    
    let command = '';
    switch (activeTab.language) {
      case 'python': command = `python "${path}"`; break;
      case 'javascript':
      case 'typescript': command = `node "${path}"`; break;
      case 'java': command = `javac "${path}" && java ${filenameNoExt}`; break;
      case 'c': command = `gcc "${path}" -o "${noExt}.exe" && ."${noExt.replace(rootCwd, '')}.exe"`; break;
      case 'cpp': command = `g++ "${path}" -o "${noExt}.exe" && ."${noExt.replace(rootCwd, '')}.exe"`; break;
      case 'rust': command = `rustc "${path}" -o "${noExt}.exe" && ."${noExt.replace(rootCwd, '')}.exe"`; break;
      default: return; // Language not supported
    }

    if (command) {
      setShowTerminal(true);
      await emit('run-terminal-command', { command });
    }
  }, [activeTab, rootCwd]);

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

  // ── Consume file sent from GPT → open as virtual unsaved tab ─────────────

  useEffect(() => {
    if (!pendingEditorFile) return;
    const { name, content, language } = pendingEditorFile;
    const virtualPath = `__virtual__${Date.now()}__${name}`;
    const tab: OpenTab = { path: virtualPath, name, content, isDirty: true, language };
    setOpenTabs(prev => {
      const existIdx = prev.findIndex(t => t.path === virtualPath);
      if (existIdx >= 0) {
        setActiveTabIndex(existIdx);
        return prev;
      }
      const next = [...prev, tab];
      setActiveTabIndex(next.length - 1);
      return next;
    });
    onEditorFileConsumed?.();
  }, [pendingEditorFile, onEditorFileConsumed]);

  const handleAppendToEditor = useCallback((content: string) => {
    if (activeTabIndex < 0) return;
    setOpenTabs(prev => {
      const next = [...prev];
      const tab = next[activeTabIndex];
      next[activeTabIndex] = { ...tab, content: tab.content + (tab.content ? '\n\n' : '') + content, isDirty: true };
      return next;
    });
  }, [activeTabIndex]);


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
      // Ctrl+K = Inline AI
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !e.shiftKey) {
        e.preventDefault();
        if (activeTab) {
          const line = editorRef.current?.getPosition()?.lineNumber ?? 1;
          setInlineAILine(line);
          setShowInlineAI(true);
        }
      }
      // Ctrl+Shift+F = Global Search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setSidebarTab('search');
        setShowSidebar(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, openTabs, activeTabIndex]);

  const saveActiveFile = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    try {
      // Virtual tab from GPT → Save As (download via browser)
      if (activeTab.path.startsWith('__virtual__')) {
        const blob = new Blob([activeTab.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = activeTab.name;
        a.click();
        URL.revokeObjectURL(url);
        setOpenTabs(prev => prev.map((t, i) =>
          i === activeTabIndex ? { ...t, isDirty: false } : t
        ));
        return;
      }
      await invoke('write_file', { path: activeTab.path, content: activeTab.content });
      setOpenTabs(prev => prev.map((t, i) =>
        i === activeTabIndex ? { ...t, isDirty: false } : t
      ));
    } catch (e) { console.error('Save failed:', e); }
  }, [activeTab, activeTabIndex]);

  // ── Open file at specific line (from search results) ─────────────────────────
  const handleOpenFileAtLine = useCallback(async (path: string, name: string, lineNumber: number, ext?: string) => {
    await handleFileOpen(path, name, ext);
    // Reveal line after editor mounts — small delay lets Monaco init
    setTimeout(() => {
      editorRef.current?.revealLineInCenter(lineNumber);
      editorRef.current?.setPosition({ lineNumber, column: 1 });
    }, 300);
  }, []);

  // ── Accept Inline AI result ────────────────────────────────────────────────────
  const handleAcceptInlineAI = useCallback((newContent: string) => {
    if (activeTabIndex < 0) return;
    setOpenTabs(prev => prev.map((t, i) =>
      i === activeTabIndex ? { ...t, content: newContent, isDirty: true } : t
    ));
  }, [activeTabIndex]);


  // ── Refresh file tree ────────────────────────────────────────────────────

  const refreshTree = useCallback(async (dir?: string) => {
    const target = dir ?? rootCwd;
    if (!target) return;
    try {
      const tree = await invoke<FileNode[]>('read_directory', { path: target });
      setFileTree(tree);
    } catch (e) { console.error('Refresh tree failed:', e); }
  }, [rootCwd]);

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
        onOpenInVSCode={() => { if (rootCwd) Command.create('cmd', ['/C', 'code', rootCwd]).spawn().catch(console.error); }}
        onOpenInCursor={() => { if (rootCwd) Command.create('cmd', ['/C', 'cursor', rootCwd]).spawn().catch(console.error); }}
        showSidebar={showSidebar}
        showTerminal={showTerminal}
        showCopilot={showCopilot}
        onToggleSidebar={() => setShowSidebar(v => !v)}
        onToggleCopilot={() => setShowCopilot(v => !v)}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="editor-mode" style={{ flex: 1, minHeight: 0 }}>

          {/* ── Sidebar with tab strip ── */}
          {showSidebar && (
            <>
              {/* Sidebar icon tab strip */}
              <div className="sidebar-tab-strip">
                <SidebarTabBtn
                  active={sidebarTab === 'explorer'}
                  onClick={() => setSidebarTab('explorer')}
                  title="Explorer"
                >
                  <Folder size={20} strokeWidth={1.5} />
                </SidebarTabBtn>
                <SidebarTabBtn
                  active={sidebarTab === 'git'}
                  onClick={() => setSidebarTab('git')}
                  title="Source Control"
                >
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <GitBranch size={20} strokeWidth={1.5} />
                    {gitDirtyCount > 0 && (
                      <span style={{
                        position: 'absolute', top: -5, right: -6,
                        background: '#007acc', color: '#fff',
                        fontSize: '9px', borderRadius: '10px', padding: '0 3px', minWidth: '14px',
                        textAlign: 'center', fontWeight: 700, lineHeight: '14px',
                      }}>{gitDirtyCount}</span>
                    )}
                  </span>
                </SidebarTabBtn>
                <SidebarTabBtn
                  active={sidebarTab === 'search'}
                  onClick={() => setSidebarTab('search')}
                  title="Search (Ctrl+Shift+F)"
                >
                  <Search size={20} strokeWidth={1.5} />
                </SidebarTabBtn>
                <SidebarTabBtn
                  active={sidebarTab === 'extensions'}
                  onClick={() => setSidebarTab('extensions')}
                  title="Extensions"
                >
                  <Blocks size={20} strokeWidth={1.5} />
                </SidebarTabBtn>
              </div>

              {/* Sidebar content panel */}
              <div className="editor-sidebar" style={{ width: `${sidebarWidth}px`, minWidth: '120px', maxWidth: '600px', flexShrink: 0 }}>

                {sidebarTab === 'explorer' && (
                  <EditorExplorerPanel
                    rootName={rootName}
                    rootCwd={rootCwd}
                    fileTree={fileTree}
                    fileSearch={fileSearch}
                    setFileSearch={setFileSearch}
                    activeFilePath={activeTab?.path ?? ''}
                    onOpenFolder={handleOpenFolder}
                    onRefreshTree={() => refreshTree()}
                    onFileClick={handleFileClick}
                  />
                )}

                {sidebarTab === 'git' && (
                  <GitPanel
                    rootCwd={rootCwd}
                    onOpenFile={(path, name, ext) => handleFileOpen(path, name, ext)}
                    onDiffFile={(_, diff) => setDiffContent(diff)}
                    onBranchChange={setGitBranch}
                    onDirtyCountChange={setGitDirtyCount}
                  />
                )}

                {sidebarTab === 'search' && (
                  <SearchPanel
                    rootCwd={rootCwd}
                    onOpenFileAtLine={handleOpenFileAtLine}
                  />
                )}

                {sidebarTab === 'extensions' && (
                  <ExtensionsPanel settings={settings} setSettings={setSettings} />
                )}
              </div>

              {/* Sidebar ↔ Editor drag handle */}
              <div
                className="drag-handle-h"
                onMouseDown={e => startDrag(e, setSidebarWidth, sidebarWidth, { axis: 'x', min: 120, max: 600 })}
                title="Drag to resize"
              />
            </>
          )}

          {/* ── Main Editor + Terminal ── */}
          <div className="editor-main">
            {/* Tabs + action buttons */}
            <EditorTabsBar
              openTabs={openTabs}
              activeTabIndex={activeTabIndex}
              setActiveTabIndex={setActiveTabIndex}
              closeTab={closeTab}
              mdPreviewOnly={mdPreviewOnly}
              setMdPreviewOnly={setMdPreviewOnly}
              settings={settings}
              handleRunCode={handleRunCode}
              handleFormatDocument={handleFormatDocument}
              setShowInlineAI={setShowInlineAI}
              splitTabIndex={splitTabIndex}
              setSplitTabIndex={setSplitTabIndex}
              showTerminal={showTerminal}
              setShowTerminal={setShowTerminal}
            />

            {/* Breadcrumbs bar */}
            {activeTab && (
              <div className="breadcrumb-bar">
                {activeTab.path
                  .replace(/\\/g, '/')
                  .split('/')
                  .filter(Boolean)
                  .slice(-4)
                  .map((seg, i, arr) => (
                    <React.Fragment key={i}>
                      {i > 0 && <ChevronRight size={11} style={{ opacity: 0.4, flexShrink: 0 }} />}
                      <span
                        className={`breadcrumb-seg ${i === arr.length - 1 ? 'active' : ''}`}
                        title={seg}
                      >
                        {seg}
                      </span>
                    </React.Fragment>
                  ))
                }
              </div>
            )}

            {/* Monaco Editor area + Terminal (vertical split) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="editor-container" style={{ flex: 1, display: 'flex', position: 'relative' }}>
                <EditorCodeArea
                  openTabs={openTabs}
                  activeTab={activeTab}
                  theme={theme}
                  minimap={minimap}
                  fontSize={fontSize}
                  tabSize={tabSize}
                  wordWrap={wordWrap}
                  lineNumbers={lineNumbers}
                  mdPreviewOnly={mdPreviewOnly}
                  diffContent={diffContent}
                  showInlineAI={showInlineAI}
                  inlineAILine={inlineAILine}
                  currentModel={currentModel}
                  splitTabIndex={splitTabIndex}
                  setSplitTabIndex={setSplitTabIndex}
                  setShowInlineAI={setShowInlineAI}
                  handleAcceptInlineAI={handleAcceptInlineAI}
                  handleEditorChange={handleEditorChange}
                  handleEditorWillMount={handleEditorWillMount}
                  getEditorThemeName={getEditorThemeName}
                  editorRef={editorRef}
                  setCursorPos={setCursorPos}
                  startDrag={startDrag}
                />
              </div>

              {showTerminal && (
                <>
                  {/* Terminal ↕ Editor drag handle */}
                  <div
                    className="drag-handle-v"
                    onMouseDown={e => startDrag(e, setTerminalHeight, terminalHeight, { axis: 'y', invert: true, min: 100, max: 600 })}
                    title="Drag to resize terminal"
                  />
                  <div style={{ height: `${terminalHeight}px`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    {/* Tab bar */}
                    <div style={{
                      display: 'flex', alignItems: 'center', height: '30px',
                      background: 'var(--vscode-sidebar)', borderBottom: '1px solid var(--vscode-border)',
                      paddingLeft: '8px', gap: '0', flexShrink: 0,
                    }}>
                      <div style={{
                        padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center',
                        fontSize: '12px', fontWeight: 600,
                        color: 'var(--vscode-text-active)',
                        borderBottom: '2px solid var(--vscode-accent)',
                        textTransform: 'capitalize',
                      }}>
                        &gt;_ Terminal
                      </div>
                      <div style={{ flex: 1 }} />
                      {/* Index status pill */}
                      {(indexing || indexChunks > 0) && (
                        <span style={{
                          fontSize: '10px',
                          color: indexing ? '#fa0' : '#4caf50',
                          marginRight: '12px',
                          background: 'rgba(255,255,255,0.06)',
                          padding: '2px 8px', borderRadius: '10px',
                        }}>
                          {indexing ? 'Indexing…' : `${indexChunks.toLocaleString()} chunks`}
                        </span>
                      )}
                    </div>

                    {/* Panel content */}
                    <div style={{ flex: 1, overflow: 'hidden', display: 'block' }}>
                      <TerminalPanel
                        cwd={rootCwd || 'C:\\'}
                        fontSize={terminalFontSize}
                        onClose={() => setShowTerminal(false)}
                        onCommandDone={refreshTree}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Editor ↔ Copilot drag handle */}
          {showCopilot && (
            <>
              <div
                className="drag-handle-h"
                onMouseDown={e => startDrag(e, setCopilotWidth, copilotWidth, { axis: 'x', invert: true, min: copilotMode === 'agent' ? 560 : 260, max: 960 })}
                title="Drag to resize copilot"
              />

              {/* ── AI Copilot Panel (draggable width) ── */}
              <div className="editor-chat-panel" style={{ width: `${copilotWidth}px`, minWidth: copilotMode === 'agent' ? '560px' : '260px', maxWidth: '960px', flexShrink: 0 }}>
            <div className="chat-panel-header" style={{ paddingBottom: '0', flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bot size={14} /> Local
                </span>
                <div style={{ flex: 1 }} />
                {activeTab && (
                  <span style={{ fontSize: '10px', opacity: 0.5, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📄 {activeTab.name}
                  </span>
                )}
              </div>
              {/* Toggle Chat | Agent */}
              <div style={{ display: 'none', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                {(['chat', 'agent'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setCopilotMode(mode)}
                    style={{
                      flex: 1, background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer',
                      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px',
                      color: copilotMode === mode ? 'var(--vscode-text-active)' : 'rgba(255,255,255,0.4)',
                      borderBottom: copilotMode === mode ? '2px solid var(--vscode-accent)' : '2px solid transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    {mode === 'agent' ? '🤖 Agent' : '💬 Chat'}
                  </button>
                ))}
              </div>
            </div>

            {copilotMode === 'agent' ? (
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <AgentPanel
                  workspace={rootCwd || '.'}
                  model={currentModel}
                  onModelChange={setCurrentModel}
                  onWorkspaceChanged={() => refreshTree()}
                  fontSize={terminalFontSize}
                />
              </div>
            ) : (
              <CopilotChatPanel
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                isGenerating={isGenerating}
                fontSize={fontSize}
                activeTab={activeTab}
                currentModel={currentModel}
                setCurrentModel={setCurrentModel}
                handleChatSubmit={handleChatSubmit}
                handleAppendToEditor={handleAppendToEditor}
              />
            )}
          </div>
          </>
          )}
        </div>
      </div>
      {/* ── Status Bar ── */}
      <StatusBar
        language={activeTab?.language ?? ''}
        lineNumber={cursorPos.line}
        column={cursorPos.col}
        tabSize={tabSize}
        encoding="UTF-8"
        gitBranch={gitBranch}
        gitDirtyCount={gitDirtyCount}
        indexChunks={indexChunks}
        indexing={indexing}
        activeFileName={activeTab?.name}
        isLiveServerEnabled={(settings.enabledExtensions || []).includes('ext.live-server')}
        onStartLiveServer={handleLiveServer}
      />
    </div>
  );
};

export default EditorView;

// ── SidebarTabBtn helper ─────────────────────────────────────────────────────
function SidebarTabBtn({
  children, active, onClick, title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: '100%', background: 'none', border: 'none',
        borderLeft: active ? '2px solid var(--vscode-accent)' : '2px solid transparent',
        color: active ? 'var(--vscode-text-active)' : 'var(--vscode-text)',
        opacity: active ? 1 : 0.55,
        cursor: 'pointer', padding: '10px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = active ? '1' : '0.55'; }}
    >
      {children}
    </button>
  );
}
