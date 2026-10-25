import React, { useState } from 'react';
import { X } from 'lucide-react';

export function PromptModal({ title, onClose, onSubmit }) {
    const [value, setValue] = useState('');

    return (
        <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in">
            <div className="bg-card w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl p-6 space-y-4 animate-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg text-foreground">{title}</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg text-muted-foreground"><X size={16} /></button>
                </div>
                <input
                    autoFocus
                    type="text"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    placeholder="Enter preset name..."
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none font-medium transition-colors"
                    onKeyDown={e => {
                        if (e.key === 'Enter' && value.trim()) {
                            onSubmit(value.trim());
                        }
                    }}
                />
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-foreground font-medium rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={!value.trim()}
                        onClick={() => onSubmit(value.trim())}
                        className="flex-1 py-2.5 bg-primary text-black font-bold rounded-xl hover:brightness-110 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
