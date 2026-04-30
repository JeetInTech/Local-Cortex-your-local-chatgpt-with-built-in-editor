import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  FileJson, FileCode2, FileType, ChevronRight,
  ChevronDown, Search, FolderOpen, Save, Folder, File,
  Terminal as TerminalIcon, RotateCw, Bot, Check, Copy, Download,
  GitBranch, SplitSquareHorizontal, Sparkles, Eye, EyeOff,
  X as CloseIcon, Blocks, Play, AlignLeft,
} from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import { convertFileSrc } from '@tauri-apps/api/core';
import TopMenuBar from './TopMenuBar';
import ModelSelector from './ModelSelector';
import TerminalPanel from './TerminalPanel';
import CommandPalette from './CommandPalette';
import type { AppSettings } from './SettingsModal';
import type { EditorFile } from '../App';
import AgentPanel from './AgentPanel';
import GitPanel from './GitPanel';
import SearchPanel from './SearchPanel';
import InlineAIWidget from './InlineAIWidget';
import ExtensionsPanel from './ExtensionsPanel';
import StatusBar from './StatusBar';
import { BeardedTheme, GitHubDarkTheme } from '../themes';

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

function CopilotMsgActions({ content, onAppend }: { content: string; onAppend: (c: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'copilot-response.md';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', opacity: 0.7 }}>
      <button onClick={handleCopy} title="Copy" style={{ background: 'none', border: 'none', color: copied ? '#4caf50' : 'var(--vscode-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
        {copied ? <Check size={12} /> : <Copy size={12} />} Copy
      </button>
      <button onClick={handleDownload} title="Download .md" style={{ background: 'none', border: 'none', color: 'var(--vscode-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
        <Download size={12} /> Download
      </button>
      <button onClick={() => onAppend(content)} title="Append to current file" style={{ background: 'none', border: 'none', color: 'var(--vscode-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
        <FileCode2 size={12} /> Send to Editor
      </button>
    </div>
  );
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
  const [copilotWidth, setCopilotWidth] = useState(300);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showCopilot, setShowCopilot] = useState(true);

  // Recent files
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  // Command palette
  const [showPalette, setShowPalette] = useState(false);
  // Copilot side-panel mode: standard chat or autonomous agent
  const [copilotMode, setCopilotMode] = useState<'chat' | 'agent'>('chat');
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
                  <>
                    <div className="editor-sidebar-header" style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', padding: '10px 12px 10px 20px',
                    }}>
                      <span style={{ opacity: 0.7, fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Explorer
                      </span>
                      <button onClick={handleOpenFolder} title="Open Folder"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}>
                        <FolderOpen size={16} />
                      </button>
                      {rootCwd && (
                        <button onClick={() => refreshTree()} title="Refresh Explorer"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}>
                          <RotateCw size={14} />
                        </button>
                      )}
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
                        rootCwd ? (
                          <div style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, lineHeight: 1.6 }}>
                            Folder is empty.<br />
                            <span style={{ color: 'var(--vscode-accent)', cursor: 'pointer' }} onClick={() => refreshTree()}>Click to Refresh</span>
                          </div>
                        ) : (
                          <div onClick={handleOpenFolder}
                            style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, cursor: 'pointer', lineHeight: 1.6 }}>
                            No folder open.<br />
                            <span style={{ color: 'var(--vscode-accent)' }}>Click to Open Folder</span>
                          </div>
                        )
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
                  </>
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
              {/* Right side of tab bar — actions */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px', paddingRight: '4px' }}>
                {activeTab?.language === 'markdown' && (
                  <button
                    onClick={() => setMdPreviewOnly(v => !v)}
                    title={mdPreviewOnly ? 'Show Editor' : 'Toggle Markdown Preview'}
                    style={{ background: mdPreviewOnly ? 'rgba(0,122,204,0.2)' : 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '4px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                  >
                    {mdPreviewOnly ? <EyeOff size={13} /> : <Eye size={13} />}
                    Preview
                  </button>
                )}
                {activeTab && (settings.enabledExtensions || []).includes('ext.code-runner') && ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'rust'].includes(activeTab.language) && (
                  <button
                    onClick={handleRunCode}
                    title="Run Code"
                    style={{ background: 'rgba(226, 168, 86, 0.1)', border: '1px solid rgba(226, 168, 86, 0.3)', cursor: 'pointer', color: '#e2a856', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 'bold' }}
                  >
                    <Play size={13} /> Run
                  </button>
                )}
                {activeTab && (settings.enabledExtensions || []).includes('ext.prettier') && (
                  <button
                    onClick={handleFormatDocument}
                    title="Format Document (Shift+Alt+F)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.8, padding: '4px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                  >
                    <AlignLeft size={13} /> Format
                  </button>
                )}
                {activeTab && (
                  <button
                    onClick={() => setShowInlineAI(true)}
                    title="Inline AI Edit (Ctrl+K)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c7cff', opacity: 0.8, padding: '4px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                  >
                    <Sparkles size={13} /> AI Edit
                  </button>
                )}
                <button
                  onClick={() => setSplitTabIndex(splitTabIndex === null ? activeTabIndex : null)}
                  title={splitTabIndex !== null ? 'Close Split Editor' : 'Split Editor Right'}
                  style={{ background: splitTabIndex !== null ? 'rgba(0,122,204,0.2)' : 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '4px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                >
                  <SplitSquareHorizontal size={14} />
                </button>
                <div
                  className={`editor-tab ${showTerminal ? 'active' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setShowTerminal(t => !t)}
                  title="Toggle Terminal (Ctrl+J)"
                >
                  <TerminalIcon size={13} /> Terminal
                </div>
              </div>
            </div>

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

                {/* InlineAI overlay */}
                {showInlineAI && activeTab && (
                  <InlineAIWidget
                    visible={showInlineAI}
                    lineNumber={inlineAILine}
                    fileContent={activeTab.content}
                    fileName={activeTab.name}
                    language={activeTab.language}
                    model={currentModel}
                    onAccept={handleAcceptInlineAI}
                    onDismiss={() => setShowInlineAI(false)}
                  />
                )}

                {/* Main editor pane */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {activeTab ? (() => {
                    const imgExts = ['png','jpg','jpeg','gif','svg','webp','ico','bmp'];
                    const ext = activeTab.name.split('.').pop()?.toLowerCase() ?? '';
                    const isImage = imgExts.includes(ext);
                    const isMd = activeTab.language === 'markdown';

                    if (isImage) {
                      return (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vscode-bg)', overflow: 'auto' }}>
                          <img
                            src={convertFileSrc(activeTab.path)}
                            alt={activeTab.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
                          />
                        </div>
                      );
                    }

                    if (isMd && mdPreviewOnly) {
                      return (
                        <div className="md-preview-pane">
                          <ReactMarkdown>{activeTab.content}</ReactMarkdown>
                        </div>
                      );
                    }

                    if (isMd && !mdPreviewOnly) {
                      return (
                        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Editor
                              height="100%"
                              language={activeTab.language}
                              theme={getEditorThemeName()}
                              value={activeTab.content}
                              onChange={handleEditorChange}
                              beforeMount={handleEditorWillMount}
                              onMount={e => { editorRef.current = e; }}
                              options={{ minimap: { enabled: minimap }, fontSize, fontFamily: 'var(--font-mono)', tabSize, padding: { top: 16 }, smoothScrolling: true, wordWrap: wordWrap ? 'on' : 'off', lineNumbers: lineNumbers ? 'on' : 'off', scrollBeyondLastLine: false }}
                            />
                          </div>
                          <div className="md-preview-pane" style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--vscode-border)' }}>
                            <ReactMarkdown>{activeTab.content}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {diffContent ? (
                            <DiffEditor
                              height="100%"
                              theme={getEditorThemeName()}
                              original={activeTab.content}
                              modified={activeTab.content}
                              options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
                            />
                          ) : (
                            <Editor
                              height="100%"
                              language={activeTab.language}
                              theme={getEditorThemeName()}
                              value={activeTab.content}
                              onChange={handleEditorChange}
                              beforeMount={handleEditorWillMount}
                              onMount={editor => {
                                editorRef.current = editor;
                                editor.onDidChangeCursorPosition(e => {
                                  setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                                });
                              }}
                              options={{
                                minimap: { enabled: minimap },
                                fontSize, fontFamily: 'var(--font-mono)', tabSize,
                                padding: { top: 16 }, smoothScrolling: true,
                                wordWrap: wordWrap ? 'on' : 'off',
                                lineNumbers: lineNumbers ? 'on' : 'off',
                                renderWhitespace: 'selection', scrollBeyondLastLine: false,
                              }}
                            />
                          )}
                        </div>
                        {/* Split editor pane */}
                        {splitTabIndex !== null && openTabs[splitTabIndex] && (
                          <>
                            <div className="drag-handle-h" onMouseDown={e => startDrag(e, () => {}, 0, { axis: 'x', min: 200, max: 800 })} />
                            <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--vscode-border)', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', height: '35px', background: 'var(--vscode-sidebar)', borderBottom: '1px solid var(--vscode-border)', fontSize: '12px', gap: '6px' }}>
                                <FileIcon ext={openTabs[splitTabIndex].name.split('.').pop()} isDir={false} />
                                <span style={{ opacity: 0.8 }}>{openTabs[splitTabIndex].name}</span>
                                <div style={{ flex: 1 }} />
                                <button onClick={() => setSplitTabIndex(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.5, display: 'flex' }}><CloseIcon size={13} /></button>
                              </div>
                              <Editor
                                height="100%"
                                language={openTabs[splitTabIndex].language}
                                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                                value={openTabs[splitTabIndex].content}
                                options={{ minimap: { enabled: false }, fontSize, fontFamily: 'var(--font-mono)', tabSize, readOnly: true, scrollBeyondLastLine: false }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })() : (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', color: 'var(--vscode-text)', opacity: 0.3 }}>
                      <File size={56} strokeWidth={1} />
                      <div style={{ textAlign: 'center', fontSize: '14px', lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>No file open</div>
                        <div>Open a folder from the Explorer or File menu</div>
                      </div>
                    </div>
                  )}
                </div>
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
                onMouseDown={e => startDrag(e, setCopilotWidth, copilotWidth, { axis: 'x', invert: true, min: 200, max: 600 })}
                title="Drag to resize copilot"
              />

              {/* ── AI Copilot Panel (draggable width) ── */}
              <div className="editor-chat-panel" style={{ width: `${copilotWidth}px`, minWidth: '200px', maxWidth: '600px', flexShrink: 0 }}>
            <div className="chat-panel-header" style={{ paddingBottom: '0', flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bot size={14} /> AI Copilot
                </span>
                <div style={{ flex: 1 }} />
                {activeTab && (
                  <span style={{ fontSize: '10px', opacity: 0.5, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📄 {activeTab.name}
                  </span>
                )}
              </div>
              {/* Toggle Chat | Agent */}
              <div style={{ display: 'flex', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
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
                <AgentPanel workspace={rootCwd || '.'} model={currentModel} fontSize={terminalFontSize} />
              </div>
            ) : (
              <>
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
                    <>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                      <CopilotMsgActions content={msg.content} onAppend={handleAppendToEditor} />
                    </>
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
            </>
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
