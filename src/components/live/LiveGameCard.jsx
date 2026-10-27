import React from 'react';
import { ChessBoard } from '../ChessBoard';
import { useElementSize, liveClock, formatClock, formatScore, engineLabel } from './useLive';

const turnOf = (fen) => (fen && fen.split(' ')[1] === 'b' ? 'b' : 'w');

function PlayerStrip({ player, color, clock, active, result, score, depth, showScore = true }) {
    const won = result && ((result.winner === 'white' && color === 'w') || (result.winner === 'black' && color === 'b'));
    const lost = result && ((result.winner === 'white' && color === 'b') || (result.winner === 'black' && color === 'w'));
    return (
        <div className={`flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg ${active ? 'bg-white/[0.06]' : ''}`}>
            <span className={`w-3 h-3 rounded-sm shrink-0 border ${color === 'w' ? 'bg-zinc-100 border-zinc-300' : 'bg-zinc-800 border-zinc-600'}`} />
            <span className="truncate font-semibold text-sm text-foreground min-w-0" title={engineLabel(player)}>{engineLabel(player)}</span>
            {typeof player?.elo === 'number' && <span className="text-[10px] font-mono text-muted-foreground shrink-0">{player.elo}</span>}
            {result && (
                <span className={`text-[10px] font-bold px-1.5 rounded shrink-0 ${won ? 'bg-primary/20 text-primary' : lost ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-muted-foreground'}`}>
                    {won ? '1' : lost ? '0' : '½'}
                </span>
            )}
            <span className="ml-auto flex items-center gap-2 shrink-0">
                {showScore && active && score && <span className="text-[10px] font-mono text-muted-foreground">{score}{depth ? ` · d${depth}` : ''}</span>}
                {clock !== null && clock !== undefined && (
                    <span className={`font-mono text-sm tabular-nums px-1.5 rounded ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground'} ${clock !== -1 && clock < 10000 && active ? 'text-red-400' : ''}`}>
                        {formatClock(clock)}
                    </span>
                )}
            </span>
        </div>
    );
}

/**
 * One live game: names, clocks and the board. `big` sizes the board to the available space
 * (for the featured game); otherwise it fills the card width.
 */
export function LiveGameCard({ game, now, big = false, onClick, selected = false, label }) {
    const [ref, size] = useElementSize();
    const turn = turnOf(game.fen);
    const playing = game.status === 'playing';
    const wClock = liveClock(game, 'w', now);
    const bClock = liveClock(game, 'b', now);
    const wInfo = game.info?.w || {};
    const bInfo = game.info?.b || {};
    // the board: as large as fits (minus the two name strips)
    const boardPx = Math.max(120, Math.floor(Math.min(size.width, big ? size.height : size.width)));

    return (
        <div
            onClick={onClick}
            className={`flex flex-col min-w-0 rounded-2xl border bg-card/80 p-2 gap-1 transition-colors ${big ? 'h-full' : ''} ${onClick ? 'cursor-pointer hover:border-primary/40' : ''} ${selected ? 'border-primary/50 shadow-[0_0_20px_hsl(var(--primary)/0.08)]' : 'border-white/5'}`}
        >
            {label && <div className="px-2 pt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>}
            <PlayerStrip player={game.black} color="b" clock={bClock} active={playing && turn === 'b'} result={game.status === 'ended' ? game.result : null} score={formatScore(bInfo, 'b')} depth={bInfo.depth} showScore={big || size.width > 300} />
            <div ref={ref} className={`relative flex items-center justify-center min-h-0 ${big ? 'flex-1' : ''}`}>
                {game.fen ? (
                    <div style={{ width: boardPx, height: boardPx }}>
                        <ChessBoard fen={game.fen} lastMove={game.lastMove} size={`${boardPx}px`} thinFrame={boardPx < 420} />
                    </div>
                ) : (
                    <div style={{ width: boardPx, height: big ? Math.min(boardPx, 300) : boardPx }} className="flex items-center justify-center text-xs text-muted-foreground animate-pulse">
                        Starting engines…
                    </div>
                )}
                {game.status === 'ended' && game.result && (
                    <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none">
                        <span className="px-3 py-1 rounded-full bg-black/80 border border-white/10 text-xs font-bold text-foreground">
                            {game.result.winner === 'white' ? '1-0' : game.result.winner === 'black' ? '0-1' : game.result.winner === 'draw' ? '½-½' : 'Error'}
                            {game.result.reason ? <span className="font-normal text-muted-foreground"> · {game.result.reason}</span> : null}
                        </span>
                    </div>
                )}
            </div>
            <PlayerStrip player={game.white} color="w" clock={wClock} active={playing && turn === 'w'} result={game.status === 'ended' ? game.result : null} score={formatScore(wInfo, 'w')} depth={wInfo.depth} showScore={big || size.width > 300} />
        </div>
    );
}
