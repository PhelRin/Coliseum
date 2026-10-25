import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Activity, Hash, RotateCw, Search, Zap, Square, Download } from 'lucide-react';
import { PieceIcon } from './PieceIcons';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './EvalBar';
import { audio } from '../utils/audio';
import { getRatingTier } from './EngineStatsModal';
import { useElementSize, formatClock } from './live/useLive';

export function Arena({ matchParams, onBack = () => { }, shouldStart = true, isTournament = false, hideWhitePanel = false, hideBlackPanel = false, isTwitch = false }) {
    // ... state ...
    const [fen, setFen] = useState(() => new Chess().fen());
    const [game] = useState(new Chess());
    const [lastMove, setLastMove] = useState('');
    const [logs, setLogs] = useState([]);
    const [whiteInfo, setWhiteInfo] = useState({});
    const [blackInfo, setBlackInfo] = useState({});
    const [clocks, setClocks] = useState(() => {
        const wTC = matchParams.settings.whiteTimeControl;
        const bTC = matchParams.settings.blackTimeControl;
        return {
            w: wTC ? (wTC.type === 'unlimited' ? -1 : wTC.initial) : (matchParams.settings.initial || 60000),
            b: bTC ? (bTC.type === 'unlimited' ? -1 : bTC.initial) : (matchParams.settings.initial || 60000)
        };
    });
    const [matchResult, setMatchResult] = useState(null);
    const [pgn, setPgn] = useState('');
    const [careerStats, setCareerStats] = useState({});
    const [orientation, setOrientation] = useState(() => 
        (matchParams.blackPath === 'manual' && matchParams.whitePath !== 'manual') ? 'black' : 'white'
    );

    const [names, setNames] = useState({ w: null, b: null });
    const [rootRef, rootSize] = useElementSize();
    const [boardRef, boardSize] = useElementSize();

    const logsEndRef = useRef(null);

    // Auto-scroll logs to bottom
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
        }
    }, [logs]);

    // Live Timer Ticker
    useEffect(() => {
        if (matchResult) return;
        const interval = setInterval(() => {
            setClocks(prev => {
                const turn = game.turn();
                const newClocks = { ...prev };
                // Decrease active turn by 100ms
                if (newClocks[turn] !== -1 && newClocks[turn] > 0) {
                    newClocks[turn] -= 100;
                }
                return newClocks;
            });
        }, 100);
        return () => clearInterval(interval);
    }, [matchResult, game, fen]); // Depend on fen/game to switch turns correctly

    useEffect(() => {
        if (!window.electronAPI) return;

        window.electronAPI.getStore('engineCareerStats').then(stats => {
            if (stats) setCareerStats(stats);
        });

        if (shouldStart) {
            window.electronAPI.startMatch(matchParams);
        }

        window.electronAPI.onMatchStarted((data) => {
            console.log("Match Started", data);
            setFen(data.fen);
            game.load(data.fen); // Sync game instance
            setNames({ w: data.white && data.white.name, b: data.black && data.black.name });
            if (data.clocks) setClocks(data.clocks);
            setLogs(prev => [...prev, `Match started: ${data.white.name} vs ${data.black.name}`]);
        });

        window.electronAPI.onMatchError((err) => {
            console.error("Match Error", err);
            setLogs(prev => [...prev, `ERROR: ${err}`]);
            setMatchResult({ winner: 'error', reason: err });
        });

        window.electronAPI.onMatchUpdate((data) => {
            setFen(data.fen);
            setLastMove(data.lastMove);
            setClocks(data.clocks); // Authoritative sync
            game.load(data.fen);

            const nextTurn = game.turn();
            if (nextTurn === 'w') {
                setWhiteInfo({});
            } else {
                setBlackInfo({});
            }

            // Play sounds based on SAN notation (if available) or assume regular move
            if (data.san) {
                if (data.san.includes('x')) {
                    audio.playCapture();
                } else if (data.san.includes('+') || data.san.includes('#')) {
                    // Could be a different check sound, using move for now but capture for harsh impact
                    audio.playCapture();
                } else {
                    audio.playMove();
                }
            } else {
                audio.playMove();
            }
        });

        window.electronAPI.onEngineInfo((data) => {
            if (data.color === 'w') {
                setWhiteInfo(prev => ({ ...prev, ...data.info }));
            } else {
                setBlackInfo(prev => ({ ...prev, ...data.info }));
            }
        });

        window.electronAPI.onMatchLog((msg) => {
            setLogs(prev => [...prev, msg]);
        });

        window.electronAPI.onMatchEnded(async (data) => {
            try {
                audio.playEnd();
                setMatchResult(data);
                if (data.pgn) setPgn(data.pgn);

                if (!isTournament && window.electronAPI) {
                    const history = await window.electronAPI.getStore('matchHistory') || [];
                    history.unshift({
                        date: new Date().toISOString(),
                        white: matchParams.whitePath ? matchParams.whitePath.split(/[\\/]/).pop() : 'Manual',
                        black: matchParams.blackPath ? matchParams.blackPath.split(/[\\/]/).pop() : 'Manual',
                        winner: data.winner,
                        reason: data.reason,
                        pgn: data.pgn
                    });
                    if (history.length > 100) history.length = 100;
                    await window.electronAPI.setStore('matchHistory', history);
                }
            } catch (e) {
                console.error("Failed to handle match end in Arena:", e);
            }
        });

        return () => {
            if (window.electronAPI && window.electronAPI.removeAllListeners) {
                window.electronAPI.removeAllListeners('match-started');
                window.electronAPI.removeAllListeners('match-error');
                window.electronAPI.removeAllListeners('board-update');
                window.electronAPI.removeAllListeners('engine-info');
                window.electronAPI.removeAllListeners('match-log');
                window.electronAPI.removeAllListeners('match-ended');
            }
        };
    }, []);

    const handleSavePgn = async () => {
        if (!pgn || !window.electronAPI) return;
        const defaultPath = `match_${Date.now()}.pgn`;
        const filePath = await window.electronAPI.dialogSaveFile({
            defaultPath,
            filters: [{ name: 'PGN Files', extensions: ['pgn'] }]
        });
        if (filePath) {
            await window.electronAPI.saveFileContent(filePath, pgn);
        }
    };

    // --- Human Move Logic ---
    const isHumanTurn = !matchResult && (
        (game.turn() === 'w' && matchParams.whitePath === 'manual') ||
        (game.turn() === 'b' && matchParams.blackPath === 'manual')
    );

    const handlePieceDrop = (from, to) => {
        if (!isHumanTurn) return;

        try {
            // Validate move locally using the synced game instance
            const tempGame = new Chess(fen);
            const moveResult = tempGame.move({ from, to, promotion: 'q' });

            if (moveResult) {
                // Formatting UCI string 'e2e4' or 'e7e8q'
                const moveStr = from + to + (moveResult.promotion ? 'q' : '');
                if (window.electronAPI) {
                    window.electronAPI.manualMove(moveStr);
                }
            }
        } catch (e) {
            // Ignore illegal drops
        }
    };

    // Calculate Brain Map Arrows
    const arrows = [];

    // Helper to extract first move from PV string
    const getBestMove = (info) => {
        if (!info || !info.pv) return null;
        const moves = info.pv.split(' ');
        if (moves.length > 0) return moves[0];
        return null;
    };

    const whiteBest = getBestMove(whiteInfo);
    const blackBest = getBestMove(blackInfo);

    if (whiteBest && game.turn() === 'w') {
        arrows.push({
            from: whiteBest.substring(0, 2),
            to: whiteBest.substring(2, 4),
            color: '#4ade80' // primary green
        });
    }

    if (blackBest && game.turn() === 'b') {
        arrows.push({
            from: blackBest.substring(0, 2),
            to: blackBest.substring(2, 4),
            color: '#f87171' // bright red/orange
        });
    }

    const labelFor = (side) => {
        const path = side === 'w' ? matchParams.whitePath : matchParams.blackPath;
        if (path === 'manual') return 'Human Player';
        if (names[side]) return names[side];
        return path ? path.split(/[\\/]/).pop().replace(/\.exe$/i, '') : 'Unknown';
    };
    const ratingFor = (side) => careerStats[side === 'w' ? matchParams.whitePath : matchParams.blackPath]?.rating;

    // wide enough for the two engine panels beside the board?
    const wide = rootSize.width >= 1080;
    const showWhitePanel = wide && !hideWhitePanel;
    const showBlackPanel = wide && !hideBlackPanel;
    const turn = game.turn();
    const topSide = orientation === 'white' ? 'b' : 'w';
    const bottomSide = topSide === 'w' ? 'b' : 'w';
    const boardPx = Math.max(220, Math.floor(Math.min(boardSize.width - 32, boardSize.height)));
    const showToolbar = !isTwitch;

    const strip = (side) => {
        const info = side === 'w' ? whiteInfo : blackInfo;
        const time = side === 'w' ? clocks.w : clocks.b;
        const active = !matchResult && turn === side;
        const r = ratingFor(side);
        const panelShown = side === 'w' ? showWhitePanel : showBlackPanel;
        return (
            <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border min-w-0 ${active ? 'bg-white/[0.05] border-white/10' : 'bg-card/60 border-white/5'}`} style={{ width: boardPx + 32, maxWidth: '100%' }}>
                <span className={`w-3.5 h-3.5 rounded shrink-0 border ${side === 'w' ? 'bg-zinc-100 border-zinc-300' : 'bg-zinc-800 border-zinc-600'}`} />
                <span className="font-semibold text-sm text-foreground truncate min-w-0" title={labelFor(side)}>{labelFor(side)}</span>
                {r !== undefined && <span className="text-[11px] font-mono text-muted-foreground shrink-0">{r}</span>}
                <span className="ml-auto flex items-center gap-3 shrink-0">
                    {!panelShown && active && info.depth && (
                        <span className="text-[11px] font-mono text-muted-foreground hidden sm:inline">
                            {formatEval(info.score, side)} · d{info.depth}
                        </span>
                    )}
                    <span className={`font-mono text-lg font-bold tabular-nums px-2 rounded-lg ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground'} ${active && time !== -1 && time < 10000 ? '!text-red-400' : ''}`}>
                        {formatClock(time)}
                    </span>
                </span>
            </div>
        );
    };

    return (
        <div ref={rootRef} className={`flex flex-col w-full h-full min-h-[480px] gap-3 animate-fade-in relative ${isTwitch ? 'p-2' : ''}`}>
            {showToolbar && (
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={onBack}
                        className="px-4 py-2 bg-red-500/90 hover:bg-red-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        <Square size={12} className="fill-current" /> End match
                    </button>
                    <button
                        onClick={() => setOrientation(prev => prev === 'white' ? 'black' : 'white')}
                        className="px-3 py-2 bg-white/5 hover:bg-white/10 text-foreground rounded-xl text-sm flex items-center gap-2"
                        title="Flip board"
                    >
                        <RotateCw size={14} /> Flip
                    </button>
                    {matchResult && pgn && (
                        <button onClick={handleSavePgn} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-foreground rounded-xl text-sm flex items-center gap-2">
                            <Download size={14} /> Save PGN
                        </button>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground truncate hidden sm:block">
                        {labelFor('w')} <span className="text-muted-foreground/50">vs</span> {labelFor('b')}
                    </span>
                </div>
            )}

            <div className="flex-1 min-h-0 flex gap-4">
                {showWhitePanel && (
                    <div className="w-[260px] 2xl:w-[300px] shrink-0 min-h-0">
                        <EnginePanel name={labelFor('w')} info={whiteInfo} color="white" time={clocks.w} rating={ratingFor('w')} active={!matchResult && turn === 'w'} />
                    </div>
                )}

                <div className="flex-1 min-w-0 min-h-0 flex flex-col items-center gap-2">
                    {strip(topSide)}
                    <div ref={boardRef} className="flex-1 min-h-0 w-full flex items-center justify-center">
                        <div className="flex items-stretch gap-3" style={{ height: boardPx }}>
                            <EvalBar score={whiteInfo.score && turn === 'w' ? whiteInfo.score : blackInfo.score ? { ...blackInfo.score, value: String(-(parseInt(blackInfo.score.value, 10) || 0)) } : whiteInfo.score} color="white" />
                            <div className="relative" style={{ width: boardPx, height: boardPx }}>
                                <ChessBoard
                                    fen={fen}
                                    lastMove={lastMove}
                                    size={`${boardPx}px`}
                                    thinFrame={boardPx < 420}
                                    orientation={orientation}
                                    arrows={arrows}
                                    allowDrag={isHumanTurn}
                                    onPieceDrop={handlePieceDrop}
                                />
                                {matchResult && (
                                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg p-4">
                                        <div className="bg-card border border-primary/40 p-6 rounded-2xl text-center max-w-sm w-full border-t-4 border-t-primary">
                                            <h2 className="text-2xl font-black mb-1 text-foreground tracking-tight">
                                                {matchResult.winner === 'error' ? 'Something went wrong' : matchResult.winner === 'draw' ? 'Draw' : `${labelFor(matchResult.winner === 'white' ? 'w' : 'b')} wins`}
                                            </h2>
                                            {matchResult.winner !== 'error' && (
                                                <p className="text-lg text-primary font-mono mb-2">{matchResult.winner === 'white' ? '1-0' : matchResult.winner === 'black' ? '0-1' : '½-½'}</p>
                                            )}
                                            <p className="text-muted-foreground mb-5 text-sm">{matchResult.reason}</p>
                                            {!isTwitch && (
                                                <button onClick={onBack} className="px-6 py-2.5 bg-primary text-black font-bold rounded-xl hover:brightness-110">
                                                    Back to setup
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {strip(bottomSide)}
                    <div
                        ref={logsEndRef}
                        className="h-20 overflow-y-auto bg-black/60 border border-white/5 rounded-xl px-3 py-2 font-mono text-[10px] text-primary/70 shrink-0"
                        style={{ width: boardPx + 32, maxWidth: '100%' }}
                    >
                        {logs.slice(-20).map((l, i) => (
                            <div key={i} className="whitespace-pre-wrap border-b border-white/5 py-0.5">{`> ${l}`}</div>
                        ))}
                    </div>
                </div>

                {showBlackPanel && (
                    <div className="w-[260px] 2xl:w-[300px] shrink-0 min-h-0">
                        <EnginePanel name={labelFor('b')} info={blackInfo} color="black" time={clocks.b} rating={ratingFor('b')} active={!matchResult && turn === 'b'} />
                    </div>
                )}
            </div>
        </div>
    );
}

// engine score (from the side to move) as text from White's point of view
function formatEval(score, side) {
    if (!score) return '–';
    const v = parseInt(score.value, 10) || 0;
    const w = side === 'w' ? v : -v;
    if (score.unit === 'mate') return `${w < 0 ? '-' : ''}M${Math.abs(w)}`;
    return `${w > 0 ? '+' : ''}${(w / 100).toFixed(2)}`;
}


// EvalBar was extracted to ./EvalBar.jsx

function EnginePanel({ name, info, color, time, rating, active }) {
    const formatTime = (ms) => {
        if (ms === -1) return '∞';
        const totalSec = Math.max(0, Math.ceil(ms / 1000));
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    };

    const isWhite = color === 'white';
    const tier = rating !== undefined ? getRatingTier(rating) : null;

    return (
        <div className={`w-full h-full bg-card border rounded-2xl flex flex-col relative overflow-hidden ${active ? 'border-primary/30' : 'border-white/5'} ${isWhite ? 'border-t-4 border-t-zinc-200' : 'border-t-4 border-t-zinc-700'}`}>
            {/* Header */}
            <div className="bg-black/20 p-4 border-b border-white/5">
                <div className="flex justify-between items-start mb-4">
                    <div className="min-w-0 flex-1 pr-2">
                        <h3 className="font-bold text-lg truncate text-foreground" title={name}>{name}</h3>
                        {rating !== undefined && tier && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-xs font-mono text-primary font-bold">{rating} ELO</span>
                                <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tier.badgeClass}`}>
                                    {tier.title}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider shrink-0 ${isWhite ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
                        {color}
                    </div>
                </div>
                <div className={`text-3xl 2xl:text-4xl font-mono font-bold tracking-tight tabular-nums transition-colors ${time !== -1 && time < 10000 ? 'text-red-500' : active ? 'text-primary' : 'text-foreground'}`}>
                    {formatTime(time)}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="flex-1 p-4 space-y-4 font-mono text-xs overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                    <StatBox label="Depth" value={info.depth || '-'} icon={<Search size={12} />} />
                    <StatBox label="Nodes" value={info.nodes ? (info.nodes / 1000000).toFixed(2) + 'M' : '-'} icon={<Hash size={12} />} />
                    <StatBox label="NPS" value={info.nps ? (info.nps / 1000).toFixed(0) + 'k' : '-'} icon={<Zap size={12} />} />
                    <StatBox 
                        label="Score" 
                        value={
                            info.score 
                                ? (info.score.unit === 'mate' 
                                    ? `M${info.score.value}` 
                                    : (parseInt(info.score.value) / 100).toFixed(2)) 
                                : '-'
                        } 
                        icon={<Activity size={12} />} 
                        highlight={true} 
                    />
                </div>

                {(
                    <div className="mt-4">
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Principal Variation</label>
                        <div className="p-3 bg-black/40 rounded-lg border border-white/5 max-h-48 overflow-y-auto text-primary/80 leading-relaxed break-words">
                            {info.pv ? info.pv.split(' ').map((m, i) => <span key={i} className="hover:text-white cursor-default mr-1">{m}</span>) : <span className="text-muted-foreground/30">Thinking...</span>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function StatBox({ label, value, icon, highlight }) {
    return (
        <div className={`p-2 rounded-lg border flex flex-col gap-1 ${highlight ? 'bg-primary/10 border-primary/20' : 'bg-black/20 border-white/5'}`}>
            <div className="flex items-center gap-1 text-muted-foreground text-[10px] uppercase">
                {icon} {label}
            </div>
            <div className={`font-bold text-sm truncate ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</div>
        </div>
    )
}

// ChessBoard was extracted to ./ChessBoard.jsx
