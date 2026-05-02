import React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import { convertFileSrc } from '@tauri-apps/api/core';
import { File, X as CloseIcon } from 'lucide-react';
import InlineAIWidget from './InlineAIWidget';
import { FileIcon } from './EditorExplorerPanel';
import type { OpenTab } from './EditorView';

interface EditorCodeAreaProps {
  openTabs: OpenTab[];
  activeTab: OpenTab | null;
  theme: string;
  minimap: boolean;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  mdPreviewOnly: boolean;
  diffContent: string | null;
  showInlineAI: boolean;
  inlineAILine: number;
  currentModel: string;
  splitTabIndex: number | null;
  setSplitTabIndex: (idx: number | null) => void;
  setShowInlineAI: (v: boolean) => void;
  handleAcceptInlineAI: (newContent: string) => void;
  handleEditorChange: (val: string | undefined) => void;
  handleEditorWillMount: (monaco: any) => void;
  getEditorThemeName: () => string;
  editorRef: React.MutableRefObject<any>;
  setCursorPos: React.Dispatch<React.SetStateAction<{ line: number; col: number; }>>;
  startDrag: (e: React.MouseEvent, setter: (v: number) => void, current: number, opts: any) => void;
}

const EditorCodeArea: React.FC<EditorCodeAreaProps> = ({
  openTabs,
  activeTab,
  theme,
  minimap,
  fontSize,
  tabSize,
  wordWrap,
  lineNumbers,
  mdPreviewOnly,
  diffContent,
  showInlineAI,
  inlineAILine,
  currentModel,
  splitTabIndex,
  setSplitTabIndex,
  setShowInlineAI,
  handleAcceptInlineAI,
  handleEditorChange,
  handleEditorWillMount,
  getEditorThemeName,
  editorRef,
  setCursorPos,
  startDrag,
}) => {

  if (!activeTab) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', color: 'var(--vscode-text)', opacity: 0.3 }}>
        <File size={56} strokeWidth={1} />
        <div style={{ textAlign: 'center', fontSize: '14px', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>No file open</div>
          <div>Open a folder from the Explorer or File menu</div>
        </div>
      </div>
    );
  }

  const imgExts = ['png','jpg','jpeg','gif','svg','webp','ico','bmp'];
  const ext = activeTab.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = imgExts.includes(ext);
  const isMd = activeTab.language === 'markdown';

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* InlineAI overlay */}
      {showInlineAI && (
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

      {isImage ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vscode-bg)', overflow: 'auto' }}>
          <img
            src={convertFileSrc(activeTab.path)}
            alt={activeTab.name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
          />
        </div>
      ) : isMd && mdPreviewOnly ? (
        <div className="md-preview-pane">
          <ReactMarkdown>{activeTab.content}</ReactMarkdown>
        </div>
      ) : isMd && !mdPreviewOnly ? (
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
      ) : (
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
      )}
    </div>
  );
};

export default EditorCodeArea;
