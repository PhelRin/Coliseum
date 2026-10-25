// Shared look & copy for Game Review move classifications.
export const CLASSIFICATIONS = {
    brilliant:   { label: 'Brilliant',   symbol: '!!', badge: 'bg-teal-500 text-white border-teal-400/40',       text: 'text-teal-400',    panel: 'bg-teal-500/10 border-teal-500/25 text-teal-400',       blurb: 'A sound sacrifice — the best move, and it gives up material.' },
    great:       { label: 'Great',       symbol: '!',  badge: 'bg-sky-500 text-white border-sky-400/40',         text: 'text-sky-400',     panel: 'bg-sky-500/10 border-sky-500/25 text-sky-400',           blurb: 'The only good move in the position.' },
    best:        { label: 'Best',        symbol: '★',  badge: 'bg-emerald-600 text-white border-emerald-500/40', text: 'text-emerald-400', panel: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', blurb: "The engine's top choice." },
    excellent:   { label: 'Excellent',   symbol: '✓',  badge: 'bg-green-500 text-white border-green-400/40',     text: 'text-green-400',   panel: 'bg-green-500/10 border-green-500/25 text-green-400',     blurb: 'Almost as good as the best move.' },
    good:        { label: 'Good',        symbol: '✓',  badge: 'bg-zinc-500 text-white border-zinc-400/40',       text: 'text-zinc-300',    panel: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-300',        blurb: 'A solid move that keeps most of the advantage.' },
    book:        { label: 'Book',        symbol: '📖', badge: 'bg-amber-700 text-white border-amber-600/40',     text: 'text-amber-300',   panel: 'bg-amber-500/10 border-amber-500/25 text-amber-300',     blurb: 'Opening theory from your opening books.' },
    forced:      { label: 'Forced',      symbol: '→',  badge: 'bg-zinc-600 text-white border-zinc-500/40',       text: 'text-zinc-400',    panel: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-400',        blurb: 'The only legal move.' },
    inaccuracy:  { label: 'Inaccuracy',  symbol: '?!', badge: 'bg-yellow-500 text-black border-yellow-400/40',   text: 'text-yellow-400',  panel: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400',  blurb: 'A slightly weaker move than available.' },
    mistake:     { label: 'Mistake',     symbol: '?',  badge: 'bg-orange-500 text-white border-orange-400/40',   text: 'text-orange-400',  panel: 'bg-orange-500/10 border-orange-500/25 text-orange-400',  blurb: 'A clear error that gives away a good part of the advantage.' },
    miss:        { label: 'Miss',        symbol: '✗',  badge: 'bg-rose-500 text-white border-rose-400/40',       text: 'text-rose-400',    panel: 'bg-rose-500/10 border-rose-500/25 text-rose-400',        blurb: "Failed to punish the opponent's mistake." },
    blunder:     { label: 'Blunder',     symbol: '??', badge: 'bg-red-600 text-white border-red-500/40',         text: 'text-red-500',     panel: 'bg-red-500/10 border-red-500/25 text-red-400',           blurb: 'A serious error that changes the evaluation drastically.' },
    // Legacy key from older reviews
    interesting: { label: 'Interesting', symbol: '!?', badge: 'bg-yellow-500 text-black border-yellow-400/40',   text: 'text-yellow-400',  panel: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400',  blurb: '' }
};

export const CLASSIFICATION_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function getClassification(key) {
    return CLASSIFICATIONS[key] || null;
}

// Format a UCI score object (side-to-move POV) from White's POV for display
export function formatScoreWhite(score, sideToMove) {
    if (!score) return '0.00';
    const raw = parseInt(score.value, 10) || 0;
    const v = sideToMove === 'b' ? -raw : raw;
    if (score.unit === 'mate') {
        if (raw === 0) return sideToMove === 'w' ? '0-1' : '1-0';
        return `${v > 0 ? '' : '-'}M${Math.abs(v)}`;
    }
    const pawns = v / 100;
    return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
