import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Code2, Settings } from "lucide-react";
import "./App.css";
import GptView from "./components/GptView";
import EditorView from "./components/EditorView";
import SettingsModal, { AppSettings } from "./components/SettingsModal";

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  minimap: true,
  terminalFontSize: 13,
  enabledExtensions: [],
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('localcortex-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

export interface EditorFile {
  name: string;
  content: string;
  language: string;
}

function App() {
  const [currentView, setCurrentView] = useState<'gpt' | 'editor'>('editor');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  // ── GPT → Editor bridge ──────────────────────────────────────────────────
  // GptView calls sendToEditor(file) → App queues it → EditorView consumes it
  const [pendingEditorFile, setPendingEditorFile] = useState<EditorFile | null>(null);

  const sendToEditor = useCallback((file: EditorFile) => {
    setPendingEditorFile(file);
    setCurrentView('editor'); // switch to editor view
  }, []);

  const onEditorFileConsumed = useCallback(() => {
    setPendingEditorFile(null);
  }, []);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('localcortex-settings', JSON.stringify(settings));
  }, [settings]);

  // Apply theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  return (
    <div className="app-container">
      {/* Global Activity Bar */}
      <div className="activity-bar">
        <img
          src="/logo.png"
          alt="Local Cortex Logo"
          style={{ width: '32px', height: '32px', marginBottom: '16px', borderRadius: '6px' }}
        />
        <div
          className={`activity-item ${currentView === 'gpt' ? 'active' : ''}`}
          onClick={() => setCurrentView('gpt')}
          title="GPT Chat (Research Mode)"
        >
          <MessageSquare size={24} strokeWidth={1.5} />
        </div>
        <div
          className={`activity-item ${currentView === 'editor' ? 'active' : ''}`}
          onClick={() => setCurrentView('editor')}
          title="Code Editor"
        >
          <Code2 size={24} strokeWidth={1.5} />
        </div>
        <div style={{ flex: 1 }} />
        <div
          className="activity-item"
          title="Settings"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings size={24} strokeWidth={1.5} />
        </div>
      </div>

      {/* Main Content */}
      <div className="main-view">
        <div style={{ display: currentView === 'gpt' ? 'flex' : 'none', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
          <GptView
            fontSize={settings.fontSize}
            onSendToEditor={sendToEditor}
          />
        </div>
        <div style={{ display: currentView === 'editor' ? 'flex' : 'none', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
          <EditorView
            settings={settings}
            setSettings={setSettings}
            pendingEditorFile={pendingEditorFile}
            onEditorFileConsumed={onEditorFileConsumed}
          />
        </div>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />
    </div>
  );
}

export default App;
