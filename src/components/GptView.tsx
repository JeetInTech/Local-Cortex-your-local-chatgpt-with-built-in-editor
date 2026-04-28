import React, { useState, useRef, useEffect } from 'react';
import { Plus, Send, Bot, User, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import ModelSelector from './ModelSelector';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
}

interface GptViewProps {
  fontSize: number;
}

const GptView: React.FC<GptViewProps> = ({ fontSize }) => {
  const [currentModel, setCurrentModel] = useState("Llama-3-8B-Instruct");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'ai',
      content: `Hello! I am ${currentModel}. How can I assist you with your research or coding today?`
    }
  ]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let unlistenStream: UnlistenFn;
    let unlistenDone: UnlistenFn;

    const setupListeners = async () => {
      unlistenStream = await listen<string>('chat-stream', (event) => {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg && lastMsg.role === 'ai') {
            lastMsg.content += event.payload;
          }
          return newMessages;
        });
      });

      unlistenDone = await listen('chat-stream-done', () => {
        setIsGenerating(false);
      });
    };

    setupListeners();

    return () => {
      if (unlistenStream) unlistenStream();
      if (unlistenDone) unlistenDone();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    const apiMessages = [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: input }];
    
    setMessages(prev => [
      ...prev, 
      userMessage,
      { id: (Date.now() + 1).toString(), role: 'ai', content: '' }
    ]);
    setInput('');
    setIsGenerating(true);

    try {
      await invoke('generate_response', {
        model: currentModel.toLowerCase(),
        messages: apiMessages
      });
    } catch (error) {
      console.error("Failed to generate response:", error);
      setIsGenerating(false);
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg && lastMsg.role === 'ai') {
          lastMsg.content = `**Error:** Failed to connect to local AI. Is Ollama running?\\n\\nDetails: ${error}`;
        }
        return newMessages;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="gpt-mode" style={{ fontSize: `${fontSize}px` }}>
      {/* GPT Sidebar */}
      <div className="gpt-sidebar">
        <button className="gpt-new-chat-btn">
          <Plus size={16} />
          New chat
        </button>
        
        <div className="gpt-search">
          <Search size={14} color="var(--gpt-text-muted)" />
          <input 
            placeholder="Search history..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="gpt-history-list">
          <div className="gpt-history-item">Local LLM Setup</div>
          <div className="gpt-history-item">Rust vs Tauri Backend</div>
          <div className="gpt-history-item">React Hooks Tutorial</div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="gpt-main-chat">
        <div className="chat-header-bar">
          <ModelSelector currentModel={currentModel} onSelect={setCurrentModel} />
        </div>

        <div className="gpt-chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className="gpt-message">
              <div className={`gpt-avatar ${msg.role}`}>
                {msg.role === 'ai' ? <Bot size={20} /> : <User size={20} />}
              </div>
              <div className="gpt-message-content">
                <ReactMarkdown
                  components={{
                    code({ node, inline, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      return !inline && match ? (
                        <SyntaxHighlighter
                          style={vscDarkPlus as any}
                          language={match[1]}
                          PreTag="div"
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="gpt-input-container">
          <form onSubmit={handleSubmit} className="gpt-input-wrapper">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${currentModel}...`}
              className="gpt-input"
              rows={1}
              style={{ 
                height: Math.min(input.split('\n').length * 24 + 8, 200) + 'px',
                fontSize: `${fontSize}px`
              }}
            />
            <button 
              type="submit" 
              className="gpt-send-btn"
              disabled={!input.trim() || isGenerating}
            >
              <Send size={14} />
            </button>
          </form>
          <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--gpt-text-muted)', marginTop: '12px' }}>
            Local Cortex can make mistakes. Consider verifying important information.
          </div>
        </div>
      </div>
    </div>
  );
};

export default GptView;
