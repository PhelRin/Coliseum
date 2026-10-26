import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { EvalBar } from './EvalBar';
import { ChessBoard } from './ChessBoard';
import { Play, Square, Pause, RotateCw, Trash2, Save, Move, Plus, History, Sparkles, Trophy } from 'lucide-react';
import { PieceIcon } from './PieceIcons';
import { EvalGraph } from './EvalGraph';
import { useElementSize } from './live/useLive';
import { CLASSIFICATION_ORDER, getClassification, formatScoreWhite } from '../utils/classifications';

// Convert a UCI PV to SAN for display
const pvToSan = (fen, pv, max = 10) => {
    try {
        const c = new Chess(fen);
        const out = [];
        for (const uci of (Array.isArray(pv) ? pv : String(pv || '').split(' ')).slice(0, max)) {
            if (!uci) break;
            const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
            if (!m) break;
            out.push(m.san);
        }
        return out;
    } catch (e) {
        return [];
    }
};

// Rough strength shown under each accuracy score in the review
const EstimatedElo = ({ estimate }) => {
    if (estimate === undefined) return null; // review made by an older version
    return (
        <div className="mt-2 pt-2 border-t border-white/5" title="Estimated from this game's accuracy. One game is a small sample, so treat it as a rough guide.">
            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Estimated Elo</p>
            {estimate ? (
                <p className="text-base font-bold text-primary font-mono mt-0.5">
                    {estimate.elo}<span className="text-[10px] text-muted-foreground font-normal"> ±{estimate.margin}</span>
                </p>
            ) : (
                <p className="text-[11px] text-muted-foreground mt-0.5">Game too short</p>
            )}
        </div>
    );
};

export function GameAnalysis({ initialPgn, autoAnalyze = false }) {
    const [mode, setMode] = useState('analysis'); // 'analysis' | 'load'
    const [isInitialPgnLoaded, setIsInitialPgnLoaded] = useState(!initialPgn);
    const [boardOrientation, setBoardOrientation] = useState('white');
    const [fen, setFen] = useState(new Chess().fen());
    const [boardAreaRef, boardArea] = useElementSize();
    const boardPx = Math.max(240, Math.floor(Math.min(boardArea.width - 34, boardArea.height || 9999, 680)));
    const [game, setGame] = useState(new Chess());

    // History Navigation
    const [moveIndex, setMoveIndex] = useState(-1); // -1 = start
    const [initialFen, setInitialFen] = useState(new Chess().fen());
    const [pgnHeaders, setPgnHeaders] = useState(null);

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [engines, setEngines] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState(null);
    const [evalInfo, setEvalInfo] = useState(null);

    // In Analysis Mode: Selected square for click-to-move
    const [selectedSquare, setSelectedSquare] = useState(null);

    // Drag-and-drop state
    const [isDragging, setIsDragging] = useState(false);

    // Variations State
    const [variations, setVariations] = useState([
        {
            name: 'Main Line',
            history: []
        }
    ]);
    const [activeVariationIndex, setActiveVariationIndex] = useState(0);

    // Game Review State
    const [activeSidebarTab, setActiveSidebarTab] = useState('log'); // 'log' | 'review'
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewProgress, setReviewProgress] = useState(null);
    const [reviewResults, setReviewResults] = useState(null);
    const [reviewScanSpeed, setReviewScanSpeed] = useState('400'); // ms per position
    const fenRef = useRef(fen);
    useEffect(() => { fenRef.current = fen; }, [fen]);

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.scanEngines().then(found => {
                setEngines(found);
                if (found.length > 0) setSelectedEngine(found[0]);
            });

            const unsubAnalysis = window.electronAPI.on('analysis-update', (info) => {
                // Ignore output that belongs to a position we're no longer showing
                if (info && info.fen && info.fen !== fenRef.current) return;
                setEvalInfo(info);
            });
            return () => {
                if (unsubAnalysis) unsubAnalysis();
                stopAnalysis();
            };
        }
        return () => stopAnalysis();
    }, []);

    // Game Review IPC Listeners
    useEffect(() => {
        if (!window.electronAPI) return;

        const unsubProgress = window.electronAPI.on('game-review-progress', (progress) => {
            setReviewProgress(progress);
        });

        const unsubFinished = window.electronAPI.on('game-review-finished', (results) => {
            setReviewResults(results);
            setIsReviewing(false);
            setReviewProgress(null);
        });

        const unsubError = window.electronAPI.on('game-review-error', (err) => {
            setIsReviewing(false);
            setReviewProgress(null);
            alert("Game Review Error: " + err);
        });

        return () => {
            if (unsubProgress) unsubProgress();
            if (unsubFinished) unsubFinished();
            if (unsubError) unsubError();
        };
    }, []);

    // Keydown for Navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (mode !== 'analysis') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigate(-1);
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigate(1);
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                const newIndex = -1;
                if (newIndex !== moveIndex) {
                    setMoveIndex(newIndex);
                    updateFenFromIndex(newIndex);
                }
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const historyMoves = game.history();
                const newIndex = historyMoves.length - 1;
                if (newIndex !== moveIndex) {
                    setMoveIndex(newIndex);
                    updateFenFromIndex(newIndex);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mode, moveIndex, game, initialFen]);

    // Analysis Update Trigger
    useEffect(() => {
        if (isAnalyzing) {
            updateAnalysis(fen);
        }
    }, [fen]);

    const navigate = (dir) => {
        const historyMoves = game.history();
        let newIndex = moveIndex + dir;

        if (newIndex < -1) newIndex = -1;
        if (newIndex >= historyMoves.length) newIndex = historyMoves.length - 1;

        if (newIndex !== moveIndex) {
            setMoveIndex(newIndex);
            updateFenFromIndex(newIndex);
        }
    };

    const updateFenFromIndex = (idx) => {
        try {
            const temp = new Chess(initialFen);
            const moves = game.history();
            for (let i = 0; i <= idx; i++) {
                temp.move(moves[i]);
            }
            setFen(temp.fen());
        } catch (e) {
            console.error("Nav error", e);
        }
    };

    const updateAnalysis = (currentFen) => {
        setEvalInfo(null);
        if (window.electronAPI) {
            window.electronAPI.send('analysis-update-position', currentFen);
        }
    };

    const toggleAnalysis = async () => {
        if (isAnalyzing) {
            stopAnalysis();
        } else {
            if (selectedEngine && window.electronAPI) {
                setEvalInfo(null);
                await window.electronAPI.invoke('analysis-start', {
                    enginePath: selectedEngine.path,
                    fen: fen,
                    multiPV: 3
                });
                setIsAnalyzing(true);
            }
        }
    };

    const stopAnalysis = () => {
        if (window.electronAPI) window.electronAPI.send('analysis-stop');
        setIsAnalyzing(false);
        setEvalInfo(null);
    };

    const startGameReview = () => {
        if (!selectedEngine) {
            alert("Please select a review engine first.");
            return;
        }
        
        // Stop conflicts
        if (isAnalyzing) {
            stopAnalysis();
        }

        // Reconstruct game PGN of the active variation
        const reviewGame = new Chess(initialFen);
        const activeVar = variations[activeVariationIndex];
        activeVar.history.forEach(m => {
            try {
                reviewGame.move(m);
            } catch (err) {
                console.error("Failed to replay move for review PGN:", err);
            }
        });
        const pgnText = reviewGame.pgn();

        setIsReviewing(true);
        setReviewResults(null);
        setReviewProgress(null);

        if (window.electronAPI) {
            window.electronAPI.send('game-review-start', {
                enginePath: selectedEngine.path,
                pgnText,
                scanSpeed: parseInt(reviewScanSpeed) || 300
            });
        }
    };

    const stopGameReview = () => {
        if (window.electronAPI) {
            window.electronAPI.send('game-review-stop');
        }
        setIsReviewing(false);
        setReviewProgress(null);
    };

    const renderClassificationIcon = (cls) => {
        const meta = getClassification(cls);
        if (!meta) return null;
        return (
            <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-extrabold border shadow-sm ${meta.badge} ml-1.5 shrink-0 select-none cursor-help font-sans`}
                title={meta.label}
            >
                {meta.symbol}
            </span>
        );
    };

    // Review results only apply while the board shows the game that was reviewed
    const currentHistorySan = game.history();
    const reviewMatches = !!reviewResults && (!reviewResults.historySan ||
        reviewResults.historySan.every((san, i) => i >= currentHistorySan.length || currentHistorySan[i] === san));
    const getMoveClass = (ply) => {
        if (!reviewMatches || ply < 0) return null;
        return reviewResults.classifications?.[ply]?.ply === ply
            ? reviewResults.classifications[ply]
            : reviewResults.classifications?.find(c => c.ply === ply) || null;
    };

    const jumpToPly = (ply) => {
        const total = game.history().length;
        const idx = Math.max(-1, Math.min(total - 1, ply));
        setMoveIndex(idx);
        updateFenFromIndex(idx);
    };

    const selectVariation = (idx) => {
        const targetVar = variations[idx];
        const newGame = new Chess(initialFen);
        targetVar.history.forEach(m => {
            try {
                newGame.move(m);
            } catch (err) {
                console.error("Failed to apply move in selectVariation", err);
            }
        });
        setGame(newGame);
        setFen(newGame.fen());
        setMoveIndex(newGame.history().length - 1);
        setActiveVariationIndex(idx);
    };

    const makeMove = (from, to, promotion = 'q') => {
        try {
            const activeVar = variations[activeVariationIndex];
            const tempGame = new Chess(initialFen);
            for (let i = 0; i <= moveIndex; i++) {
                tempGame.move(activeVar.history[i]);
            }
            
            const move = tempGame.move({ from, to, promotion });
            if (!move) return false;
            
            if (moveIndex === activeVar.history.length - 1) {
                // Appending
                const updatedHistory = [...activeVar.history, move.san];
                const updatedVariations = [...variations];
                updatedVariations[activeVariationIndex] = {
                    ...activeVar,
                    history: updatedHistory
                };
                setVariations(updatedVariations);
                
                const nextGame = new Chess(initialFen);
                updatedHistory.forEach(m => nextGame.move(m));
                setGame(nextGame);
                setFen(nextGame.fen());
                setMoveIndex(updatedHistory.length - 1);
            } else {
                // Branching
                const baseHistory = activeVar.history.slice(0, moveIndex + 1);
                const newHistory = [...baseHistory, move.san];
                
                const gameBeforeMove = new Chess(initialFen);
                for (let i = 0; i < baseHistory.length; i++) {
                    gameBeforeMove.move(baseHistory[i]);
                }
                const isWhite = gameBeforeMove.turn() === 'w';
                const fenParts = gameBeforeMove.fen().split(' ');
                const fullmoveNumber = parseInt(fenParts[5]) || 1;
                const moveName = isWhite ? `${fullmoveNumber}. ${move.san}` : `${fullmoveNumber}... ${move.san}`;
                const varName = `Var: ${moveName}`;
                
                const newVar = {
                    name: varName,
                    history: newHistory
                };
                
                const newVariations = [...variations, newVar];
                const newIdx = newVariations.length - 1;
                setVariations(newVariations);
                setActiveVariationIndex(newIdx);
                
                const nextGame = new Chess(initialFen);
                newHistory.forEach(m => nextGame.move(m));
                setGame(nextGame);
                setFen(nextGame.fen());
                setMoveIndex(newHistory.length - 1);
            }
            return true;
        } catch (e) {
            console.error("Make move error:", e);
            return false;
        }
    };

    const handleSquareClick = (square) => {
        if (mode !== 'analysis') return;

        const activeVar = variations[activeVariationIndex];
        const tempGame = new Chess(initialFen);
        for (let i = 0; i <= moveIndex; i++) {
            tempGame.move(activeVar.history[i]);
        }

        if (selectedSquare) {
            const success = makeMove(selectedSquare, square);
            if (success) {
                setSelectedSquare(null);
                return;
            }

            if (selectedSquare === square) {
                setSelectedSquare(null);
            } else {
                const piece = tempGame.get(square);
                if (piece && piece.color === tempGame.turn()) {
                    setSelectedSquare(square);
                } else {
                    setSelectedSquare(null);
                }
            }
        } else {
            const piece = tempGame.get(square);
            if (piece && piece.color === tempGame.turn()) {
                setSelectedSquare(square);
            }
        }
    };

    const handlePieceDrop = (source, target) => {
        if (mode === 'analysis') {
            makeMove(source, target);
        }
    };

    const getSidebarPairs = () => {
        const pairs = [];
        const historyMoves = game.history({ verbose: true });
        for (let i = 0; i < historyMoves.length; i += 2) {
            pairs.push({
                turn: Math.floor(i / 2) + 1,
                white: historyMoves[i],
                whiteIndex: i,
                black: historyMoves[i + 1] || null,
                blackIndex: i + 1
            });
        }
        return pairs;
    };

    const getMoveStyle = (san) => {
        if (!san) return '';
        if (san.includes('!!')) return 'text-teal-400 font-black drop-shadow-[0_0_5px_rgba(45,212,191,0.5)]';
        if (san.includes('??')) return 'text-red-500 font-black drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]';
        if (san.includes('!?') || san.includes('?!')) return 'text-yellow-400 font-bold';
        if (san.includes('!')) return 'text-green-400 font-bold';
        if (san.includes('?')) return 'text-orange-400 font-bold';
        return '';
    };

    const startPos = () => {
        const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        setFen(start);
        setInitialFen(start);
        setGame(new Chess());
        setMoveIndex(-1);
        setPgnHeaders(null);
        setVariations([
            {
                name: 'Main Line',
                history: []
            }
        ]);
        setActiveVariationIndex(0);
    };

    const loadGameFromString = (input) => {
        if (!input) return;

        const tempGame = new Chess();

        // Try PGN
        try {
            tempGame.loadPgn(input);
            setGame(tempGame);
            setFen(tempGame.fen());

            const headers = tempGame.header();
            if (headers && Object.keys(headers).length > 0) {
                setPgnHeaders(headers);
            } else {
                setPgnHeaders(null);
            }
            const initFen = headers['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            setInitialFen(initFen);

            setVariations([
                {
                    name: 'Main Line',
                    history: tempGame.history()
                }
            ]);
            setActiveVariationIndex(0);

            setMoveIndex(tempGame.history().length - 1);
            setMode('analysis');
            setIsInitialPgnLoaded(true);
            return;
        } catch (e) { }

        // Try FEN
        try {
            tempGame.load(input);
            setGame(tempGame);
            setFen(tempGame.fen());
            setInitialFen(input);

            setVariations([
                {
                    name: 'Main Line',
                    history: []
                }
            ]);
            setActiveVariationIndex(0);

            setMoveIndex(-1);
            setPgnHeaders(null);
            setMode('analysis');
            setIsInitialPgnLoaded(true);
            return;
        } catch (e) {
            alert("Invalid FEN or PGN");
        }
    };

    useEffect(() => {
        if (initialPgn) {
            setTimeout(() => {
                loadGameFromString(initialPgn);
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialPgn]);

    const hasAutoAnalyzedRef = useRef(false);

    useEffect(() => {
        if (autoAnalyze && isInitialPgnLoaded && selectedEngine && fen && !hasAutoAnalyzedRef.current) {
            hasAutoAnalyzedRef.current = true;
            window.electronAPI.invoke('analysis-start', {
                enginePath: selectedEngine.path,
                fen: fen,
                multiPV: 3
            }).then(() => {
                setIsAnalyzing(true);
            }).catch(err => {
                console.error("Failed to start auto-analysis:", err);
            });
        }
    }, [autoAnalyze, isInitialPgnLoaded, selectedEngine, fen]);

    const handleLoad = () => {
        const input = document.getElementById('fen-pgn-input').value.trim();
        loadGameFromString(input);
    };

    // --- Drag and Drop Handlers ---
    const handleDragOver = (e) => {
        if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.pgn') || file.name.endsWith('.txt'))) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const content = event.target.result;
                    loadGameFromString(content);
                };
                reader.readAsText(file);
            } else if (file) {
                alert("Please drop a .pgn or .txt file.");
            }
        }
    };

    return (
        <div
            className={`grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_360px] gap-4 xl:gap-6 h-full p-0 xl:p-2 relative transition-colors overflow-y-auto xl:overflow-hidden ${isDragging ? 'bg-primary/5' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-x-4 inset-y-4 border-2 border-dashed border-primary rounded-2xl flex items-center justify-center bg-primary/10 z-50 pointer-events-none backdrop-blur-sm">
                    <div className="font-bold text-2xl text-primary animate-pulse flex flex-col items-center gap-4">
                        <Save size={48} />
                        Drop PGN to Load Game
                    </div>
                </div>
            )}

            {/* LEFT: Sidebar / Setup / Palette */}
            <div className="w-full min-w-0 flex flex-col gap-4 xl:overflow-y-auto hidden-scrollbar pb-4 xl:pb-10">
                <div className="bg-card border border-white/5 rounded-2xl p-4 flex flex-col gap-2">
                    <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                        <Move size={18} className="text-primary" /> Analysis Tools
                    </h3>

                    {/* Modes */}
                    <div className="grid grid-cols-1 gap-2 mb-4">
                        <button
                            onClick={() => { setMode('analysis'); }}
                            className={`p-3 rounded-xl flex items-center justify-between transition-all ${mode === 'analysis' ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-black/20 hover:bg-white/5 border border-transparent'}`}
                        >
                            <span className="font-medium">Analysis Board</span>
                            <Play size={16} />
                        </button>
                        <button
                            onClick={() => { setMode('load'); stopAnalysis(); }}
                            className={`p-3 rounded-xl flex items-center justify-between transition-all ${mode === 'load' ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-black/20 hover:bg-white/5 border border-transparent'}`}
                        >
                            <span className="font-medium">Load FEN / PGN</span>
                            <Save size={16} />
                        </button>
                    </div>

                    {mode === 'analysis' && (
                        <div className="space-y-4 animate-fade-in">
                            <div>
                                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Engine</label>
                                <select
                                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none"
                                    value={selectedEngine?.path || ''}
                                    onChange={(e) => setSelectedEngine(engines.find(eng => eng.path === e.target.value))}
                                >
                                    {engines.map(eng => <option key={eng.path} value={eng.path}>{eng.name}</option>)}
                                </select>
                            </div>

                            <button
                                onClick={toggleAnalysis}
                                className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${isAnalyzing ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-primary text-black hover:brightness-110'}`}
                            >
                                {isAnalyzing ? <><Pause size={20} /> Stop Analysis</> : <><Play size={20} /> Start Analysis</>}
                            </button>

                            {/* Evaluation Output */}
                            {isAnalyzing && (() => {
                                const stm = fen.split(' ')[1];
                                const live = evalInfo && (!evalInfo.fen || evalInfo.fen === fen) ? evalInfo : null;
                                const lines = live?.lines?.length ? live.lines : (live?.score ? [{ multipv: 1, score: live.score, pv: live.pv, depth: live.depth }] : []);
                                return (
                                    <div className="bg-black/40 rounded-xl p-3 border border-white/5 font-mono text-xs space-y-2">
                                        <div className="flex justify-between items-center text-primary">
                                            <span>Depth {live?.depth || 0}</span>
                                            <span className="font-bold text-lg">{live?.score ? formatScoreWhite(live.score, stm) : '…'}</span>
                                        </div>
                                        {lines.length === 0 && <div className="text-muted-foreground">Calculating...</div>}
                                        {lines.map((l, i) => {
                                            const san = pvToSan(fen, l.pv, 8);
                                            return (
                                                <div key={l.multipv || i} className="flex gap-2 items-start border-t border-white/5 pt-1.5">
                                                    <span className={`shrink-0 w-14 text-right font-bold ${i === 0 ? 'text-primary' : 'text-white/80'}`}>{formatScoreWhite(l.score, stm)}</span>
                                                    <span className="text-muted-foreground break-words leading-relaxed font-sans">{san.join(' ')}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-xs text-muted-foreground">
                                <p className="mb-2 font-bold text-white">Controls</p>
                                <ul className="list-disc pl-4 space-y-1">
                                    <li>Click pieces to move</li>
                                    <li>Arrow <span className="text-white">Left/Right</span> to navigate history</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {mode === 'load' && (
                        <div className="animate-fade-in space-y-4">
                            <div>
                                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Paste FEN or PGN</label>
                                <textarea
                                    id="fen-pgn-input"
                                    className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-3 text-xs focus:border-primary outline-none resize-none font-mono"
                                    placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                                />
                            </div>

                            <div className="flex gap-2">
                                <button onClick={handleLoad} className="flex-1 py-2 bg-primary text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm">
                                    Load Position
                                </button>
                                <button onClick={startPos} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all text-sm">
                                    Reset
                                </button>
                            </div>

                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
                                ℹ️ Pasting a PGN game will let you replay it move by move.
                            </div>
                        </div>
                    )}
                </div>

                {mode === 'analysis' && variations.length > 1 && (
                    <div className="bg-card border border-white/5 rounded-2xl p-4 flex flex-col gap-2 animate-fade-in shadow-xl">
                        <h3 className="font-bold text-sm mb-1 flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                            <History size={16} className="text-primary" /> Explored Lines
                        </h3>
                        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto hidden-scrollbar">
                            {variations.map((v, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => selectVariation(idx)}
                                    className={`p-2.5 rounded-xl text-left text-xs transition-all flex items-center justify-between border ${
                                        activeVariationIndex === idx
                                            ? 'bg-primary/10 text-primary border-primary/30 font-semibold'
                                            : 'bg-black/20 hover:bg-white/5 border-transparent text-foreground/80'
                                    }`}
                                >
                                    <span className="truncate mr-2">{v.name}</span>
                                    {activeVariationIndex === idx && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* MIDDLE: Board */}
            <div className="min-w-0 flex flex-col justify-center items-center relative min-h-[360px] md:h-[calc(100vh-150px)] xl:h-auto xl:min-h-0">
                {pgnHeaders && Object.keys(pgnHeaders).length > 0 && (
                    <div className="w-full max-w-[650px] bg-card border border-white/5 rounded-xl p-4 mb-4 flex justify-between items-center gap-3 shadow-lg transition-all">
                        <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-white font-bold text-lg flex flex-wrap items-center gap-x-2">
                                {pgnHeaders.White || 'White'} {pgnHeaders.WhiteElo ? <span className="text-muted-foreground font-normal text-sm">({pgnHeaders.WhiteElo})</span> : ''}
                                <span className="text-primary/50 font-normal mx-2 text-sm italic">vs</span>
                                {pgnHeaders.Black || 'Black'} {pgnHeaders.BlackElo ? <span className="text-muted-foreground font-normal text-sm">({pgnHeaders.BlackElo})</span> : ''}
                            </span>
                            <span className="text-muted-foreground/70 text-xs flex items-center gap-2 font-medium">
                                {pgnHeaders.Event ? <span>{pgnHeaders.Event}</span> : ''}
                                {pgnHeaders.Date ? <><span className="w-1 h-1 rounded-full bg-white/20"></span><span>{pgnHeaders.Date}</span></> : ''}
                            </span>
                        </div>
                        {pgnHeaders.Result && pgnHeaders.Result !== '*' && (
                            <div className="text-sm font-black text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg shadow-[0_0_10px_hsl(var(--primary)/0.1)] whitespace-nowrap shrink-0">
                                {pgnHeaders.Result}
                            </div>
                        )}
                    </div>
                )}
                <div className="flex flex-col gap-4 items-center justify-center flex-1 max-h-[690px] min-h-0 w-full">
                    <div ref={boardAreaRef} className="flex gap-3 items-center justify-center w-full min-w-0 flex-1 max-h-[690px] min-h-0">
                        <div className="flex gap-3 items-stretch" style={{ height: boardPx }}>
                        {(() => {
                            const live = evalInfo && (!evalInfo.fen || evalInfo.fen === fen) ? evalInfo : null;
                            if (live) return <EvalBar score={live.score} turn={fen.split(' ')[1]} orientation={boardOrientation} />;
                            // Fall back to the Game Review evaluation of this position
                            const pt = reviewMatches ? reviewResults.evalSeries?.[moveIndex + 1] : null;
                            const reviewScore = pt ? (pt.mate !== null && pt.mate !== undefined
                                ? (pt.mate === 0 ? { unit: 'mate', value: pt.win >= 50 ? '1' : '-1' } : { unit: 'mate', value: String(pt.mate) })
                                : { unit: 'cp', value: String(pt.cp || 0) }) : null;
                            return <EvalBar score={reviewScore} turn="w" orientation={boardOrientation} />;
                        })()}
                        {(() => {
                            const moves = game.history({ verbose: true });
                            const currentMove = moveIndex >= 0 && moveIndex < moves.length ? moves[moveIndex] : null;
                            const currentLastMove = currentMove ? (currentMove.from + currentMove.to) : null;
                            const currentMoveClass = getMoveClass(moveIndex);
                            const classification = currentMoveClass?.classification || null;
                            const boardArrows = [];
                            const live = evalInfo && (!evalInfo.fen || evalInfo.fen === fen) ? evalInfo : null;
                            const livePv = live?.pv ? (Array.isArray(live.pv) ? live.pv : live.pv.split(' ')) : [];
                            if (livePv[0]) {
                                boardArrows.push({ from: livePv[0].substring(0, 2), to: livePv[0].substring(2, 4), color: 'hsl(var(--primary) / 0.8)' });
                            }
                            // Show what should have been played instead of a weak move
                            if (currentMoveClass?.bestMove && !['best', 'book', 'forced', 'brilliant', 'great'].includes(classification)) {
                                const b = currentMoveClass.bestMove;
                                boardArrows.push({ from: b.substring(0, 2), to: b.substring(2, 4), color: 'rgba(56, 189, 248, 0.75)' });
                            }

                            return (
                                <div style={{ width: boardPx, height: boardPx }}>
                                <ChessBoard
                                    fen={fen}
                                    lastMove={currentLastMove}
                                    lastMoveClassification={classification}
                                    orientation={boardOrientation}
                                    size={`${boardPx}px`}
                                    thinFrame={boardPx < 420}
                                    allowDrag={false}
                                    interactive={mode === 'analysis'}
                                    onSquareClick={handleSquareClick}
                                    onPieceDrop={handlePieceDrop}
                                    arrows={boardArrows}
                                />
                                </div>
                            );
                        })()}
                        </div>
                    </div>
                    <button
                        onClick={() => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white')}
                        className="px-5 py-2.5 bg-card hover:bg-accent border border-white/5 text-foreground rounded-xl transition-all flex items-center gap-2 text-xs font-bold shadow-md cursor-pointer hover:scale-[1.02]"
                    >
                        <RotateCw size={14} className="text-primary" /> Flip Board
                    </button>
                </div>
                
                {/* Move Classification Banner */}
                {(() => {
                    const c = getMoveClass(moveIndex);
                    if (!c) return null;
                    const meta = getClassification(c.classification);
                    if (!meta) return null;
                    const showBest = c.bestMoveSan && !['best', 'book', 'forced', 'brilliant', 'great'].includes(c.classification);
                    return (
                        <div className={`mt-4 p-4 rounded-xl border flex items-center justify-between gap-4 animate-fade-in w-full max-w-[650px] ${meta.panel}`}>
                            <div className="flex items-center gap-3 min-w-0">
                                {renderClassificationIcon(c.classification)}
                                <div className="min-w-0">
                                    <p className="text-sm font-extrabold tracking-wide">
                                        {c.san} is {['a', 'e', 'i', 'o', 'u'].includes(meta.label[0].toLowerCase()) ? 'an' : 'a'} {meta.label.toLowerCase()} move
                                        {c.mateMissed ? <span className="font-semibold"> — missed mate in {c.mateMissed}</span> : null}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {meta.blurb}
                                        {showBest && <> Best was <span className="text-white font-bold">{c.bestMoveSan}</span>{c.bestLineSan?.length > 1 && <span className="font-mono"> ({c.bestLineSan.slice(0, 5).join(' ')})</span>}.</>}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                                <span className="text-xs font-mono bg-black/40 px-2.5 py-1 rounded-md border border-white/5 font-extrabold text-white">
                                    {Math.round(c.accuracy)}% acc
                                </span>
                                {c.winLoss > 0 && (
                                    <span className="text-[10px] font-mono text-muted-foreground">−{c.winLoss}% win chance</span>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* RIGHT: Move History / Game Review Sidebar */}
            {mode === 'analysis' && (
                <div className="w-full min-w-0 md:col-span-2 xl:col-span-1 flex flex-col gap-4 xl:border-l xl:border-t-0 border-t border-white/5 xl:pl-4 xl:pt-0 pt-4 xl:overflow-hidden pb-10">
                    
                    {/* Tab Navigation */}
                    <div className="flex bg-black/40 p-1 border border-white/5 rounded-xl shrink-0">
                        <button
                            onClick={() => setActiveSidebarTab('log')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                activeSidebarTab === 'log' 
                                    ? 'bg-primary text-black shadow-md font-bold' 
                                    : 'text-muted-foreground hover:text-white'
                            }`}
                        >
                            <History size={14} /> Move Log
                        </button>
                        <button
                            onClick={() => setActiveSidebarTab('review')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                activeSidebarTab === 'review' 
                                    ? 'bg-primary text-black shadow-md font-bold' 
                                    : 'text-muted-foreground hover:text-white'
                            }`}
                        >
                            <Sparkles size={14} /> Game Review
                        </button>
                    </div>

                    {activeSidebarTab === 'log' ? (
                        <div className="flex-1 flex flex-col min-h-0">
                            <div className="flex items-center justify-between mb-2 shrink-0">
                                <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <History size={16} className="text-primary" /> Move List
                                </h3>
                            </div>
                            
                            {game.history().length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground border border-dashed border-white/5 rounded-2xl bg-black/10">
                                    <Move size={32} className="opacity-20 mb-2" />
                                    <p className="text-xs font-semibold">No moves played yet</p>
                                    <p className="text-[10px] opacity-70 mt-0.5">Move pieces on the board or load a game to begin.</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto hidden-scrollbar pr-1 border border-white/5 bg-black/25 rounded-2xl p-2 min-h-0">
                                    <div className="flex flex-col gap-0.5">
                                        {getSidebarPairs().map((pair) => {
                                            const whiteClass = getMoveClass(pair.whiteIndex);
                                            const blackClass = getMoveClass(pair.blackIndex);
                                            
                                            return (
                                                <div key={pair.turn} className="flex text-sm border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] rounded transition-colors group">
                                                    <div className="w-12 py-1.5 px-2 text-muted-foreground/60 font-mono text-xs flex items-center justify-center bg-black/20 shrink-0">
                                                        {pair.turn}.
                                                    </div>
                                                    <div
                                                        className={`flex-1 py-1.5 px-3 cursor-pointer transition-colors border-r border-white/5 flex items-center justify-between min-w-0 ${moveIndex === pair.whiteIndex ? 'bg-primary/20 text-primary font-bold shadow-[inset_2px_0_0_currentColor]' : 'hover:bg-white/10 text-foreground'}`}
                                                        onClick={() => { setMoveIndex(pair.whiteIndex); updateFenFromIndex(pair.whiteIndex); }}
                                                    >
                                                        <span className={`${getMoveStyle(pair.white.san)} text-sm font-semibold truncate`}>
                                                            {pair.white.san}
                                                        </span>
                                                        {whiteClass && renderClassificationIcon(whiteClass.classification)}
                                                    </div>
                                                    <div
                                                        className={`flex-1 py-1.5 px-3 cursor-pointer transition-colors flex items-center justify-between min-w-0 ${!pair.black ? '' : moveIndex === pair.blackIndex ? 'bg-primary/20 text-primary font-bold shadow-[inset_2px_0_0_currentColor]' : 'hover:bg-white/10 text-foreground'}`}
                                                        onClick={() => pair.black && (() => { setMoveIndex(pair.blackIndex); updateFenFromIndex(pair.blackIndex); })()}
                                                    >
                                                        <span className={`${pair.black ? getMoveStyle(pair.black.san) : ''} text-sm font-semibold truncate`}>
                                                            {pair.black ? pair.black.san : ''}
                                                        </span>
                                                        {pair.black && blackClass && renderClassificationIcon(blackClass.classification)}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            {isReviewing ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-black/20 border border-white/5 rounded-2xl">
                                    <RotateCw size={32} className="animate-spin text-primary mb-4" />
                                    <h4 className="font-bold text-base text-white mb-2">Analyzing Positions...</h4>
                                    <p className="text-xs text-muted-foreground max-w-xs mb-4">
                                        Evaluating board states using {selectedEngine?.name || 'engine'}. This might take a few seconds.
                                    </p>
                                    {reviewProgress && (
                                        <div className="w-full max-w-[200px]">
                                            <div className="flex justify-between text-[10px] text-muted-foreground font-mono mb-1">
                                                <span>Progress</span>
                                                <span>{reviewProgress.percent}%</span>
                                            </div>
                                            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5 animate-pulse">
                                                <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${reviewProgress.percent}%` }} />
                                            </div>
                                            <span className="text-[10px] text-muted-foreground mt-2 block">
                                                Move {Math.floor(reviewProgress.currentIndex / 2)} of {Math.floor(reviewProgress.totalPositions / 2)}
                                            </span>
                                        </div>
                                    )}
                                    <button 
                                        onClick={stopGameReview}
                                        className="mt-6 px-4 py-2 bg-red-500/25 border border-red-500/40 text-red-400 text-xs font-bold rounded-xl hover:bg-red-500/30 transition-all"
                                    >
                                        Cancel Review
                                    </button>
                                </div>
                            ) : reviewResults ? (
                                <div className="flex-1 flex flex-col gap-4 overflow-y-auto hidden-scrollbar min-h-0 pt-2">
                                    {!reviewMatches && (
                                        <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-[11px] rounded-xl p-3 shrink-0">
                                            The board no longer matches the reviewed game. Switch back to the reviewed line or run the review again.
                                        </div>
                                    )}
                                    {/* Accuracy Cards */}
                                    <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-3 shrink-0">
                                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Game Accuracy</span>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-gradient-to-br from-zinc-800 to-zinc-950 border border-white/5 rounded-xl p-3.5 text-center shadow-inner">
                                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider truncate">{pgnHeaders?.White || 'White'}</p>
                                                <p className="text-3xl font-extrabold text-white mt-1 font-mono tracking-tight">{reviewResults.whiteAccuracy}</p>
                                                {reviewResults.whiteAcpl !== undefined && <p className="text-[10px] text-muted-foreground font-mono mt-1">ACPL {reviewResults.whiteAcpl}</p>}
                                                <EstimatedElo estimate={reviewResults.whiteEstimate} />
                                            </div>
                                            <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/5 rounded-xl p-3.5 text-center shadow-inner">
                                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider truncate">{pgnHeaders?.Black || 'Black'}</p>
                                                <p className="text-3xl font-extrabold text-zinc-300 mt-1 font-mono tracking-tight">{reviewResults.blackAccuracy}</p>
                                                {reviewResults.blackAcpl !== undefined && <p className="text-[10px] text-muted-foreground font-mono mt-1">ACPL {reviewResults.blackAcpl}</p>}
                                                <EstimatedElo estimate={reviewResults.blackEstimate} />
                                            </div>
                                        </div>
                                        {reviewResults.evalSeries?.length > 1 && (
                                            <div className="mt-2">
                                                <EvalGraph
                                                    series={reviewResults.evalSeries}
                                                    classifications={reviewMatches ? reviewResults.classifications : []}
                                                    currentPly={moveIndex}
                                                    onSelectPly={(ply) => reviewMatches && jumpToPly(ply)}
                                                />
                                                <p className="text-[9px] text-muted-foreground/70 mt-1 text-center">Click the graph to jump to a move</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Key moments */}
                                    {reviewMatches && (() => {
                                        const key = reviewResults.classifications.filter(c => ['brilliant', 'great', 'miss', 'mistake', 'blunder'].includes(c.classification));
                                        if (key.length === 0) return null;
                                        return (
                                            <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-2 shrink-0">
                                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Key Moments</span>
                                                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto hidden-scrollbar">
                                                    {key.map(c => {
                                                        const meta = getClassification(c.classification);
                                                        return (
                                                            <button
                                                                key={c.ply}
                                                                onClick={() => jumpToPly(c.ply)}
                                                                className={`flex items-center justify-between gap-2 p-2 rounded-lg text-left text-xs border transition-colors ${moveIndex === c.ply ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:bg-white/5'}`}
                                                            >
                                                                <span className="flex items-center gap-1.5 min-w-0">
                                                                    {renderClassificationIcon(c.classification)}
                                                                    <span className="font-mono text-muted-foreground shrink-0">{Math.floor(c.ply / 2) + 1}{c.color === 'w' ? '.' : '...'}</span>
                                                                    <span className={`font-bold ${meta.text}`}>{c.san}</span>
                                                                </span>
                                                                {c.bestMoveSan && !['brilliant', 'great'].includes(c.classification) && (
                                                                    <span className="text-[10px] text-muted-foreground truncate">best {c.bestMoveSan}</span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Move Classification Counts */}
                                    <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-3 shrink-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Move Classifications</span>
                                            <span className="flex gap-4 font-mono text-[10px] text-muted-foreground"><span className="w-6 text-center">W</span><span className="w-6 text-center">B</span></span>
                                        </div>
                                        <div className="space-y-1">
                                            {CLASSIFICATION_ORDER.map(key => {
                                                const meta = getClassification(key);
                                                const wCount = reviewResults.stats.white[key] || 0;
                                                const bCount = reviewResults.stats.black[key] || 0;
                                                if (wCount === 0 && bCount === 0) return null;
                                                return (
                                                    <div key={key} className="flex items-center justify-between p-1.5 hover:bg-white/5 rounded-lg transition-colors" title={meta.blurb}>
                                                        <div className="flex items-center gap-2">
                                                            {renderClassificationIcon(key)}
                                                            <span className={`text-xs font-bold ${meta.text}`}>{meta.label}</span>
                                                        </div>
                                                        <div className="flex gap-4 font-mono text-xs font-bold">
                                                            <span className="text-white w-6 text-center">{wCount}</span>
                                                            <span className="text-zinc-500 w-6 text-center">{bCount}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {reviewResults.usedBooks === false && (
                                            <p className="text-[10px] text-muted-foreground/70">No opening books found — book moves are estimated.</p>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t border-white/5 mt-auto shrink-0">
                                            <button
                                                onClick={startGameReview}
                                                className="flex-1 py-2.5 bg-primary text-black font-extrabold rounded-xl hover:brightness-110 text-xs transition-all flex items-center justify-center gap-1.5 shadow"
                                            >
                                                <RotateCw size={14} /> Review Again
                                            </button>
                                            <button
                                                onClick={() => setReviewResults(null)}
                                                className="px-3.5 py-2.5 bg-white/5 border border-white/5 text-muted-foreground hover:text-white rounded-xl text-xs transition-all font-semibold"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col gap-4 bg-black/20 border border-white/5 rounded-2xl p-5 justify-between">
                                    <div className="flex flex-col gap-4">
                                        <div className="text-center py-6 flex flex-col items-center gap-3">
                                            <Trophy size={40} className="text-primary/45 animate-pulse" />
                                            <h4 className="font-extrabold text-base text-white">Unlock Game Review</h4>
                                            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                                                Evaluate every move of the game: accuracy, an evaluation graph, key moments and a move-by-move breakdown with the best alternatives.
                                            </p>
                                        </div>

                                        <div className="space-y-4 pt-2 border-t border-white/5">
                                            <div>
                                                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-2 block">Review Engine</label>
                                                <select
                                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs focus:border-primary outline-none text-white font-medium"
                                                    value={selectedEngine?.path || ''}
                                                    onChange={(e) => setSelectedEngine(engines.find(eng => eng.path === e.target.value))}
                                                >
                                                    {engines.map(eng => <option key={eng.path} value={eng.path}>{eng.name}</option>)}
                                                </select>
                                            </div>

                                            <div>
                                                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider mb-2 block">Review Speed</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {[
                                                        { label: 'Quick', val: '150', note: '0.15s / move' },
                                                        { label: 'Standard', val: '400', note: '0.4s / move' },
                                                        { label: 'Deep', val: '1000', note: '1s / move' }
                                                    ].map(spd => (
                                                        <button
                                                            key={spd.val}
                                                            type="button"
                                                            onClick={() => setReviewScanSpeed(spd.val)}
                                                            className={`flex flex-col items-center justify-center p-2 rounded-xl border text-[11px] transition-all ${reviewScanSpeed === spd.val ? 'bg-primary/10 border-primary text-primary font-bold shadow' : 'bg-black/20 border-white/5 hover:bg-white/5 text-muted-foreground'}`}
                                                        >
                                                            <span>{spd.label}</span>
                                                            <span className="text-[9px] opacity-60 font-mono mt-0.5">{spd.note}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <button 
                                        onClick={startGameReview}
                                        disabled={game.history().length === 0 || !selectedEngine}
                                        className={`w-full py-4 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all shadow-lg ${
                                            game.history().length > 0 && selectedEngine
                                                ? 'bg-primary text-black hover:brightness-110 shadow-primary/20 cursor-pointer animate-pulse' 
                                                : 'bg-zinc-800 text-muted-foreground border border-white/5 cursor-not-allowed'
                                        }`}
                                    >
                                        <Sparkles size={16} /> Run Game Review
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
