import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, X, Palette, Check } from 'lucide-react';
import { audio } from '../utils/audio';
import { THEMES, BOARDS, PIECE_SETS, useAppearance, setAppearance } from '../appearance';
import { PieceIcon } from './PieceIcons';

export function SettingsModal({ onClose }) {
    const look = useAppearance();
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
            <div className="bg-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl animate-in zoom-in-95 p-6 space-y-6">
                <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><Palette className="text-primary" /> Settings</h2>
                    <button onClick={onClose} className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-colors"><X size={20} /></button>
                </div>

                <div className="space-y-6">
                    <div>
                        <h3 className="font-bold mb-3 text-muted-foreground uppercase tracking-widest text-xs">Appearance</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-5 items-start">
                            <div className="space-y-4 min-w-0">
                                <div>
                                    <p className="text-xs text-muted-foreground mb-2">Theme</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(THEMES).map(([id, t]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => setAppearance({ theme: id })}
                                                className={`text-left p-3 rounded-xl border transition-all ${look.theme === id ? 'border-primary/60 bg-primary/10' : 'border-white/10 bg-black/20 hover:bg-white/5'}`}
                                            >
                                                <div className="flex gap-1 mb-2">
                                                    {t.swatch.map((c) => <span key={c} className="w-5 h-5 rounded-md border border-white/10" style={{ backgroundColor: c }} />)}
                                                </div>
                                                <span className="block text-sm font-bold text-foreground">{t.label}</span>
                                                <span className="block text-[11px] text-muted-foreground">{t.sub}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground mb-2">Board</p>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(BOARDS).map(([id, b]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => setAppearance({ board: id })}
                                                title={b.label}
                                                className={`rounded-lg p-1 border transition-all ${look.board === id ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/30'}`}
                                            >
                                                <span className="grid grid-cols-2 w-10 h-10 rounded overflow-hidden">
                                                    <span style={{ backgroundColor: b.light }} />
                                                    <span style={{ backgroundColor: b.dark }} />
                                                    <span style={{ backgroundColor: b.dark }} />
                                                    <span style={{ backgroundColor: b.light }} />
                                                </span>
                                                <span className="block text-[10px] text-muted-foreground mt-1 w-10 truncate">{b.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground mb-2">Pieces</p>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(PIECE_SETS).map(([id, p]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => setAppearance({ pieces: id })}
                                                className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${look.pieces === id ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 text-muted-foreground hover:text-foreground'}`}
                                            >
                                                {look.pieces === id && <Check size={12} />} {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">Classic and Ivory &amp; bronze pieces are told apart by light and dark, not by colour, so they are easy to read with colour blindness.</p>
                            </div>
                            <BoardPreview board={BOARDS[look.board]} />
                        </div>
                    </div>

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
                                        className="flex-1 accent-primary cursor-pointer hover:brightness-110 transition-all"
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
                        title="Appearance changes are applied straight away; this saves the sound settings"
                        className="w-full py-4 bg-primary text-black font-bold rounded-xl hover:brightness-110 active:scale-[0.98] transition-all text-lg shadow-[0_0_20px_hsl(var(--primary)/0.2)]"
                    >
                        Save & Apply
                    </button>
                </div>
            </div>
        </div>
    );
}

// a corner of a board with a few pieces, to see the choice before closing
function BoardPreview({ board }) {
    const layout = [
        ['r', 'b', null, 'k'],
        ['p', null, 'p', 'n'],
        ['N', 'P', null, 'B'],
        ['K', null, 'Q', 'R'],
    ];
    return (
        <div className="grid grid-cols-4 w-44 h-44 rounded-xl overflow-hidden border-4 border-black/40 shadow-xl mx-auto">
            {layout.flatMap((row, r) =>
                row.map((p, f) => (
                    <div key={`${r}${f}`} className="flex items-center justify-center p-0.5" style={{ backgroundColor: (r + f) % 2 ? board.dark : board.light }}>
                        {p && <PieceIcon type={p.toLowerCase()} color={p === p.toUpperCase() ? 'w' : 'b'} className="w-full h-full drop-shadow" />}
                    </div>
                ))
            )}
        </div>
    );
}
