import React, { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Play, Shuffle, ChevronDown, Flame, AlertCircle } from 'lucide-react';
import { ChessBoard } from './ChessBoard';
import { Arena } from './Arena';

// Play against an engine with as little setup as possible. AggroChess is picked
// by default (it ships with Coliseum); any other installed engine can be chosen.

const TIME_CONTROLS = [
    { id: '1+0', label: '1+0', group: 'Bullet', initial: 60000, inc: 0 },
    { id: '3+2', label: '3+2', group: 'Blitz', initial: 180000, inc: 2000 },
    { id: '5+0', label: '5+0', group: 'Blitz', initial: 300000, inc: 0 },
    { id: '10+0', label: '10+0', group: 'Rapid', initial: 600000, inc: 0 },
    { id: '15+10', label: '15+10', group: 'Rapid', initial: 900000, inc: 10000 },
    { id: '30+0', label: '30+0', group: 'Classical', initial: 1800000, inc: 0 },
    { id: 'none', label: 'No clock', group: 'Casual', initial: -1, inc: 0 },
];

// with no clock the engine still needs a time per move
const NO_CLOCK_ENGINE_MS = 2000;

const START_FEN = new Chess().fen();
const displayName = (e) => (e?.name || '').replace(/\.exe$/i, '');

function pickDefaultEngine(engines) {
    const aggro = engines.filter((e) => /aggro/i.test(e.name || '') || /aggro/i.test(e.path || ''));
    // several versions installed: take the newest by name ("AggroChess 3.5" over "3.4")
    aggro.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { numeric: true }));
    return aggro[0] || engines[0] || null;
}

export function PlayView({ onReviewGame }) {
    const [engines, setEngines] = useState([]);
    const [engine, setEngine] = useState(null);
    const [showEngines, setShowEngines] = useState(false);
    const [color, setColor] = useState('white'); // 'white' | 'black' | 'random'
    const [tc, setTc] = useState('10+0');
    const [startMode, setStartMode] = useState('standard'); // 'standard' | 'custom'
    const [fenInput, setFenInput] = useState('');
    const [match, setMatch] = useState(null); // matchParams while a game is on
    const [busy, setBusy] = useState(null); // reason the Play button is disabled

    useEffect(() => {
        if (!window.electronAPI) return;
        window.electronAPI.scanEngines().then((found) => {
            const list = found || [];
            setEngines(list);
            setEngine(pickDefaultEngine(list));
        });
        window.electronAPI.invoke('get-tournament-state').then((st) => {
            if (st && st.active) setBusy('A tournament is running. Stop it first to play a game.');
        }).catch(() => {});
    }, []);

    // stop the game if the user leaves the tab mid-game
    useEffect(() => () => {
        if (match && window.electronAPI) window.electronAPI.stopMatch();
    }, [match]);

    const fenCheck = useMemo(() => {
        if (startMode !== 'custom') return { ok: true, fen: null };
        const f = fenInput.trim();
        if (!f) return { ok: false, error: 'Paste a FEN to start from a position.' };
        try {
            const c = new Chess(f);
            if (c.isGameOver()) return { ok: false, error: 'That position is already over.' };
            return { ok: true, fen: c.fen() };
        } catch (e) {
            return { ok: false, error: 'That is not a valid FEN.' };
        }
    }, [startMode, fenInput]);

    const previewFen = startMode === 'custom' && fenCheck.ok && fenCheck.fen ? fenCheck.fen : START_FEN;

    const start = () => {
        if (!engine || !fenCheck.ok || busy) return;
        const me = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
        const t = TIME_CONTROLS.find((x) => x.id === tc) || TIME_CONTROLS[3];
        const humanTc = t.id === 'none' ? { type: 'unlimited', initial: -1, inc: 0 } : { type: 'custom', initial: t.initial, inc: t.inc };
        const engineTc = t.id === 'none' ? { type: 'custom', movetime: NO_CLOCK_ENGINE_MS } : { type: 'custom', initial: t.initial, inc: t.inc };
        setMatch({
            whitePath: me === 'white' ? 'manual' : engine.path,
            blackPath: me === 'black' ? 'manual' : engine.path,
            settings: {
                whiteTimeControl: me === 'white' ? humanTc : engineTc,
                blackTimeControl: me === 'black' ? humanTc : engineTc,
                startFen: fenCheck.fen || undefined,
            },
        });
    };

    const endGame = () => {
        if (window.electronAPI) window.electronAPI.stopMatch();
        setMatch(null);
    };

    if (match) {
        return (
            <div className="h-full">
                <Arena
                    key={JSON.stringify(match)}
                    matchParams={match}
                    casual
                    onBack={endGame}
                    onReview={(pgn) => { endGame(); onReviewGame && onReviewGame(pgn); }}
                />
            </div>
        );
    }

    const isAggro = engine && /aggro/i.test(`${engine.name} ${engine.path}`);

    return (
        <div className="h-full flex flex-col lg:flex-row gap-6 items-stretch lg:items-start justify-center">
            {/* preview board */}
            <div className="flex justify-center lg:flex-1 lg:max-w-[560px]">
                <div className="w-full max-w-[560px] aspect-square">
                    <ChessBoard fen={previewFen} size="100%" orientation={color === 'black' ? 'black' : 'white'} allowDrag={false} />
                </div>
            </div>

            {/* setup */}
            <div className="w-full lg:w-[400px] shrink-0 bg-card border border-white/5 rounded-2xl p-5 flex flex-col gap-5">
                {/* opponent */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Opponent</label>
                    <button
                        type="button"
                        onClick={() => setShowEngines((v) => !v)}
                        className="w-full flex items-center gap-3 bg-black/30 border border-white/10 hover:border-white/20 rounded-xl p-3 text-left transition-all"
                    >
                        <div className={`p-2 rounded-lg border ${isAggro ? 'bg-orange-500/10 border-orange-500/25 text-orange-400' : 'bg-primary/10 border-primary/20 text-primary'}`}>
                            <Flame size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-white truncate">{engine ? displayName(engine) : 'No engines found'}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                                {isAggro ? 'Aggressive and sacrificial, in the spirit of Tal' : engine ? 'Change opponent' : 'Add an engine in Local Engines'}
                            </p>
                        </div>
                        {engines.length > 1 && <ChevronDown size={16} className={`text-muted-foreground transition-transform ${showEngines ? 'rotate-180' : ''}`} />}
                    </button>
                    {showEngines && engines.length > 1 && (
                        <div className="max-h-48 overflow-y-auto hidden-scrollbar flex flex-col gap-1 bg-black/20 border border-white/5 rounded-xl p-1.5">
                            {engines.map((e) => (
                                <button
                                    key={e.path}
                                    type="button"
                                    onClick={() => { setEngine(e); setShowEngines(false); }}
                                    className={`text-left px-3 py-2 rounded-lg text-xs transition-all ${engine?.path === e.path ? 'bg-primary/10 text-primary font-semibold' : 'text-white hover:bg-white/5'}`}
                                >
                                    {displayName(e)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* colour */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">You play</label>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { id: 'white', label: 'White', swatch: 'bg-zinc-100 border-zinc-300' },
                            { id: 'random', label: 'Random' },
                            { id: 'black', label: 'Black', swatch: 'bg-zinc-800 border-zinc-600' },
                        ].map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setColor(c.id)}
                                className={`py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${color === c.id ? 'bg-primary/10 border-primary/45 text-primary' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'}`}
                            >
                                {c.swatch ? <span className={`w-3.5 h-3.5 rounded border ${c.swatch}`} /> : <Shuffle size={13} />}
                                {c.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* time control */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time control</label>
                    <div className="grid grid-cols-4 gap-1.5">
                        {TIME_CONTROLS.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTc(t.id)}
                                title={t.group}
                                className={`py-2 rounded-lg border text-[11px] font-mono transition-all ${tc === t.id ? 'bg-primary/10 border-primary/45 text-primary font-bold' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'} ${t.id === 'none' ? 'col-span-2 font-sans' : ''}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        {(TIME_CONTROLS.find((t) => t.id === tc) || {}).group}
                        {tc === 'none' ? ` · the engine thinks about ${NO_CLOCK_ENGINE_MS / 1000}s per move` : ''}
                    </p>
                </div>

                {/* start position */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Start from</label>
                    <div className="grid grid-cols-2 gap-2">
                        {[{ id: 'standard', label: 'Starting position' }, { id: 'custom', label: 'Custom position' }].map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setStartMode(m.id)}
                                className={`py-2 rounded-xl border text-xs font-semibold transition-all ${startMode === m.id ? 'bg-primary/10 border-primary/45 text-primary' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'}`}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                    {startMode === 'custom' && (
                        <>
                            <textarea
                                value={fenInput}
                                onChange={(e) => setFenInput(e.target.value)}
                                placeholder="Paste a FEN, e.g. from the Board Editor"
                                rows={2}
                                spellCheck={false}
                                className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-[11px] font-mono text-white focus:border-primary outline-none resize-none"
                            />
                            {!fenCheck.ok && fenInput.trim() && (
                                <p className="text-[10px] text-red-400 flex items-center gap-1.5"><AlertCircle size={12} /> {fenCheck.error}</p>
                            )}
                        </>
                    )}
                </div>

                {busy && <p className="text-[11px] text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">{busy}</p>}

                <button
                    type="button"
                    onClick={start}
                    disabled={!engine || !fenCheck.ok || !!busy}
                    className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${engine && fenCheck.ok && !busy ? 'bg-primary text-black hover:brightness-110 shadow-primary/20' : 'bg-zinc-800 text-muted-foreground border border-white/5 cursor-not-allowed'}`}
                >
                    <Play size={18} /> Play
                </button>
            </div>
        </div>
    );
}
