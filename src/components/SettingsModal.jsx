import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { audio } from '../utils/audio';

export function SettingsModal({ onClose }) {
    const [enabled, setEnabled] = useState(true);
    const [volume, setVolume] = useState(1.0);

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getAudioSettings().then(settings => {
                setEnabled(settings.enabled);
                setVolume(settings.volume);
            });
        }
    }, []);

    const handleSave = () => {
        const settings = { enabled, volume };
        audio.setSettings(enabled, volume);
        if (window.electronAPI) {
            window.electronAPI.saveAudioSettings(settings);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[999] flex items-center justify-center animate-in fade-in">
            <div className="bg-card w-full max-w-md rounded-2xl border border-white/10 shadow-2xl animate-in zoom-in-95 p-6 space-y-6">
                <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><Volume2 className="text-primary" /> Global Settings</h2>
                    <button onClick={onClose} className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-colors"><X size={20} /></button>
                </div>

                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-bold mb-4 text-muted-foreground uppercase tracking-widest text-xs">Audio Preferences</h3>

                        <div className="flex items-center justify-between bg-black/20 p-4 rounded-xl border border-white/5 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => setEnabled(!enabled)}>
                            <div>
                                <span className="font-bold text-foreground block">Sound Effects</span>
                                <span className="text-xs text-muted-foreground mt-1">Play sounds for moves, captures, and match ends.</span>
                            </div>
                            <button
                                className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${enabled ? 'bg-primary' : 'bg-zinc-700'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-black transition-all ${enabled ? 'right-1' : 'left-1'}`} />
                            </button>
                        </div>

                        {enabled && (
                            <div className="mt-3 bg-black/20 p-4 rounded-xl border border-white/5 space-y-4 animate-in slide-in-from-top-2">
                                <div className="flex justify-between text-sm font-mono font-bold">
                                    <span className="text-primary">Master Volume</span>
                                    <span className="text-foreground">{Math.round(volume * 100)}%</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <VolumeX size={16} className="text-muted-foreground" />
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={volume}
                                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                                        className="flex-1 accent-primary cursor-pointer hover:accent-green-300 transition-all"
                                    />
                                    <Volume2 size={16} className="text-muted-foreground" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                    <button
                        onClick={handleSave}
                        className="w-full py-4 bg-primary text-black font-bold rounded-xl hover:brightness-110 active:scale-[0.98] transition-all text-lg shadow-[0_0_20px_rgba(74,222,128,0.2)]"
                    >
                        Save & Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
