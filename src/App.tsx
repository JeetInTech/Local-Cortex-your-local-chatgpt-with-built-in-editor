import { useState, useEffect } from "react";
import { MessageSquare, Code2, Settings } from "lucide-react";
import "./App.css";
import GptView from "./components/GptView";
import EditorView from "./components/EditorView";
import SettingsModal from "./components/SettingsModal";

function App() {
  const [currentView, setCurrentView] = useState<'gpt' | 'editor'>('editor');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Global Settings
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [fontSize, setFontSize] = useState<number>(14);

  // Apply theme to body
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
          title="GPT Chat"
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

      {/* Main Content Area */}
      <div className="main-view">
        {currentView === 'gpt' ? (
          <GptView fontSize={fontSize} />
        ) : (
          <EditorView fontSize={fontSize} theme={theme} />
        )}
      </div>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
      />
    </div>
  );
}

export default App;
