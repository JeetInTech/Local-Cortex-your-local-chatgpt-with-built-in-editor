import React from 'react';
import { X, Moon, Sun, Minus, Plus } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, theme, setTheme, fontSize, setFontSize }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Settings</span>
          <X size={20} cursor="pointer" onClick={onClose} />
        </div>
        
        <div className="setting-row">
          <span>Theme</span>
          <button 
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>

        <div className="setting-row">
          <span>Font Size</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn-small" onClick={() => setFontSize(Math.max(10, fontSize - 1))}><Minus size={16}/></button>
            <span>{fontSize}px</span>
            <button className="btn-small" onClick={() => setFontSize(Math.min(24, fontSize + 1))}><Plus size={16}/></button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
