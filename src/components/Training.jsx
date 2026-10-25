import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './EvalBar';
import { 
    Zap, 
    BookOpen, 
    Play, 
    Pause, 
    Trash2, 
    CheckCircle, 
    AlertCircle, 
    HelpCircle, 
    ArrowRight, 
    RefreshCw, 
    Search, 
    Sliders, 
    Sparkles, 
    Trophy,
    Plus,
    X,
    FileText,
    Upload,
    Copy
} from 'lucide-react';

export default function Training({ onAnalyzePosition }) {
    const [activeSubTab, setActiveSubTab] = useState('library'); // 'generator' | 'library'

    // Engine options
    const [engines, setEngines] = useState([]);
    const [selectedEngine, setSelectedEngine] = useState(null);

    // Generator settings
    const [scanSpeed, setScanSpeed] = useState('300'); // '100' | '300' | '800'
    const [types, setTypes] = useState({
        mate: true,
        blunder: true,
        better_move: true
    });
    const [mateRange, setMateRange] = useState({
        m1: true,
        m2: true,
        m3: true,
        mx: true
    });
    const [targetSide, setTargetSide] = useState('both'); // 'both' | 'white' | 'black'
    const [maxMoves, setMaxMoves] = useState('5');
    const [sensitivity, setSensitivity] = useState('balanced'); // 'strict' | 'balanced' | 'relaxed'
    const lastLoggedGameRef = useRef(0);

    // PGN Data
    const [pgnContent, setPgnContent] = useState('');
    const [pgnFileName, setPgnFileName] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);

    // Scan State
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);
    const [scanResults, setScanResults] = useState([]); // Puzzles found in current scan
    const [scanLogs, setScanLogs] = useState([]);

    // Scan stats and refs for Speed & ETA
    const scanStartTime = useRef(null);
    const positionsScanned = useRef(0);
    const [scanEta, setScanEta] = useState(null);
    const [scanSpeedPps, setScanSpeedPps] = useState(null);

    // Library State
    const [library, setLibrary] = useState([]);
    const [libraryFilter, setLibraryFilter] = useState('all'); // 'all' | 'mate' | 'blunder' | 'better_move'
    const [librarySearch, setLibrarySearch] = useState('');
    const [selectedPuzzle, setSelectedPuzzle] = useState(null);

    // Solver Board State
    const [boardFen, setBoardFen] = useState('');
    const [solutionIndex, setSolutionIndex] = useState(0);
    const [solveStatus, setSolveStatus] = useState('idle'); // 'idle' | 'wrong' | 'correct' | 'solved'
    const [showSolution, setShowSolution] = useState(false);
    const [copied, setCopied] = useState(false);

    // Load Engines and Library on mount
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.scanEngines().then(found => {
                setEngines(found);
                if (found.length > 0) setSelectedEngine(found[0]);
            });

            window.electronAPI.getStore('puzzlesLibrary').then(saved => {
                const lib = saved || [];
                setLibrary(lib);
                if (lib.length > 0) {
                    selectPuzzle(lib[0]);
                }
            });
        }
    }, []);

    // Hook up scan progress listeners
    useEffect(() => {
        if (!window.electronAPI) return;

        const unsubscribeProgress = window.electronAPI.on('puzzle-gen-progress', (progress) => {
            setScanProgress(progress);
            if (progress.gameIndex && progress.gameIndex !== lastLoggedGameRef.current) {
                lastLoggedGameRef.current = progress.gameIndex;
                addLog(`Analysing game ${progress.gameIndex} of ${progress.totalGames}${progress.gameLabel ? ` (${progress.gameLabel})` : ''} — ${progress.totalPlies} positions...`);
            }
            
            // Calculate real-time speed and ETA
            if (scanStartTime.current) {
                positionsScanned.current += 1;
                const elapsedMs = Date.now() - scanStartTime.current;
                const elapsedSec = elapsedMs / 1000;
                
                const pps = elapsedSec > 0 ? (positionsScanned.current / elapsedSec).toFixed(1) : '0.0';
                setScanSpeedPps(pps);

                const progressFraction = progress.percent / 100;
                if (progressFraction > 0.02) {
                    const totalEstMs = elapsedMs / progressFraction;
                    const remainingMs = totalEstMs - elapsedMs;
                    
                    const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
                    const mins = Math.floor(remainingSec / 60);
                    const secs = remainingSec % 60;
                    setScanEta(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
                } else {
                    setScanEta('Calculating...');
                }
            }
        });

        const unsubscribeDetected = window.electronAPI.on('puzzle-gen-detected', (puzzle) => {
            setScanResults(prev => [puzzle, ...prev]);
            addLog(`Puzzle detected: ${puzzle.title} (${puzzle.gameDetails.white} vs ${puzzle.gameDetails.black})`);
        });

        const unsubscribeFinished = window.electronAPI.on('puzzle-gen-finished', (data) => {
            setIsScanning(false);
            setScanProgress(null);
            setScanEta(null);
            setScanSpeedPps(null);
            addLog(`Scan completed. Found ${data.puzzlesFound} puzzles.`);
        });

        const unsubscribeError = window.electronAPI.on('puzzle-gen-error', (errStr) => {
            setIsScanning(false);
            setScanProgress(null);
            setScanEta(null);
            setScanSpeedPps(null);
            addLog(`Scan Error: ${errStr}`);
            alert(`Scan Error: ${errStr}`);
        });

        return () => {
            if (unsubscribeProgress) unsubscribeProgress();
            if (unsubscribeDetected) unsubscribeDetected();
            if (unsubscribeFinished) unsubscribeFinished();
            if (unsubscribeError) unsubscribeError();
        };
    }, []);

    const addLog = (msg) => {
        setScanLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
    };

    // Library operations
    const saveLibrary = async (newLib) => {
        setLibrary(newLib);
        if (window.electronAPI) {
            await window.electronAPI.setStore('puzzlesLibrary', newLib);
        }
    };

    const addToLibrary = (puzzle) => {
        // Avoid duplicate ID
        if (library.some(p => p.id === puzzle.id || p.fen === puzzle.fen)) {
            alert("This puzzle is already in your library.");
            return;
        }
        const updated = [puzzle, ...library];
        saveLibrary(updated);
        
        // If nothing was selected before, select this one
        if (!selectedPuzzle) {
            selectPuzzle(puzzle);
        }
    };

    const addAllToLibrary = () => {
        if (scanResults.length === 0) return;
        let addedCount = 0;
        let updated = [...library];
        
        scanResults.forEach(puzzle => {
            if (!updated.some(p => p.id === puzzle.id || p.fen === puzzle.fen)) {
                updated = [puzzle, ...updated];
                addedCount++;
            }
        });

        saveLibrary(updated);
        alert(`Added ${addedCount} puzzles to your Library!`);
        if (updated.length > 0 && !selectedPuzzle) {
            selectPuzzle(updated[0]);
        }
    };

    const deleteFromLibrary = (puzzleId) => {
        const filtered = getFilteredLibrary();
        const indexInFiltered = filtered.findIndex(p => p.id === puzzleId);
        
        let nextSelectedPuzzle = null;
        if (indexInFiltered !== -1 && filtered.length > 1) {
            if (indexInFiltered < filtered.length - 1) {
                nextSelectedPuzzle = filtered[indexInFiltered + 1];
            } else {
                nextSelectedPuzzle = filtered[indexInFiltered - 1];
            }
        }

        const updated = library.filter(p => p.id !== puzzleId);
        saveLibrary(updated);

        if (selectedPuzzle?.id === puzzleId) {
            if (nextSelectedPuzzle) {
                selectPuzzle(nextSelectedPuzzle);
            } else {
                setSelectedPuzzle(null);
                setBoardFen('');
            }
        }
    };

    const deleteAllPuzzles = () => {
        const confirmed = window.confirm("Are you sure you want to delete all puzzles in your library? This action cannot be undone.");
        if (confirmed) {
            saveLibrary([]);
            setSelectedPuzzle(null);
            setBoardFen('');
        }
    };


    // ------------------------------------------------------------------
    // Solver logic
    // ------------------------------------------------------------------
    // A puzzle attempt keeps its own "expected line" (starts as the stored
    // solution). If the player finds a different move that the engine confirms
    // is equally decisive (e.g. another forced mate), the line is re-written from
    // the engine's analysis and the puzzle continues from there.
    const puzzleTokenRef = useRef(0);
    const attemptRef = useRef({ mistakes: 0, usedHint: false, usedSolution: false, recorded: false });
    const [expectedLine, setExpectedLine] = useState([]);
    const [boardLastMove, setBoardLastMove] = useState(null);
    const [isSettingUp, setIsSettingUp] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [hintText, setHintText] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [streak, setStreak] = useState(0);
    const libraryRef = useRef([]);
    useEffect(() => { libraryRef.current = library; }, [library]);

    const selectedEngineRef = useRef(null);
    useEffect(() => { selectedEngineRef.current = selectedEngine; }, [selectedEngine]);

    // Shut the trainer's helper engine down when leaving the Tactics tab
    useEffect(() => () => {
        if (window.electronAPI) window.electronAPI.send('puzzle-engine-stop');
    }, []);

    const engineEval = async (fen, movetime = 600) => {
        const eng = selectedEngineRef.current;
        if (!eng || !window.electronAPI) return null;
        try {
            return await window.electronAPI.invoke('puzzle-engine-eval', { enginePath: eng.path, fen, movetime });
        } catch (e) {
            return null;
        }
    };

    const winPct = (score) => {
        if (!score) return 50;
        const v = parseInt(score.value, 10) || 0;
        if (score.unit === 'mate') return v > 0 ? 100 : 0;
        const cp = Math.max(-1000, Math.min(1000, v));
        return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    };

    const applyUci = (chess, uci) => {
        try {
            return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
        } catch (e) {
            return null;
        }
    };

    const selectPuzzle = (puzzle) => {
        const token = ++puzzleTokenRef.current;
        attemptRef.current = { mistakes: 0, usedHint: false, usedSolution: false, recorded: false };
        setSelectedPuzzle(puzzle);
        setSolutionIndex(0);
        setSolveStatus('idle');
        setShowSolution(false);
        setHintText(null);
        setFeedback(null);
        setIsChecking(false);
        setExpectedLine(puzzle.solution || []);

        // Newer puzzles store the opponent's previous move so we can show it being played
        if (puzzle.preFen && puzzle.setupMove) {
            setBoardFen(puzzle.preFen);
            setBoardLastMove(null);
            setIsSettingUp(true);
            setTimeout(() => {
                if (puzzleTokenRef.current !== token) return;
                setBoardFen(puzzle.fen);
                setBoardLastMove(puzzle.setupMove.slice(0, 4));
                setIsSettingUp(false);
            }, 700);
        } else {
            setBoardFen(puzzle.fen);
            setBoardLastMove(null);
            setIsSettingUp(false);
        }
    };

    // Store per-puzzle progress (attempts / solves) in the library
    const recordResult = (success) => {
        if (attemptRef.current.recorded || !selectedPuzzle) return;
        attemptRef.current.recorded = true;
        const id = selectedPuzzle.id;
        const updated = libraryRef.current.map(p => {
            if (p.id !== id) return p;
            const prog = p.progress || { attempts: 0, solves: 0 };
            return {
                ...p,
                progress: {
                    attempts: (prog.attempts || 0) + 1,
                    solves: (prog.solves || 0) + (success ? 1 : 0),
                    lastResult: success ? 'solved' : 'failed',
                    lastAttemptAt: Date.now()
                }
            };
        });
        saveLibrary(updated);
        setStreak(s => (success ? s + 1 : 0));
    };

    const markFailed = () => {
        if (!attemptRef.current.recorded) recordResult(false);
    };

    // Copy FEN to Clipboard
    const handleCopyFen = () => {
        if (!selectedPuzzle) return;
        if (window.electronAPI && window.electronAPI.copyText) {
            window.electronAPI.copyText(selectedPuzzle.fen);
        } else {
            navigator.clipboard.writeText(selectedPuzzle.fen);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const finishSolved = (message = null) => {
        setSolveStatus('solved');
        setFeedback(message);
        setHintText(null);
        const clean = attemptRef.current.mistakes === 0 && !attemptRef.current.usedHint && !attemptRef.current.usedSolution;
        recordResult(clean);
    };

    // --- Local (engine-free) mate helpers. Cheap enough for "mate in 1 after any reply".
    const matesInOne = (chess) => {
        for (const m of chess.moves({ verbose: true })) {
            chess.move(m);
            const mate = chess.isCheckmate();
            chess.undo();
            if (mate) return true;
        }
        return false;
    };

    // Opponent to move in `fen`: does EVERY reply allow the solver an immediate mate?
    const forcedMateInOneAfterAnyReply = (fen) => {
        const c = new Chess(fen);
        if (c.isGameOver()) return false;
        for (const reply of c.moves({ verbose: true })) {
            c.move(reply);
            const ok = matesInOne(c);
            c.undo();
            if (!ok) return false;
        }
        return true;
    };

    const pickLocalDefence = (fen) => {
        const c = new Chess(fen);
        const moves = c.moves({ verbose: true });
        if (moves.length === 0) return null;
        for (const m of moves) {
            c.move(m);
            const losesNow = matesInOne(c);
            c.undo();
            if (!losesNow) return m.from + m.to + (m.promotion || '');
        }
        const m = moves[0];
        return m.from + m.to + (m.promotion || '');
    };

    // Play the opponent's reply (from the expected line, or the engine if the line ran out)
    const playOpponentReply = (fenAfterSolver, line, nextIdx, token) => {
        setSolveStatus('correct');
        setTimeout(async () => {
            if (puzzleTokenRef.current !== token) return;
            let reply = line[nextIdx];
            let workingLine = line;
            if (!reply) {
                const ev = await engineEval(fenAfterSolver, 500);
                if (puzzleTokenRef.current !== token) return;
                reply = ev?.bestMove;
                if (reply) {
                    workingLine = [...line.slice(0, nextIdx), reply, ...(ev.pv || []).slice(1)];
                } else {
                    // No engine available: pick the defence that avoids an immediate mate if one exists
                    reply = pickLocalDefence(fenAfterSolver);
                    if (!reply) {
                        finishSolved();
                        return;
                    }
                    workingLine = [...line.slice(0, nextIdx), reply];
                }
            }
            const chess = new Chess(fenAfterSolver);
            const m = applyUci(chess, reply);
            if (!m) {
                finishSolved();
                return;
            }
            setBoardFen(chess.fen());
            setBoardLastMove(reply.slice(0, 4));
            setExpectedLine(workingLine);
            setSolutionIndex(nextIdx + 1);
            setSolveStatus('idle');
            if (chess.isGameOver()) finishSolved();
        }, 550);
    };

    const handleSolvePieceDrop = (from, to) => {
        if (!selectedPuzzle || solveStatus === 'solved' || solveStatus === 'correct' || isSettingUp || isChecking) return false;

        const token = puzzleTokenRef.current;
        const tempChess = new Chess(boardFen);
        const piece = tempChess.get(from);
        const expectedUci = expectedLine[solutionIndex];

        let promotion;
        if (piece && piece.type === 'p' && (to.endsWith('8') || to.endsWith('1'))) {
            // Use the solution's promotion piece when it's the same move (allows under-promotion puzzles)
            promotion = expectedUci && expectedUci.slice(0, 4) === from + to && expectedUci.length > 4 ? expectedUci[4] : 'q';
        }

        let moveObj = null;
        try {
            moveObj = tempChess.move({ from, to, promotion });
        } catch (e) {
            return false;
        }
        if (!moveObj) return false;

        const playedUci = from + to + (promotion || '');
        const nextFen = tempChess.fen();
        const solverMovesLeft = Math.ceil((expectedLine.length - solutionIndex) / 2);

        const acceptMove = (line, message = null) => {
            setBoardFen(nextFen);
            setBoardLastMove(from + to);
            setHintText(null);
            setFeedback(message);
            const nextIdx = solutionIndex + 1;
            setSolutionIndex(nextIdx);
            setExpectedLine(line);
            if (tempChess.isCheckmate() || tempChess.isGameOver() || nextIdx >= line.length) {
                finishSolved(message);
                return;
            }
            playOpponentReply(nextFen, line, nextIdx, token);
        };

        const rejectMove = () => {
            attemptRef.current.mistakes++;
            markFailed();
            setSolveStatus('wrong');
            setTimeout(() => {
                if (puzzleTokenRef.current !== token) return;
                setSolveStatus(prev => (prev === 'wrong' ? 'idle' : prev));
            }, 1600);
        };

        // 1. The expected move
        if (expectedUci && (playedUci === expectedUci || (expectedUci.length === 4 && playedUci.slice(0, 4) === expectedUci && promotion === 'q'))) {
            acceptMove(expectedLine);
            return true;
        }

        // 2. Any checkmate always solves the puzzle
        if (tempChess.isCheckmate()) {
            acceptMove([...expectedLine.slice(0, solutionIndex), playedUci], expectedUci ? 'Checkmate! (different from the stored line, but just as good)' : 'Checkmate!');
            return true;
        }

        // 3. Alternative moves. For mate puzzles any move that still forces mate in
        //    the same number of moves (or fewer) is accepted.
        const isMatePuzzle = selectedPuzzle.type === 'mate';
        const prefix = expectedLine.slice(0, solutionIndex);
        const mateInTotal = Math.ceil((selectedPuzzle.solution || []).length / 2);
        const solverMovesMade = Math.floor(solutionIndex / 2);
        // Solver moves still allowed AFTER this one
        const mateBudget = Math.max(0, mateInTotal - solverMovesMade - 1);

        const acceptAlternative = (newLine, message) => {
            setBoardFen(nextFen);
            setBoardLastMove(from + to);
            setHintText(null);
            const nextIdx = solutionIndex + 1;
            setSolutionIndex(nextIdx);
            setExpectedLine(newLine);
            setFeedback(message);
            if (nextIdx >= newLine.length && !(isMatePuzzle && !tempChess.isCheckmate())) {
                finishSolved(message);
            } else {
                playOpponentReply(nextFen, newLine, nextIdx, token);
            }
        };

        // 3a. Mate in 1 remaining: verify locally, no engine needed
        if (isMatePuzzle && mateBudget === 1) {
            if (forcedMateInOneAfterAnyReply(nextFen)) {
                acceptAlternative([...prefix, playedUci], 'Alternative mating move accepted — it mates just as fast!');
                return true;
            }
            rejectMove();
            return false;
        }

        // Last move of a mate puzzle and it isn't checkmate: definitely wrong
        if (isMatePuzzle && mateBudget === 0) {
            rejectMove();
            return false;
        }

        const hasEngine = !!selectedEngineRef.current && !!window.electronAPI;
        if (!hasEngine) {
            if (!isMatePuzzle) {
                // Tactics are generated to have a single winning move
                rejectMove();
                return false;
            }
            // Can't verify a longer alternative mate without an engine - don't count it as a mistake
            setFeedback(null);
            setHintText('That might work too, but select an analysis engine (Puzzle Generator tab) so alternatives can be checked. Try the stored solution for now.');
            return false;
        }

        // 3b. Ask the engine (twice for mates, with a longer think, so a slow mate isn't wrongly rejected)
        setBoardFen(nextFen);
        setBoardLastMove(from + to);
        setIsChecking(true);
        (async () => {
            const judge = (ev) => {
                if (!ev || !ev.score) return null;
                const oppMate = ev.score.unit === 'mate' ? parseInt(ev.score.value, 10) : null;
                if (isMatePuzzle) {
                    // Opponent to move: negative mate = they are getting mated in |n| solver moves
                    if (oppMate !== null && oppMate < 0 && Math.abs(oppMate) <= mateBudget) {
                        return { newLine: [...prefix, playedUci, ...(ev.pv || [])], message: 'Alternative mating move accepted — it mates just as fast!' };
                    }
                    return null;
                }
                const solverWin = 100 - winPct(ev.score);
                if (solverWin >= 92 || (oppMate !== null && oppMate < 0)) {
                    return { newLine: [...prefix, playedUci], message: 'That also wins — puzzle solved!' };
                }
                return null;
            };

            let verdict = judge(await engineEval(nextFen, 800));
            if (!verdict && isMatePuzzle && puzzleTokenRef.current === token) {
                verdict = judge(await engineEval(nextFen, 2000));
            }
            if (puzzleTokenRef.current !== token) return;
            setIsChecking(false);
            if (verdict) {
                acceptAlternative(verdict.newLine, verdict.message);
            } else {
                // Take the move back
                setBoardFen(boardFen);
                setBoardLastMove(boardLastMove);
                rejectMove();
            }
        })();
        return true;
    };

    const showHint = () => {
        if (!selectedPuzzle || solveStatus === 'solved') return;
        const uci = expectedLine[solutionIndex];
        if (!uci) return;
        const chess = new Chess(boardFen);
        const p = chess.get(uci.slice(0, 2));
        const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
        attemptRef.current.usedHint = true;
        markFailed();
        setHintText(p ? `Move your ${names[p.type]} on ${uci.slice(0, 2)}.` : 'Look for forcing moves: checks, captures and threats.');
    };

    const toggleSolution = () => {
        if (!showSolution) {
            attemptRef.current.usedSolution = true;
            markFailed();
        }
        setShowSolution(!showSolution);
    };

    const nextUnsolvedPuzzle = () => {
        const filtered = getFilteredLibrary();
        if (filtered.length === 0) return;
        const currentIdx = filtered.findIndex(p => p.id === selectedPuzzle?.id);
        for (let k = 1; k <= filtered.length; k++) {
            const cand = filtered[(currentIdx + k) % filtered.length];
            if (cand.id !== selectedPuzzle?.id && cand.progress?.lastResult !== 'solved') {
                selectPuzzle(cand);
                return;
            }
        }
        // Everything solved: just go to the next one
        if (filtered.length > 1) selectPuzzle(filtered[(currentIdx + 1) % filtered.length]);
    };

    // Scan operations
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.pgn') || file.name.endsWith('.txt'))) {
            loadPgnFile(file);
        } else {
            alert("Please drag and drop a valid PGN file.");
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            loadPgnFile(file);
        }
    };

    const loadPgnFile = (file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            setPgnContent(event.target.result);
            setPgnFileName(file.name);
            addLog(`Loaded PGN file: ${file.name}`);
        };
        reader.readAsText(file);
    };

    const startPgnScan = () => {
        if (!selectedEngine) {
            alert("Please select a chess engine first.");
            return;
        }
        if (!pgnContent.trim()) {
            alert("Please load or paste PGN game data first.");
            return;
        }

        setScanResults([]);
        setScanLogs([]);
        setIsScanning(true);
        scanStartTime.current = Date.now();
        positionsScanned.current = 0;
        lastLoggedGameRef.current = 0;
        setScanEta(null);
        setScanSpeedPps(null);
        addLog(`Starting scan on ${pgnFileName || 'pasted PGN'}...`);

        if (window.electronAPI) {
            window.electronAPI.send('puzzle-gen-start', {
                enginePath: selectedEngine.path,
                pgnText: pgnContent,
                settings: {
                    scanSpeed,
                    types,
                    mateRange,
                    targetSide,
                    sensitivity,
                    maxPlies: (parseInt(maxMoves) * 2) || 10
                }
            });
        }
    };

    const stopPgnScan = () => {
        if (window.electronAPI) {
            window.electronAPI.send('puzzle-gen-stop');
        }
        setIsScanning(false);
        addLog("Scan stopped by user.");
    };

    // Filters
    const getFilteredLibrary = () => {
        return library.filter(p => {
            if (libraryFilter !== 'all') {
                if (libraryFilter === 'unsolved') {
                    if (p.progress?.lastResult === 'solved') return false;
                } else if (libraryFilter === 'failed') {
                    if (p.progress?.lastResult !== 'failed') return false;
                } else if (['mate', 'blunder', 'better_move'].includes(libraryFilter)) {
                    if (p.type !== libraryFilter) return false;
                } else {
                    if (!p.tags || !p.tags.includes(libraryFilter)) return false;
                }
            }
            if (librarySearch.trim()) {
                const search = librarySearch.toLowerCase();
                const white = p.gameDetails.white.toLowerCase();
                const black = p.gameDetails.black.toLowerCase();
                const event = p.gameDetails.event.toLowerCase();
                const desc = (p.description || '').toLowerCase();
                const themes = (p.themes || []).map(t => (THEME_LABELS[t] || t).toLowerCase()).join(' ');
                return white.includes(search) || black.includes(search) || event.includes(search) || desc.includes(search) || themes.includes(search);
            }
            return true;
        });
    };

    const getStats = () => {
        const total = library.length;
        const mates = library.filter(p => p.type === 'mate').length;
        const blunders = library.filter(p => p.type === 'blunder').length;
        const betterMoves = library.filter(p => p.type === 'better_move').length;
        const solved = library.filter(p => (p.progress?.solves || 0) > 0).length;
        const attempts = library.reduce((a, p) => a + (p.progress?.attempts || 0), 0);
        const solves = library.reduce((a, p) => a + (p.progress?.solves || 0), 0);
        const successRate = attempts > 0 ? Math.round((solves / attempts) * 100) : null;
        return { total, mates, blunders, betterMoves, solved, successRate };
    };

    const TYPE_LABELS = { mate: 'Checkmate', blunder: 'Punish Blunder', better_move: 'Missed Tactic', sacrifice: 'Sacrifice' };
    const THEME_LABELS = {
        mate: 'Checkmate', defensiveMove: 'Defence', fork: 'Fork', sacrifice: 'Sacrifice', hangingPiece: 'Hanging Piece', discoveredAttack: 'Discovered Attack',
        doubleCheck: 'Double Check', backRankMate: 'Back-Rank Mate', smotheredMate: 'Smothered Mate', promotion: 'Promotion',
        underPromotion: 'Under-Promotion', quietMove: 'Quiet Move', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3',
        mateIn4: 'Mate in 4', endgame: 'Endgame', middlegame: 'Middlegame', opening: 'Opening', oneMove: 'One Move',
        short: 'Short', long: 'Long', veryLong: 'Very Long', crushing: 'Crushing', advantage: 'Advantage', enPassant: 'En Passant', castling: 'Castling'
    };
    const lineToSan = (fenStart, line) => {
        try {
            const c = new Chess(fenStart);
            const out = [];
            for (const uci of line) {
                const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
                if (!m) break;
                out.push(m.san);
            }
            return out;
        } catch (e) {
            return [];
        }
    };

    const stats = getStats();

    // Arrows for solver board when showing solution
    const getSolverArrows = () => {
        if (!showSolution || !selectedPuzzle) return [];
        const currentExpectedUci = expectedLine[solutionIndex];
        if (!currentExpectedUci) return [];
        
        return [{
            from: currentExpectedUci.substring(0, 2),
            to: currentExpectedUci.substring(2, 4),
            color: 'rgba(74, 222, 128, 0.85)' // green hint arrow
        }];
    };

    return (
        <div className="flex flex-col lg:h-full lg:overflow-hidden p-2 lg:p-4 select-none">
            {/* Header / Sub Tabs */}
            <div className="flex justify-between items-center mb-6 shrink-0 bg-card border border-white/5 rounded-2xl p-4 shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-primary/10 rounded-xl border border-primary/20">
                        <Zap size={22} className="text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white tracking-wide">Tactics Trainer</h2>
                        <p className="text-xs text-muted-foreground">Generate puzzles from tournament games and master chess patterns</p>
                    </div>
                </div>

                <div className="flex bg-black/40 p-1 border border-white/5 rounded-xl">
                    <button
                        onClick={() => setActiveSubTab('library')}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${activeSubTab === 'library' ? 'bg-primary text-black shadow-md font-bold' : 'text-muted-foreground hover:text-white'}`}
                    >
                        <Trophy size={14} /> Training Library ({library.length})
                    </button>
                    <button
                        onClick={() => setActiveSubTab('generator')}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${activeSubTab === 'generator' ? 'bg-primary text-black shadow-md font-bold' : 'text-muted-foreground hover:text-white'}`}
                    >
                        <Sparkles size={14} /> Puzzle Generator
                    </button>
                </div>
            </div>

            {/* TAB CONTENT: puzzle generator */}
            {activeSubTab === 'generator' && (
                <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
                    
                    {/* LEFT PANEL: CONFIGURATION */}
                    <div className="w-full lg:w-96 bg-card border border-white/5 rounded-2xl p-5 flex flex-col gap-5 overflow-y-auto hidden-scrollbar shrink-0">
                        <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-1">
                            <Sliders size={16} className="text-primary" /> Scan Settings
                        </h3>

                        {/* Engine Selection */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-white flex items-center justify-between">
                                Analysis Engine
                                {engines.length === 0 && <span className="text-[10px] text-red-400">No engines found</span>}
                            </label>
                            <select
                                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-primary outline-none"
                                value={selectedEngine?.path || ''}
                                onChange={(e) => {
                                    setSelectedEngine(engines.find(eng => eng.path === e.target.value));
                                    e.target.blur();
                                }}
                                disabled={isScanning}
                            >
                                {engines.map(eng => (
                                    <option key={eng.path} value={eng.path}>{eng.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Custom Speed Control */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-white flex justify-between">
                                Think Time per Position
                                <span className="text-[10px] text-muted-foreground font-mono">{scanSpeed}ms</span>
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="50"
                                    max="10000"
                                    step="50"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:border-primary outline-none"
                                    value={scanSpeed}
                                    onChange={(e) => setScanSpeed(e.target.value)}
                                    disabled={isScanning}
                                    placeholder="300"
                                />
                                <span className="flex items-center text-xs text-muted-foreground px-2 bg-white/5 border border-white/10 rounded-xl shrink-0">ms</span>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-1.5 mt-1">
                                {[
                                    { label: 'Fast (100ms)', val: '100' },
                                    { label: 'Normal (300ms)', val: '300' },
                                    { label: 'Deep (1000ms)', val: '1000' }
                                ].map(preset => (
                                    <button
                                        key={preset.val}
                                        type="button"
                                        disabled={isScanning}
                                        onClick={() => setScanSpeed(preset.val)}
                                        className={`py-1.5 rounded-lg border text-[10px] transition-all ${scanSpeed === preset.val ? 'bg-primary/10 border-primary/45 text-primary font-semibold' : 'bg-black/20 border-white/5 hover:bg-white/5 text-muted-foreground'}`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Side & Length Controls */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-medium text-white">Target Side</label>
                                <select
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:border-primary outline-none"
                                    value={targetSide}
                                    onChange={(e) => {
                                        setTargetSide(e.target.value);
                                        e.target.blur();
                                    }}
                                    disabled={isScanning}
                                >
                                    <option value="both">Both Sides</option>
                                    <option value="white">White to Play</option>
                                    <option value="black">Black to Play</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-medium text-white">Max Length (Moves)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="15"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:border-primary outline-none"
                                    value={maxMoves}
                                    onChange={(e) => setMaxMoves(e.target.value)}
                                    disabled={isScanning}
                                    placeholder="5"
                                />
                            </div>
                        </div>

                        {/* Sensitivity */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-white">Puzzle Sensitivity</label>
                            <div className="grid grid-cols-3 gap-1.5">
                                {[
                                    { val: 'strict', label: 'Strict', note: 'Big tactics only' },
                                    { val: 'balanced', label: 'Balanced', note: 'Recommended' },
                                    { val: 'relaxed', label: 'Relaxed', note: 'More puzzles' }
                                ].map(opt => (
                                    <button
                                        key={opt.val}
                                        type="button"
                                        disabled={isScanning}
                                        onClick={() => setSensitivity(opt.val)}
                                        className={`py-1.5 rounded-lg border text-[10px] flex flex-col items-center transition-all ${sensitivity === opt.val ? 'bg-primary/10 border-primary/45 text-primary font-semibold' : 'bg-black/20 border-white/5 hover:bg-white/5 text-muted-foreground'}`}
                                    >
                                        <span>{opt.label}</span>
                                        <span className="text-[9px] opacity-60">{opt.note}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                {sensitivity === 'strict' && 'Only decisive tactics (you end up clearly winning). Clean games may produce few or no puzzles.'}
                                {sensitivity === 'balanced' && 'Clean tactics that win a solid advantage, plus "only move" defensive positions.'}
                                {sensitivity === 'relaxed' && 'Also smaller advantages and harder-to-spot defences. More puzzles, some less sharp.'}
                            </p>
                        </div>

                        {/* Puzzle Types */}
                        <div className="flex flex-col gap-2.5">
                            <label className="text-xs font-medium text-white">Target Tactics / Puzzles</label>
                            <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-3.5">
                                <label className="flex items-start gap-3 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        disabled={isScanning}
                                        checked={types.mate}
                                        onChange={(e) => setTypes({ ...types, mate: e.target.checked })}
                                        className="mt-0.5 rounded border-white/10 bg-black/40 text-primary focus:ring-primary w-4 h-4"
                                    />
                                    <div>
                                        <p className="text-xs font-semibold text-white">Forced Checkmates</p>
                                        <p className="text-[10px] text-muted-foreground">Forced mates, verified to end in checkmate</p>
                                    </div>
                                </label>

                                {types.mate && (
                                    <div className="pl-7 grid grid-cols-4 gap-1.5 pt-1 border-t border-white/5 animate-fade-in">
                                        {[
                                            { key: 'm1', label: 'M1' },
                                            { key: 'm2', label: 'M2' },
                                            { key: 'm3', label: 'M3' },
                                            { key: 'mx', label: 'M4+' }
                                        ].map(range => (
                                            <button
                                                key={range.key}
                                                type="button"
                                                disabled={isScanning}
                                                onClick={() => setMateRange({ ...mateRange, [range.key]: !mateRange[range.key] })}
                                                className={`py-1 rounded text-[10px] font-mono border transition-all ${mateRange[range.key] ? 'bg-primary/20 border-primary/40 text-primary font-bold' : 'bg-black/40 border-transparent text-muted-foreground'}`}
                                            >
                                                {range.label}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <label className="flex items-start gap-3 cursor-pointer select-none pt-2 border-t border-white/5">
                                    <input
                                        type="checkbox"
                                        disabled={isScanning}
                                        checked={types.blunder}
                                        onChange={(e) => setTypes({ ...types, blunder: e.target.checked })}
                                        className="mt-0.5 rounded border-white/10 bg-black/40 text-primary focus:ring-primary w-4 h-4"
                                    />
                                    <div>
                                        <p className="text-xs font-semibold text-white">Punish the Blunder</p>
                                        <p className="text-[10px] text-muted-foreground">The opponent just blundered — find the winning tactic</p>
                                    </div>
                                </label>

                                <label className="flex items-start gap-3 cursor-pointer select-none pt-2 border-t border-white/5">
                                    <input
                                        type="checkbox"
                                        disabled={isScanning}
                                        checked={types.better_move}
                                        onChange={(e) => setTypes({ ...types, better_move: e.target.checked })}
                                        className="mt-0.5 rounded border-white/10 bg-black/40 text-primary focus:ring-primary w-4 h-4"
                                    />
                                    <div>
                                        <p className="text-xs font-semibold text-white">Missed Tactics &amp; Only Moves</p>
                                        <p className="text-[10px] text-muted-foreground">A winning shot or the only saving move existed, but a different move was played</p>
                                    </div>
                                </label>

                            </div>
                        </div>

                        {/* Drag and Drop PGN upload */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-white flex justify-between">
                                Input PGN File / Text
                                {pgnContent && (
                                    <button 
                                        onClick={() => { setPgnContent(''); setPgnFileName(''); }}
                                        className="text-[10px] text-red-400 hover:text-red-300 font-bold"
                                        disabled={isScanning}
                                    >
                                        Clear
                                    </button>
                                )}
                            </label>

                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept=".pgn,.txt"
                                className="hidden"
                            />

                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => !isScanning && fileInputRef.current?.click()}
                                className={`h-32 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all ${
                                    isDragging ? 'border-primary bg-primary/5' : 'border-white/10 bg-black/20 hover:border-primary/40 hover:bg-white/5'
                                } ${isScanning ? 'pointer-events-none opacity-50' : ''}`}
                            >
                                <Upload size={24} className={`mb-2 ${pgnFileName ? 'text-primary' : 'text-muted-foreground'}`} />
                                <span className="text-xs font-semibold text-white">
                                    {pgnFileName ? pgnFileName : 'Drag & drop tournament PGN'}
                                </span>
                                <span className="text-[10px] text-muted-foreground mt-1">
                                    or click to select file
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-auto pt-2 shrink-0">
                            {isScanning ? (
                                <button
                                    onClick={stopPgnScan}
                                    className="w-full py-4 rounded-xl font-bold bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition-all shadow-lg flex items-center justify-center gap-2"
                                >
                                    <Pause size={18} /> Stop Scan
                                </button>
                            ) : (
                                <button
                                    onClick={startPgnScan}
                                    disabled={!pgnContent}
                                    className={`w-full py-4 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                                        pgnContent 
                                            ? 'bg-primary text-black hover:brightness-110 shadow-primary/20' 
                                            : 'bg-zinc-800 text-muted-foreground border border-white/5 cursor-not-allowed'
                                    }`}
                                >
                                    <Play size={18} /> Generate Puzzles
                                </button>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: LIVE SCAN RESULTS & PROGRESS */}
                    <div className="flex-1 bg-card border border-white/5 rounded-2xl p-5 flex flex-col min-h-[640px] lg:min-h-0">
                        {/* Live progress header */}
                        {isScanning && scanProgress && (
                            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-4 animate-fade-in shrink-0">
                                <div className="flex justify-between items-center text-xs font-semibold text-white mb-2">
                                    <span className="flex items-center gap-1.5"><RefreshCw size={14} className="animate-spin text-primary" /> {scanProgress.phase === 'verifying' ? 'Verifying a candidate in' : 'Scanning'} Game {scanProgress.gameIndex} of {scanProgress.totalGames}...</span>
                                    <span className="font-mono text-primary">{scanProgress.percent}%</span>
                                </div>
                                <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden border border-white/5">
                                    <div 
                                        className="bg-primary h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(74,222,128,0.5)]" 
                                        style={{ width: `${scanProgress.percent}%` }}
                                    />
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-2">
                                    <span>Move ply: {scanProgress.plyIndex} / {scanProgress.totalPlies}</span>
                                    <div className="flex gap-3 text-muted-foreground/80 font-mono">
                                        {scanSpeedPps && <span>Speed: {scanSpeedPps} pos/s</span>}
                                        {scanEta && <span>ETA: {scanEta}</span>}
                                    </div>
                                    <span className="text-primary font-bold">{scanProgress.puzzlesFound} puzzles found</span>
                                </div>
                            </div>
                        )}

                        {/* Toolbar for generator results */}
                        <div className="flex justify-between items-center mb-4 shrink-0">
                            <h3 className="font-bold text-sm text-white flex items-center gap-2">
                                Puzzles Found <span className="bg-primary/20 text-primary border border-primary/20 px-2 py-0.5 rounded-full text-xs font-mono">{scanResults.length}</span>
                            </h3>
                            {scanResults.length > 0 && (
                                <button 
                                    onClick={addAllToLibrary}
                                    className="px-3.5 py-1.5 bg-primary/20 hover:bg-primary/30 border border-primary/30 rounded-xl text-xs font-semibold text-primary transition-all flex items-center gap-1.5"
                                >
                                    <Plus size={14} /> Add All to Library
                                </button>
                            )}
                        </div>

                        {/* Split layout: Results grid & logs console */}
                        <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
                            
                            {/* RESULTS SCROLL GRID */}
                            <div className="flex-1 overflow-y-auto hidden-scrollbar border border-white/5 bg-black/25 rounded-2xl p-4 min-h-0">
                                {scanResults.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                        <AlertCircle size={32} className="text-muted-foreground/30 mb-3" />
                                        <p className="text-sm font-semibold text-muted-foreground">No Puzzles Found Yet</p>
                                        <p className="text-xs text-muted-foreground/60 max-w-sm mt-1">
                                            Load a PGN, verify your search parameters, and click "Generate Puzzles" to begin search.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                        {scanResults.map((puzzle) => (
                                            <div 
                                                key={puzzle.id} 
                                                className="bg-card border border-white/5 hover:border-white/10 p-4 rounded-xl flex flex-col justify-between gap-3 shadow-md hover:shadow-lg transition-all animate-in"
                                            >
                                                <div>
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                                            puzzle.type === 'mate' 
                                                                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' 
                                                                : puzzle.type === 'blunder'
                                                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                                    : puzzle.type === 'sacrifice'
                                                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                                                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                        }`}>
                                                            {TYPE_LABELS[puzzle.type] || 'Puzzle'}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground font-mono">Move {puzzle.gameDetails.moveNumber}</span>
                                                    </div>

                                                    <h4 className="font-bold text-sm text-white mb-1 flex items-center justify-between gap-2">
                                                        <span>{puzzle.title}</span>
                                                        {puzzle.difficulty && <span className="text-[10px] font-mono text-muted-foreground font-normal">{puzzle.difficulty.label} · {puzzle.difficulty.rating}</span>}
                                                    </h4>
                                                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{puzzle.description}</p>
                                                    {puzzle.themes?.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            {puzzle.themes.filter(t => !['middlegame', 'opening', 'endgame', 'oneMove', 'short', 'long', 'veryLong', 'advantage', 'crushing', 'mate'].includes(t)).slice(0, 4).map(t => (
                                                                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80">{THEME_LABELS[t] || t}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    
                                                    <div className="mt-2 text-[10px] text-muted-foreground/80 flex flex-col gap-0.5">
                                                        <span className="font-semibold text-white/95">
                                                            {puzzle.gameDetails.white} vs {puzzle.gameDetails.black}
                                                        </span>
                                                        <span>{puzzle.gameDetails.event} ({puzzle.gameDetails.date})</span>
                                                    </div>
                                                </div>

                                                <div className="flex gap-2 border-t border-white/5 pt-3 mt-1">
                                                    <button
                                                        onClick={() => {
                                                            addToLibrary(puzzle);
                                                            setActiveSubTab('library');
                                                            selectPuzzle(puzzle);
                                                        }}
                                                        className="flex-1 py-1.5 bg-primary text-black hover:brightness-110 text-xs font-bold rounded-lg transition-all"
                                                    >
                                                        Save & Solve
                                                    </button>
                                                    <button
                                                        onClick={() => addToLibrary(puzzle)}
                                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/5 text-xs font-semibold rounded-lg transition-all"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* LOGS CONSOLE PANEL */}
                            <div className="w-full md:w-64 border border-white/5 bg-black/40 rounded-2xl p-4 flex flex-col min-h-0 shrink-0">
                                <h4 className="font-bold text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <FileText size={14} className="text-primary" /> Scan Logs
                                </h4>
                                <div className="flex-1 bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-[10px] text-muted-foreground/80 overflow-y-auto leading-relaxed flex flex-col-reverse gap-1.5">
                                    {scanLogs.length === 0 ? (
                                        <span className="text-muted-foreground/45 italic">Waiting for scan activity...</span>
                                    ) : (
                                        scanLogs.map((log, idx) => <div key={idx} className="whitespace-pre-wrap break-all">{log}</div>)
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: puzzle solving library */}
            {activeSubTab === 'library' && (
                <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
                    
                    {/* LEFT PANEL: SAVED PUZZLES LIST */}
                    <div className="w-full lg:w-96 bg-card border border-white/5 rounded-2xl p-5 flex flex-col gap-4 overflow-y-auto hidden-scrollbar shrink-0">
                        {/* Stats Dashboard */}
                        <div className="grid grid-cols-4 gap-1 bg-black/30 border border-white/5 p-3 rounded-xl shrink-0 text-center font-mono">
                            <div>
                                <p className="text-[10px] text-muted-foreground">Puzzles</p>
                                <p className="text-sm font-extrabold text-white mt-0.5">{stats.total}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-emerald-400">Solved</p>
                                <p className="text-sm font-extrabold text-emerald-400 mt-0.5">{stats.solved}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-sky-400">Success</p>
                                <p className="text-sm font-extrabold text-sky-400 mt-0.5">{stats.successRate === null ? '—' : `${stats.successRate}%`}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-amber-400">Streak</p>
                                <p className="text-sm font-extrabold text-amber-400 mt-0.5">{streak}</p>
                            </div>
                        </div>

                        {/* Search & Filters */}
                        <div className="flex flex-col gap-2 shrink-0">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search library..."
                                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs focus:border-primary outline-none"
                                    value={librarySearch}
                                    onChange={(e) => setLibrarySearch(e.target.value)}
                                />
                                {librarySearch && (
                                    <button 
                                        onClick={() => setLibrarySearch('')} 
                                        className="absolute right-3 top-3.5 text-muted-foreground hover:text-white"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {library.length > 0 && (
                                <button
                                    onClick={deleteAllPuzzles}
                                    className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 mt-1"
                                >
                                    <Trash2 size={13} /> Clear Library
                                </button>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] text-muted-foreground block mb-1">Filter Type</label>
                                    <select
                                        value={libraryFilter}
                                        onChange={(e) => {
                                            setLibraryFilter(e.target.value);
                                            e.target.blur();
                                        }}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs focus:border-primary outline-none text-white font-medium"
                                    >
                                        <option value="all">All Puzzles</option>
                                        <option value="unsolved">Not Solved Yet</option>
                                        <option value="failed">Failed Last Time</option>
                                        <optgroup label="Type">
                                            <option value="mate">Checkmate ({stats.mates})</option>
                                            <option value="blunder">Punish the Blunder ({stats.blunders})</option>
                                            <option value="better_move">Missed Tactic ({stats.betterMoves})</option>
                                        </optgroup>
                                        <optgroup label="Theme">
                                            {['defensiveMove', 'fork', 'sacrifice', 'hangingPiece', 'discoveredAttack', 'quietMove', 'backRankMate', 'smotheredMate', 'promotion', 'mateIn1', 'mateIn2', 'mateIn3', 'endgame'].map(t => (
                                                <option key={t} value={t}>{THEME_LABELS[t]}</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-muted-foreground block mb-1">Sort By</label>
                                    <select
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs focus:border-primary outline-none text-white font-medium"
                                        onChange={(e) => {
                                            const sorted = [...library];
                                            if (e.target.value === 'newest') {
                                                sorted.sort((a, b) => b.createdAt - a.createdAt);
                                            } else if (e.target.value === 'oldest') {
                                                sorted.sort((a, b) => a.createdAt - b.createdAt);
                                            } else if (e.target.value === 'move') {
                                                sorted.sort((a, b) => a.gameDetails.moveNumber - b.gameDetails.moveNumber);
                                            } else if (e.target.value === 'easy' || e.target.value === 'hard') {
                                                const r = (p) => p.difficulty?.rating ?? 1500;
                                                sorted.sort((a, b) => e.target.value === 'easy' ? r(a) - r(b) : r(b) - r(a));
                                            }
                                            setLibrary(sorted);
                                            e.target.blur();
                                        }}
                                    >
                                        <option value="newest">Newest Added</option>
                                        <option value="oldest">Oldest Added</option>
                                        <option value="move">Move Number</option>
                                        <option value="easy">Easiest First</option>
                                        <option value="hard">Hardest First</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Puzzles List */}
                        <div className="flex-1 overflow-y-auto hidden-scrollbar flex flex-col gap-2 border border-white/5 bg-black/25 rounded-2xl p-3 min-h-0">
                            {getFilteredLibrary().length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                                    <BookOpen size={28} className="text-muted-foreground/30 mb-2" />
                                    <p className="text-xs font-semibold text-muted-foreground">No Puzzles Found</p>
                                    <p className="text-[10px] text-muted-foreground/50 mt-1 max-w-xs leading-relaxed">
                                        Scan tournament files or clear filters to populate.
                                    </p>
                                </div>
                            ) : (
                                getFilteredLibrary().map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => selectPuzzle(p)}
                                        className={`p-3 rounded-xl text-left border transition-all flex flex-col gap-1.5 ${
                                            selectedPuzzle?.id === p.id 
                                                ? 'bg-primary/10 border-primary/40 shadow-sm' 
                                                : 'bg-card border-white/5 hover:bg-white/5 hover:border-white/10'
                                        }`}
                                    >
                                        <div className="flex justify-between items-center w-full">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                                                p.type === 'mate' 
                                                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' 
                                                    : p.type === 'blunder'
                                                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                        : p.type === 'sacrifice'
                                                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            }`}>
                                                {TYPE_LABELS[p.type] || 'Puzzle'}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground font-mono">Move {p.gameDetails.moveNumber}</span>
                                        </div>

                                        <p className="font-bold text-xs text-white truncate w-full flex items-center gap-1.5">
                                            {p.progress?.lastResult === 'solved' && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
                                            {p.progress?.lastResult === 'failed' && <X size={12} className="text-red-400 shrink-0" />}
                                            <span className="truncate">{p.title}</span>
                                            {p.difficulty && <span className="ml-auto text-[9px] font-mono text-muted-foreground font-normal shrink-0">{p.difficulty.label}</span>}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-1 w-full">{p.description}</p>
                                        
                                        <div className="text-[9px] text-muted-foreground/75 truncate w-full flex justify-between border-t border-white/5 pt-1.5 mt-0.5">
                                            <span className="font-medium text-white/90 truncate mr-2">
                                                {p.gameDetails.white} vs {p.gameDetails.black}
                                            </span>
                                            <span className="shrink-0">{p.gameDetails.date}</span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: INTERACTIVE SOLVER BOARD */}
                    <div className="flex-1 bg-card border border-white/5 rounded-2xl p-5 flex flex-col items-center justify-center relative min-h-[400px] lg:min-h-0">
                        {selectedPuzzle ? (
                            <div className="w-full h-full flex flex-col lg:flex-row gap-6">
                                
                                {/* SOLVER AREA */}
                                <div className="flex-1 flex flex-col justify-center items-center">
                                    
                                    {/* Puzzle Headers */}
                                    <div className="w-full max-w-[580px] bg-black/45 border border-white/5 rounded-xl px-4 py-3 mb-4 flex justify-between items-center shadow shadow-black/50">
                                        <div className="flex flex-col gap-1 min-w-0">
                                            <span className="text-white font-bold text-base truncate">
                                                {selectedPuzzle.gameDetails.white} <span className="text-primary/50 font-normal italic text-xs mx-1">vs</span> {selectedPuzzle.gameDetails.black}
                                            </span>
                                            <span className="text-xs text-muted-foreground truncate">
                                                {selectedPuzzle.gameDetails.event} | Move {selectedPuzzle.gameDetails.moveNumber} ({selectedPuzzle.gameDetails.date})
                                            </span>
                                        </div>
                                        
                                        <div className={`px-3 py-2 rounded-lg text-xs font-black shrink-0 border ${
                                            solveStatus === 'solved' 
                                                ? 'bg-green-500/25 border-green-400/40 text-green-400 shadow-[0_0_10px_rgba(74,222,128,0.15)] animate-pulse font-extrabold'
                                                : solveStatus === 'wrong'
                                                    ? 'bg-red-500/25 border-red-400/40 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)] font-bold'
                                                    : 'bg-primary/10 border-primary/20 text-primary font-bold'
                                        }`}>
                                            {selectedPuzzle.turn === 'w' ? 'White to Move' : 'Black to Move'}
                                        </div>
                                    </div>
 
                                    {/* Chess Board */}
                                    <div className="flex gap-4 items-center justify-center w-full min-w-[320px] max-h-[580px] flex-1">
                                        <ChessBoard
                                            fen={boardFen}
                                            lastMove={boardLastMove}
                                            orientation={selectedPuzzle.turn === 'w' ? 'white' : 'black'}
                                            size="580px"
                                            allowDrag={solveStatus !== 'solved' && !isSettingUp && !isChecking}
                                            interactive={solveStatus !== 'solved' && !isSettingUp && !isChecking}
                                            onPieceDrop={handleSolvePieceDrop}
                                            arrows={getSolverArrows()}
                                        />
                                    </div>
                                </div>

                                {/* SIDE PANEL: CONTROLS & SOLUTIONS */}
                                <div className="w-full lg:w-72 flex flex-col gap-4 justify-between border-t lg:border-t-0 lg:border-l border-white/5 pt-4 lg:pt-0 lg:pl-4 shrink-0">
                                    <div className="flex flex-col gap-4">
                                        <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-1">
                                            Instruction
                                        </h3>
                                        <div className="bg-black/30 border border-white/5 p-4 rounded-xl flex flex-col gap-2.5">
                                            <p className="text-sm text-white/90 font-semibold leading-relaxed">
                                                {selectedPuzzle.description}
                                            </p>
                                            {selectedPuzzle.difficulty && (
                                                <p className="text-[10px] font-mono text-muted-foreground">
                                                    Difficulty: <span className="text-white">{selectedPuzzle.difficulty.label}</span> (~{selectedPuzzle.difficulty.rating})
                                                </p>
                                            )}
                                            {(solveStatus === 'solved' || showSolution) && selectedPuzzle.themes?.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {selectedPuzzle.themes.map(t => (
                                                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/80">{THEME_LABELS[t] || t}</span>
                                                    ))}
                                                </div>
                                            )}
                                            
                                            {selectedPuzzle.playedBlunder && (
                                                <p className={`text-xs p-2 rounded-lg mt-1 font-mono border ${
                                                    selectedPuzzle.type === 'blunder' 
                                                        ? 'text-red-400 bg-red-500/10 border-red-500/10' 
                                                        : selectedPuzzle.type === 'sacrifice'
                                                            ? 'text-amber-400 bg-amber-500/10 border-amber-500/10'
                                                            : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/10'
                                                }`}>
                                                    {selectedPuzzle.type === 'blunder' 
                                                        ? `Blunder played: ${selectedPuzzle.playedBlunder}` 
                                                        : selectedPuzzle.type === 'sacrifice'
                                                            ? `Missed Sacrifice: ${selectedPuzzle.playedBlunder}`
                                                            : `Played move: ${selectedPuzzle.playedBlunder}`}
                                                </p>
                                            )}
                                        </div>

                                        {/* Status Message */}
                                        <div className="flex flex-col gap-2">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</span>
                                            
                                            {isSettingUp && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-white/5 border border-white/5 rounded-xl text-xs text-muted-foreground font-medium">
                                                    <RefreshCw size={16} className="animate-spin shrink-0" />
                                                    {selectedPuzzle.setupSan ? `Opponent plays ${selectedPuzzle.setupSan}...` : 'Setting up...'}
                                                </div>
                                            )}

                                            {isChecking && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-sky-500/10 border border-sky-500/20 text-sky-300 rounded-xl text-xs font-semibold">
                                                    <RefreshCw size={16} className="animate-spin shrink-0" />
                                                    Not the stored move — checking it with the engine...
                                                </div>
                                            )}

                                            {solveStatus === 'idle' && !isSettingUp && !isChecking && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-white/5 border border-white/5 rounded-xl text-xs text-muted-foreground font-medium">
                                                    <HelpCircle size={16} className="text-muted-foreground/60 shrink-0" />
                                                    {solutionIndex === 0
                                                        ? `${selectedPuzzle.turn === 'w' ? 'White' : 'Black'} to move — find the best move!`
                                                        : 'Good! Keep going — find the next move.'}
                                                </div>
                                            )}

                                            {hintText && solveStatus !== 'solved' && (
                                                <div className="flex items-center gap-2.5 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs font-semibold">
                                                    <Sparkles size={14} className="shrink-0" />
                                                    {hintText}
                                                </div>
                                            )}

                                            {feedback && solveStatus !== 'solved' && (
                                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs font-semibold">
                                                    {feedback}
                                                </div>
                                            )}

                                            {solveStatus === 'correct' && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-xs font-bold animate-pulse">
                                                    <CheckCircle size={16} className="shrink-0" />
                                                    Correct! Opponent is responding...
                                                </div>
                                            )}

                                            {solveStatus === 'solved' && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-green-500/25 border border-green-400/40 text-green-400 rounded-xl text-xs font-extrabold shadow shadow-green-500/10">
                                                    <Trophy size={16} className="text-green-400 shrink-0 animate-bounce" />
                                                    <span>
                                                        {attemptRef.current.mistakes === 0 && !attemptRef.current.usedHint && !attemptRef.current.usedSolution
                                                            ? 'Solved on the first try!'
                                                            : 'Solved (with help) — try it again later.'}
                                                        {feedback && <span className="block font-medium text-green-300/80 mt-0.5">{feedback}</span>}
                                                    </span>
                                                </div>
                                            )}

                                            {solveStatus === 'wrong' && (
                                                <div className="flex items-center gap-2.5 p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold animate-shake">
                                                    <AlertCircle size={16} className="shrink-0" />
                                                    Not the best move. Try again!
                                                </div>
                                            )}
                                        </div>

                                        {/* Solution PV line */}
                                        {showSolution && (
                                            <div className="flex flex-col gap-2 animate-fade-in border border-primary/20 bg-primary/5 p-4 rounded-xl">
                                                <span className="text-[10px] text-primary uppercase font-bold tracking-wider">Solution Line</span>
                                                <div className="font-mono text-xs text-white leading-relaxed font-semibold">
                                                    {lineToSan(selectedPuzzle.fen, expectedLine).map((m, idx) => {
                                                        const isPlayer = idx % 2 === 0;
                                                        const moveNum = Math.floor(idx / 2) + 1;
                                                        return (
                                                            <span key={idx} className={isPlayer ? "text-primary mr-1" : "text-muted-foreground mr-1"}>
                                                                {isPlayer ? `${moveNum}. ${m}` : `${m}`}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-col gap-2 pt-4 border-t border-white/5 mt-auto">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => selectPuzzle(selectedPuzzle)}
                                                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                                            >
                                                <RefreshCw size={14} /> Retry
                                            </button>
                                            <button
                                                onClick={showHint}
                                                disabled={solveStatus === 'solved'}
                                                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 text-amber-300 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                                            >
                                                <Sparkles size={14} /> Hint
                                            </button>
                                            <button
                                                onClick={toggleSolution}
                                                className={`flex-1 py-2.5 border text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                                                    showSolution 
                                                        ? 'bg-primary/20 border-primary/40 text-primary font-bold' 
                                                        : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'
                                                }`}
                                            >
                                                <HelpCircle size={14} /> Solution
                                            </button>
                                        </div>
 
                                        <button
                                            onClick={() => onAnalyzePosition && onAnalyzePosition(selectedPuzzle.fen, true)}
                                            className="w-full py-2.5 bg-gradient-to-r from-primary to-green-600 hover:from-primary hover:to-green-500 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(74,222,128,0.2)] hover:scale-[1.02] cursor-pointer"
                                        >
                                            <Sparkles size={14} />
                                            <span>Analyze Position</span>
                                        </button>

                                        <button
                                            onClick={handleCopyFen}
                                            className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white border border-white/5 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                                        >
                                            {copied ? (
                                                <>
                                                    <CheckCircle size={14} className="text-primary animate-pulse" />
                                                    <span className="text-primary font-bold">FEN Copied!</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy size={14} />
                                                    <span>Copy FEN</span>
                                                </>
                                            )}
                                        </button>
 
                                        <button
                                            onClick={() => deleteFromLibrary(selectedPuzzle.id)}
                                            className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                                        >
                                            <Trash2 size={14} /> Delete from Library
                                        </button>

                                        {(solveStatus === 'solved' || showSolution) && library.length > 1 && (
                                            <button
                                                onClick={nextUnsolvedPuzzle}
                                                className="w-full py-3.5 bg-primary text-black font-extrabold hover:brightness-110 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20 animate-pulse mt-2"
                                            >
                                                Next Puzzle <ArrowRight size={16} />
                                            </button>
                                        )}
                                    </div>

                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-8 flex flex-col items-center justify-center h-full max-w-sm">
                                <Trophy size={48} className="text-muted-foreground/20 mb-4" />
                                <h4 className="font-bold text-white mb-2">No Puzzle Selected</h4>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Your library contains {library.length} puzzles. Select a puzzle from the sidebar to start solving, or go to the Puzzle Generator tab to parse a tournament PGN.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
