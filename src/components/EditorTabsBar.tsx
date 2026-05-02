import React from 'react';
import { Eye, EyeOff, Play, AlignLeft, Sparkles, SplitSquareHorizontal, Terminal as TerminalIcon, X as CloseIcon } from 'lucide-react';
import { FileIcon } from './EditorExplorerPanel';
import type { AppSettings } from './SettingsModal';
import type { OpenTab } from './EditorView';

interface EditorTabsBarProps {
  openTabs: OpenTab[];
  activeTabIndex: number;
  setActiveTabIndex: (idx: number) => void;
  closeTab: (idx: number, e: React.MouseEvent) => void;
  mdPreviewOnly: boolean;
  setMdPreviewOnly: React.Dispatch<React.SetStateAction<boolean>>;
  settings: AppSettings;
  handleRunCode: () => void;
  handleFormatDocument: () => void;
  setShowInlineAI: (v: boolean) => void;
  splitTabIndex: number | null;
  setSplitTabIndex: (idx: number | null) => void;
  showTerminal: boolean;
  setShowTerminal: React.Dispatch<React.SetStateAction<boolean>>;
}

const EditorTabsBar: React.FC<EditorTabsBarProps> = ({
  openTabs,
  activeTabIndex,
  setActiveTabIndex,
  closeTab,
  mdPreviewOnly,
  setMdPreviewOnly,
  settings,
  handleRunCode,
  handleFormatDocument,
  setShowInlineAI,
  splitTabIndex,
  setSplitTabIndex,
  showTerminal,
  setShowTerminal,
}) => {
  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  return (
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
            <CloseIcon size={12} />
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
  );
};

export default EditorTabsBar;
