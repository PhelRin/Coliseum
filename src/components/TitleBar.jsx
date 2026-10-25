import React from 'react';
import { Minus, Square, X } from 'lucide-react';

export function TitleBar() {
    const handleMinimize = () => {
        if (window.electronAPI) window.electronAPI.minimizeWindow();
    };

    const handleMaximize = () => {
        if (window.electronAPI) window.electronAPI.maximizeWindow();
    };

    const handleClose = () => {
        if (window.electronAPI) window.electronAPI.closeWindow();
    };

    return (
        <div className="h-8 bg-black/50 w-full flex items-center justify-between px-2 select-none z-[100] border-b border-white/5 backdrop-blur-md app-drag-region shrink-0 fixed top-0 left-0 right-0">
            {/* Drag Region */}
            <div className="flex items-center gap-2 pl-2">
                <div className="w-3 h-3 rounded-full bg-primary/50 shadow-[0_0_5px_rgba(74,222,128,0.2)]" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Coliseum</span>
            </div>

            {/* Window Controls (No Drag) */}
            <div className="flex h-full items-center no-drag bg-transparent z-50 relative" style={{ WebkitAppRegion: 'no-drag' }}>
                <button onClick={handleMinimize} style={{ WebkitAppRegion: 'no-drag' }} className="h-full px-4 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors flex items-center justify-center cursor-pointer">
                    <Minus size={14} />
                </button>
                <button onClick={handleMaximize} style={{ WebkitAppRegion: 'no-drag' }} className="h-full px-4 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors flex items-center justify-center cursor-pointer">
                    <Square size={12} />
                </button>
                <button onClick={handleClose} style={{ WebkitAppRegion: 'no-drag' }} className="h-full px-4 hover:bg-red-500 text-muted-foreground hover:text-white transition-colors flex items-center justify-center cursor-pointer">
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
