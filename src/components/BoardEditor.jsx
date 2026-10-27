import React, { useState, useEffect } from 'react';
import { ChessBoard } from './ChessBoard';
import { PieceIcon } from './PieceIcons';
import { Copy, Check, RotateCcw, Trash2, ArrowRightLeft, Play, Eraser } from 'lucide-react';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

const parseSquare = (square) => {
    const file = square.charCodeAt(0) - 97; // 0-7
    const rank = 8 - parseInt(square[1]);    // 0-7
    return { row: rank, file };
};

const generateFen = (grid, activeColor, castlingRights, enPassant) => {
    const rows = [];
    for (let r = 0; r < 8; r++) {
        let emptyCount = 0;
        let rowStr = '';
        for (let f = 0; f < 8; f++) {
            const piece = grid[r][f];
            if (piece === null) {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    rowStr += emptyCount;
                    emptyCount = 0;
                }
                const char = piece.type;
                rowStr += piece.color === 'w' ? char.toUpperCase() : char.toLowerCase();
            }
        }
        if (emptyCount > 0) {
            rowStr += emptyCount;
        }
        rows.push(rowStr);
    }
    const boardPart = rows.join('/');

    let castling = '';
    if (castlingRights.wK) castling += 'K';
    if (castlingRights.wQ) castling += 'Q';
    if (castlingRights.bK) castling += 'k';
    if (castlingRights.bQ) castling += 'q';
    if (castling === '') castling = '-';

    return `${boardPart} ${activeColor} ${castling} ${enPassant} 0 1`;
};

const loadFen = (fenStr) => {
    try {
        const parts = fenStr.trim().split(/\s+/);
        const boardPart = parts[0];
        const activeColor = parts[1] || 'w';
        const castling = parts[2] || '-';
        const enPassant = parts[3] || '-';

        const rows = boardPart.split('/');
        const newGrid = Array(8).fill(null).map(() => Array(8).fill(null));

        for (let r = 0; r < 8; r++) {
            let file = 0;
            const fenRow = rows[r] || '8';
            for (let i = 0; i < fenRow.length; i++) {
                const char = fenRow[i];
                if (!isNaN(char)) {
                    file += parseInt(char);
                } else {
                    const color = char === char.toUpperCase() ? 'w' : 'b';
                    const type = char.toLowerCase();
                    newGrid[r][file] = { type, color };
                    file++;
                }
            }
        }

        const castlingRights = {
            wK: castling.includes('K'),
            wQ: castling.includes('Q'),
            bK: castling.includes('k'),
            bQ: castling.includes('q')
        };

        return { grid: newGrid, activeColor, castlingRights, enPassant, success: true };
    } catch (e) {
        console.error("Failed to parse FEN:", e);
        return { success: false };
    }
};

export function BoardEditor({ onAnalyzePosition }) {
    const [grid, setGrid] = useState(() => Array(8).fill(null).map(() => Array(8).fill(null)));
    const [activeColor, setActiveColor] = useState('w');
    const [castlingRights, setCastlingRights] = useState({ wK: true, wQ: true, bK: true, bQ: true });
    const [enPassant, setEnPassant] = useState('-');
    const [orientation, setOrientation] = useState('white');
    const [selectedPiece, setSelectedPiece] = useState(null); // { type, color }
    const [eraserActive, setEraserActive] = useState(false);
    const [copied, setCopied] = useState(false);
    const [fenInput, setFenInput] = useState(STARTING_FEN);
    const [fenError, setFenError] = useState(false);

    // Initial setup
    useEffect(() => {
        const result = loadFen(STARTING_FEN);
        if (result.success) {
            setGrid(result.grid);
            setActiveColor(result.activeColor);
            setCastlingRights(result.castlingRights);
            setEnPassant(result.enPassant);
        }
    }, []);

    // Generate FEN when state changes
    const currentFen = generateFen(grid, activeColor, castlingRights, enPassant);

    useEffect(() => {
        setFenInput(currentFen);
    }, [grid, activeColor, castlingRights, enPassant]);

    const handleFenInputChange = (e) => {
        const val = e.target.value;
        setFenInput(val);
        const result = loadFen(val);
        if (result.success) {
            setGrid(result.grid);
            setActiveColor(result.activeColor);
            setCastlingRights(result.castlingRights);
            setEnPassant(result.enPassant);
            setFenError(false);
        } else {
            setFenError(true);
        }
    };

    const handlePieceDrop = (from, to, draggedPiece) => {
        const newGrid = grid.map(row => [...row]);
        const toCoords = parseSquare(to);

        if (from === 'palette') {
            newGrid[toCoords.row][toCoords.file] = draggedPiece;
        } else {
            const fromCoords = parseSquare(from);
            const piece = newGrid[fromCoords.row][fromCoords.file];
            newGrid[fromCoords.row][fromCoords.file] = null;
            newGrid[toCoords.row][toCoords.file] = piece;
        }
        setGrid(newGrid);
    };

    const handleSquareClick = (square) => {
        const coords = parseSquare(square);
        const newGrid = grid.map(row => [...row]);

        if (eraserActive) {
            newGrid[coords.row][coords.file] = null;
            setGrid(newGrid);
        } else if (selectedPiece) {
            newGrid[coords.row][coords.file] = selectedPiece;
            setGrid(newGrid);
        }
    };

    const selectPiece = (type, color) => {
        setEraserActive(false);
        if (selectedPiece && selectedPiece.type === type && selectedPiece.color === color) {
            setSelectedPiece(null); // toggle off
        } else {
            setSelectedPiece({ type, color });
        }
    };

    const toggleEraser = () => {
        setSelectedPiece(null);
        setEraserActive(!eraserActive);
    };

    const resetToStarting = () => {
        const result = loadFen(STARTING_FEN);
        if (result.success) {
            setGrid(result.grid);
            setActiveColor(result.activeColor);
            setCastlingRights(result.castlingRights);
            setEnPassant(result.enPassant);
            setFenError(false);
        }
    };

    const clearBoard = () => {
        const result = loadFen(EMPTY_FEN);
        if (result.success) {
            setGrid(result.grid);
            setActiveColor(result.activeColor);
            setCastlingRights(result.castlingRights);
            setEnPassant(result.enPassant);
            setFenError(false);
        }
    };

    const copyToClipboard = () => {
        if (window.electronAPI) {
            window.electronAPI.copyText(currentFen);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else {
            navigator.clipboard.writeText(currentFen);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleDragStartPalette = (e, piece) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'piece', piece, source: 'palette' }));
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const palettePieces = ['k', 'q', 'r', 'b', 'n', 'p'];
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const epOptions = ['-'];
    if (activeColor === 'w') {
        files.forEach(f => epOptions.push(`${f}6`));
    } else {
        files.forEach(f => epOptions.push(`${f}3`));
    }

    return (
        <div className="flex flex-col gap-4 lg:gap-6 max-w-[1600px] mx-auto pb-10 select-none">
            <div className="flex justify-between items-end shrink-0">
                <div>
                    <h2 className="text-2xl lg:text-3xl font-bold text-foreground">Board Editor</h2>
                    <p className="text-muted-foreground mt-1">Design your own setups, custom openings, or chess puzzles</p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 lg:gap-8 items-start justify-center">
                {/* Chessboard Column */}
                <div className="flex flex-col gap-3 items-center shrink-0 w-full md:w-[clamp(300px,calc(100vh-250px),560px)] max-w-[560px] md:sticky md:top-0">
                    <div className="w-full relative shadow-2xl rounded-xl border border-white/5 bg-card/40 backdrop-blur-xl p-2 lg:p-4">
                        <ChessBoard
                            fen={currentFen}
                            orientation={orientation}
                            size="540px"
                            thinFrame
                            interactive={false}
                            allowDrag={true}
                            onPieceDrop={handlePieceDrop}
                            onSquareClick={handleSquareClick}
                        />
                    </div>

                    {/* Quick Board Actions */}
                    <div className="flex justify-between items-center w-full gap-3">
                        <button
                            onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}
                            className="flex-1 py-3 bg-card border border-white/5 hover:bg-accent text-foreground text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                        >
                            <ArrowRightLeft size={14} className="rotate-90" /> Flip Board
                        </button>
                        <button
                            onClick={resetToStarting}
                            className="flex-1 py-3 bg-card border border-white/5 hover:bg-accent text-foreground text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                        >
                            <RotateCcw size={14} /> Reset
                        </button>
                        <button
                            onClick={clearBoard}
                            className="flex-1 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 hover:border-red-500/20 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                        >
                            <Trash2 size={14} /> Clear
                        </button>
                    </div>
                </div>

                {/* Configurations Panel Column */}
                <div className="flex-1 min-w-0 w-full max-w-[640px] flex flex-col gap-5 bg-card/40 backdrop-blur-xl border border-white/5 p-4 lg:p-6 rounded-2xl shadow-xl">
                    {/* 1. Piece Palette */}
                    <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Piece Palette</h3>
                        <p className="text-xs text-muted-foreground mb-4">Click a piece to stamp it on the board, or drag it directly.</p>

                        <div className="grid grid-cols-2 gap-4">
                            {/* White Pieces */}
                            <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest block mb-2 text-center">White Pieces</span>
                                <div className="grid grid-cols-3 gap-2">
                                    {palettePieces.map((p) => {
                                        const isSelected = selectedPiece && selectedPiece.type === p && selectedPiece.color === 'w';
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => selectPiece(p, 'w')}
                                                draggable
                                                onDragStart={(e) => handleDragStartPalette(e, { type: p, color: 'w' })}
                                                className={`aspect-square p-1.5 rounded-xl border transition-all hover:scale-105 active:scale-95 flex items-center justify-center cursor-grab active:cursor-grabbing ${isSelected ? 'bg-primary/20 border-primary shadow-[0_0_12px_hsl(var(--primary)/0.25)]' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}`}
                                            >
                                                <PieceIcon type={p} color="w" className="w-full h-full drop-shadow" />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Black Pieces */}
                            <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest block mb-2 text-center">Black Pieces</span>
                                <div className="grid grid-cols-3 gap-2">
                                    {palettePieces.map((p) => {
                                        const isSelected = selectedPiece && selectedPiece.type === p && selectedPiece.color === 'b';
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => selectPiece(p, 'b')}
                                                draggable
                                                onDragStart={(e) => handleDragStartPalette(e, { type: p, color: 'b' })}
                                                className={`aspect-square p-1.5 rounded-xl border transition-all hover:scale-105 active:scale-95 flex items-center justify-center cursor-grab active:cursor-grabbing ${isSelected ? 'bg-primary/20 border-primary shadow-[0_0_12px_hsl(var(--primary)/0.25)]' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}`}
                                            >
                                                <PieceIcon type={p} color="b" className="w-full h-full drop-shadow" />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Eraser Tool */}
                        <button
                            onClick={toggleEraser}
                            className={`w-full mt-3 py-3 border rounded-xl font-bold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer ${eraserActive ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]' : 'bg-white/5 hover:bg-white/10 border-white/5 text-muted-foreground hover:text-white'}`}
                        >
                            <Eraser size={14} /> {eraserActive ? 'Eraser Active' : 'Select Eraser'}
                        </button>
                    </div>

                    {/* 2. Board Configurations */}
                    <div className="border-t border-white/5 pt-5 grid grid-cols-2 gap-4">
                        {/* Who is to Move */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Active Color</label>
                            <div className="flex border border-white/5 bg-black/20 rounded-xl overflow-hidden p-0.5">
                                <button
                                    onClick={() => setActiveColor('w')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeColor === 'w' ? 'bg-primary text-black shadow-inner font-extrabold' : 'text-muted-foreground hover:text-white hover:bg-white/5'}`}
                                >
                                    White
                                </button>
                                <button
                                    onClick={() => setActiveColor('b')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeColor === 'b' ? 'bg-primary text-black shadow-inner font-extrabold' : 'text-muted-foreground hover:text-white hover:bg-white/5'}`}
                                >
                                    Black
                                </button>
                            </div>
                        </div>

                        {/* En Passant Selector */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">En Passant Target</label>
                            <select
                                value={enPassant}
                                onChange={(e) => setEnPassant(e.target.value)}
                                className="bg-black/20 border border-white/5 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer h-[38px]"
                            >
                                {epOptions.map(opt => (
                                    <option key={opt} value={opt} className="bg-zinc-900 text-foreground">{opt}</option>
                                ))}
                            </select>
                        </div>

                        {/* Castling Rights (Full width in grid) */}
                        <div className="col-span-2 flex flex-col gap-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Castling Eligibility</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { key: 'wK', label: 'White O-O' },
                                    { key: 'wQ', label: 'White O-O-O' },
                                    { key: 'bK', label: 'Black O-O' },
                                    { key: 'bQ', label: 'Black O-O-O' }
                                ].map((item) => (
                                    <label
                                        key={item.key}
                                        className={`flex items-center justify-center gap-2 border py-2.5 px-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${castlingRights[item.key] ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-black/10 border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground'}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={castlingRights[item.key]}
                                            onChange={(e) => setCastlingRights(prev => ({ ...prev, [item.key]: e.target.checked }))}
                                            className="hidden"
                                        />
                                        {item.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 3. FEN Loading & Copying */}
                    <div className="border-t border-white/5 pt-5 flex flex-col gap-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">FEN Position String</label>
                        <div className="flex gap-2 w-full">
                            <input
                                type="text"
                                value={fenInput}
                                onChange={handleFenInputChange}
                                className={`flex-1 bg-black/25 border font-mono text-xs rounded-xl px-4 py-3 text-foreground focus:outline-none transition-all ${fenError ? 'border-red-500/50 text-red-400 focus:border-red-500 bg-red-900/5' : 'border-white/5 focus:border-primary/50'}`}
                                placeholder="Paste standard FEN position here..."
                            />
                            <button
                                onClick={copyToClipboard}
                                className="px-4 bg-card hover:bg-accent border border-white/5 text-foreground rounded-xl transition-all flex items-center justify-center shrink-0 cursor-pointer shadow"
                                title="Copy FEN"
                            >
                                {copied ? <Check size={16} className="text-primary animate-pulse" /> : <Copy size={16} />}
                            </button>
                        </div>
                        {fenError && <p className="text-[10px] text-red-400 font-semibold">Malformed FEN syntax. Please enter a valid FEN string.</p>}
                    </div>

                    {/* 4. Main Send Action */}
                    <div className="border-t border-white/5 pt-5 mt-auto">
                        <button
                            onClick={() => onAnalyzePosition(currentFen, true)}
                            className="w-full py-4 bg-gradient-to-r from-primary to-primary2 hover:brightness-110 text-black font-extrabold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_hsl(var(--primary)/0.2)]"
                        >
                            <Play size={16} className="fill-black" /> Load into Game Analysis
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
