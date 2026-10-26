import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { PieceIcon } from './PieceIcons';
import { useAppearance, BOARDS } from '../appearance';
import { getClassification } from '../utils/classifications';
import { TrendingUp, Check, AlertCircle, XCircle, ThumbsUp } from 'lucide-react';

// SVG Arrow Component
const Arrow = ({ from, to, color, orientation }) => {
    // Helper to get coords (0-100)
    const getCoords = (square) => {
        const file = square.charCodeAt(0) - 97; // 0-7
        const rank = parseInt(square[1]) - 1;   // 0-7

        const x = (orientation === 'white' ? file : 7 - file) * 12.5 + 6.25;
        const y = (orientation === 'white' ? 7 - rank : rank) * 12.5 + 6.25;

        return { x, y };
    };

    const start = getCoords(from);
    const end = getCoords(to);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) return null;

    const ux = dx / len;
    const uy = dy / len;

    // Shorten the tip slightly so it doesn't overlap the center of target square
    const tipShorten = 4.5; 
    const tipX = end.x - ux * tipShorten;
    const tipY = end.y - uy * tipShorten;

    // Arrowhead geometry
    const arrowLength = 3.5;
    const arrowWidth = 1.8;

    const baseX = tipX - ux * arrowLength;
    const baseY = tipY - uy * arrowLength;

    const px = -uy;
    const py = ux;

    const leftX = baseX + px * arrowWidth;
    const leftY = baseY + py * arrowWidth;

    const rightX = baseX - px * arrowWidth;
    const rightY = baseY - py * arrowWidth;

    return (
        <g className="drop-shadow-md opacity-80">
            {/* Arrow shaft */}
            <line
                x1={start.x}
                y1={start.y}
                x2={baseX}
                y2={baseY}
                style={{ stroke: color }}
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            {/* Arrow head */}
            <polygon
                points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`}
                style={{ fill: color }}
            />
        </g>
    );
};

export function ChessBoard({ fen, lastMove, lastMoveClassification, size = '650px', orientation = 'white', onPieceDrop, onSquareClick, interactive = false, allowDrag = false, arrows = [], thinFrame = false }) {
    const [selectedSquare, setSelectedSquare] = useState(null);
    const { board: boardId } = useAppearance();
    const boardTheme = BOARDS[boardId] || BOARDS.travertine;
    const [customArrows, setCustomArrows] = useState([]);
    const [highlightedSquares, setHighlightedSquares] = useState([]);
    const [rightClickStart, setRightClickStart] = useState(null);

    // Clear highlights and user arrows when FEN changes
    useEffect(() => {
        setCustomArrows([]);
        setHighlightedSquares([]);
    }, [fen]);

    const clearDrawings = () => {
        setCustomArrows([]);
        setHighlightedSquares([]);
    };

    const handleMouseDown = (e, square) => {
        if (e.button === 2) { // Right click
            setRightClickStart(square);
        }
    };

    const handleMouseUp = (e, square) => {
        if (e.button === 2) { // Right click
            if (rightClickStart === square) {
                // Toggle square highlight
                setHighlightedSquares(prev => 
                    prev.includes(square) 
                        ? prev.filter(s => s !== square) 
                        : [...prev, square]
                );
            } else if (rightClickStart) {
                // Toggle custom arrow
                const newArrow = { from: rightClickStart, to: square, color: 'rgba(234, 179, 8, 0.85)' }; // User yellow/orange arrow
                setCustomArrows(prev => {
                    const exists = prev.find(a => a.from === newArrow.from && a.to === newArrow.to);
                    if (exists) {
                        return prev.filter(a => !(a.from === newArrow.from && a.to === newArrow.to));
                    } else {
                        return [...prev, newArrow];
                    }
                });
            }
            setRightClickStart(null);
        }
    };

    // Robust FEN parser that doesn't validate rules (allows empty board, no kings, etc)
    const getBoardFromFen = (fenStr) => {
        const board = [];
        const rows = fenStr.split(' ')[0].split('/');

        for (let r = 0; r < 8; r++) {
            const row = [];
            let file = 0;
            const fenRow = rows[r] || '8'; // Fallback

            for (let i = 0; i < fenRow.length; i++) {
                const char = fenRow[i];
                if (!isNaN(char)) {
                    const emptyCount = parseInt(char);
                    for (let j = 0; j < emptyCount; j++) {
                        row.push(null);
                        file++;
                    }
                } else {
                    const color = char === char.toUpperCase() ? 'w' : 'b';
                    const type = char.toLowerCase();
                    row.push({ type, color });
                    file++;
                }
            }
            // Fill remaining if malformed
            while (file < 8) {
                row.push(null);
                file++;
            }
            board.push(row);
        }
        return board;
    };

    const board = getBoardFromFen(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    // If orientation is black, reverse the rows and the pieces in the rows
    const displayBoard = orientation === 'white' ? board : [...board].reverse().map(row => [...row].reverse());
    const targetSquare = lastMove ? lastMove.slice(2, 4) : null;

    // --- Drag and Drop Logic ---
    const handleDragStart = (e, piece, square) => {
        if (!allowDrag && !interactive) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'piece', piece, from: square }));
        // 'copyMove' allows both operations. Browser decides usually based on modifier keys, but we force it.
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleDragOver = (e) => {
        e.preventDefault(); // Necessary to allow dropping
        // We must set dropEffect to match effectAllowed or be a subset.
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, square) => {
        e.preventDefault();
        setSelectedSquare(null);
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;

        try {
            const data = JSON.parse(dataStr);
            if (data.type === 'piece') {
                // Determine source and target
                // If it's a move on the board
                if (data.from && onPieceDrop) {
                    onPieceDrop(data.from, square);
                }
                // If it's a new piece from palette (setup mode)
                else if (data.source === 'palette' && onPieceDrop) {
                    onPieceDrop('palette', square, data.piece);
                }
            }
        } catch (err) {
            console.error("Drop error", err);
        }
    };

    const handleSquareClick = (square, piece) => {
        if (!allowDrag && !interactive) return;

        if (!interactive) {
            // Setup/Editor Mode - No Chess.js validation
            if (selectedSquare) {
                if (selectedSquare === square) {
                    setSelectedSquare(null);
                } else {
                    if (onPieceDrop) {
                        onPieceDrop(selectedSquare, square);
                    }
                    setSelectedSquare(null);
                }
            } else {
                if (piece) {
                    setSelectedSquare(square);
                }
            }
            if (onSquareClick) onSquareClick(square);
            return;
        }

        // Interactive Play Mode - Chess.js validation
        try {
            const game = new Chess(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
            const turn = game.turn();

            if (selectedSquare) {
                if (selectedSquare === square) {
                    setSelectedSquare(null); // Deselect
                } else if (piece && piece.color === turn) {
                    // If clicking another of our own pieces, check if it has exactly 1 legal move
                    const moves = game.moves({ square: square, verbose: true });
                    if (moves.length === 1) {
                        if (onPieceDrop) {
                            onPieceDrop(square, moves[0].to);
                        }
                        setSelectedSquare(null);
                    } else if (moves.length > 1) {
                        setSelectedSquare(square);
                    } else {
                        setSelectedSquare(null);
                    }
                } else {
                    if (onPieceDrop) {
                        onPieceDrop(selectedSquare, square);
                    }
                    setSelectedSquare(null);
                }
            } else {
                if (piece && piece.color === turn) {
                    // Clicking own piece: if it has exactly 1 legal move, play it immediately
                    const moves = game.moves({ square: square, verbose: true });
                    if (moves.length === 1) {
                        if (onPieceDrop) {
                            onPieceDrop(square, moves[0].to);
                        }
                        setSelectedSquare(null);
                    } else if (moves.length > 1) {
                        setSelectedSquare(square);
                    }
                } else {
                    // Clicking target square: if only 1 piece can reach it, move that piece
                    const targetMoves = game.moves({ verbose: true }).filter(m => m.to === square);
                    if (targetMoves.length === 1) {
                        if (onPieceDrop) {
                            onPieceDrop(targetMoves[0].from, square);
                        }
                        setSelectedSquare(null);
                    }
                }
            }
        } catch (err) {
            console.error("Chess.js validation error in interactive click:", err);
            setSelectedSquare(null);
        }

        if (onSquareClick) onSquareClick(square);
    };

    const getClassificationIcon = (type) => {
        const meta = getClassification(type);
        if (!meta) return null;
        const size = meta.symbol.length > 1 && meta.symbol !== '📖' ? 'text-[10px] font-extrabold' : 'text-[12px] font-bold';
        return (
            <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center border shadow-md ${meta.badge} ${size} select-none font-sans`} title={meta.label}>
                {meta.symbol}
            </div>
        );
    };

    const getPiece = (piece, square) => {
        if (!piece) return null;

        return (
            <div
                className={`
                    w-full h-full p-0.5
                    transition-transform duration-200 transform hover:scale-110 active:scale-95 cursor-grab active:cursor-grabbing relative z-10
                    drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]
                `}
                draggable={allowDrag || interactive}
                onDragStart={(e) => handleDragStart(e, piece, square)}
            >
                <PieceIcon
                    type={piece.type}
                    color={piece.color}
                    className="w-full h-full"
                />
            </div>
        );
    };

    const allArrows = [...arrows, ...customArrows];

    return (
        <div style={{ width: '100%', maxWidth: size, maxHeight: '100%', aspectRatio: '1 / 1' }} className={`mx-auto ${thinFrame ? 'border-[4px] rounded-lg' : 'border-[12px] rounded-xl'} border-card shadow-2xl bg-zinc-900 grid grid-cols-8 grid-rows-8 relative overflow-hidden select-none shrink-0`} onContextMenu={(e) => e.preventDefault()}>
            {/* Board Coordinates Overlay (Optional) */}
            <div className="absolute inset-0 pointer-events-none border border-white/5 z-20"></div>

            {/* Brain Map Overlay (Arrows) */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 z-30 pointer-events-none w-full h-full">
                {allArrows.map((arrow, i) => (
                    <Arrow key={i} {...arrow} orientation={orientation} />
                ))}
            </svg>

            {displayBoard.map((row, rIdx) =>
                row.map((piece, fIdx) => {
                    // Calculate actual rank/file based on orientation
                    const rankIdx = orientation === 'white' ? rIdx : 7 - rIdx;
                    const fileIdx = orientation === 'white' ? fIdx : 7 - fIdx;

                    const isDark = (rankIdx + fileIdx) % 2 === 1;
                    const square = String.fromCharCode(97 + fileIdx) + (8 - rankIdx);
                    const isLastMove = lastMove && (lastMove.includes(square));
                    const isTargetSquare = square === targetSquare;

                    return (
                        <div
                            key={square}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, square)}
                            onClick={() => {
                                clearDrawings();
                                handleSquareClick(square, piece);
                            }}
                            onMouseDown={(e) => handleMouseDown(e, square)}
                            onMouseUp={(e) => handleMouseUp(e, square)}
                            style={{ backgroundColor: isDark ? boardTheme.dark : boardTheme.light }}
                            className={`
                                flex items-center justify-center relative
                                ${isLastMove ? 'after:absolute after:inset-0 after:bg-primary/20 after:animate-pulse after:border-2 after:border-primary' : ''}
                                ${selectedSquare === square ? 'after:absolute after:inset-0 after:bg-yellow-400/40 after:border-2 after:border-yellow-400 z-10' : ''}
                            `}
                        >
                            {/* Coordinates - adjusted for orientation visually */}
                            {fIdx === 0 && <span className="absolute top-0.5 left-0.5 text-[8px] font-mono font-semibold" style={{ color: isDark ? boardTheme.coordDark : boardTheme.coordLight }}>{8 - rankIdx}</span>}
                            {rIdx === 7 && <span className="absolute bottom-0 right-0.5 text-[8px] font-mono font-semibold" style={{ color: isDark ? boardTheme.coordDark : boardTheme.coordLight }}>{String.fromCharCode(97 + fileIdx)}</span>}

                            {/* Classification Icon at top-right of the target square */}
                            {isTargetSquare && lastMoveClassification && (
                                <div className="absolute top-[-11px] right-[-11px] z-30 transform scale-75 md:scale-100">
                                    {getClassificationIcon(lastMoveClassification)}
                                </div>
                            )}

                            {highlightedSquares.includes(square) && (
                                <div className="absolute inset-0 bg-yellow-500/20 border-2 border-yellow-500/60 pointer-events-none z-20" />
                            )}

                            {getPiece(piece, square)}
                        </div>
                    );
                })
            )}
        </div>
    );
}
