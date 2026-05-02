import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Copy, Download, FileCode2, Save } from 'lucide-react';
import ModelSelector from './ModelSelector';
import type { OpenTab, ChatMessage } from './EditorView';

// ─── Copilot Msg Actions ─────────────────────────────────────────────────────

export function CopilotMsgActions({ content, onAppend }: { content: string; onAppend: (c: string) => void }) {
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

// ─── Panel Component ─────────────────────────────────────────────────────────

interface CopilotChatPanelProps {
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  isGenerating: boolean;
  fontSize: number;
  activeTab: OpenTab | null;
  currentModel: string;
  setCurrentModel: (m: string) => void;
  handleChatSubmit: (e: React.FormEvent) => void;
  handleAppendToEditor: (content: string) => void;
}

const CopilotChatPanel: React.FC<CopilotChatPanelProps> = ({
  messages,
  chatInput,
  setChatInput,
  isGenerating,
  fontSize,
  activeTab,
  currentModel,
  setCurrentModel,
  handleChatSubmit,
  handleAppendToEditor,
}) => {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
    </div>
  );
};

export default CopilotChatPanel;
