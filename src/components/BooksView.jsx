import React, { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { BookOpen, FolderOpen, Plus, Trash2, ArrowLeft, RotateCcw, ChevronLeft } from 'lucide-react';
import { ChessBoard } from './ChessBoard';

// Opening books (Polyglot .bin): see what's installed, add and remove books, and explore a
// book move by move from the starting position.

const START = new Chess().fen();
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function BooksView() {
    const [books, setBooks] = useState([]);
    const [info, setInfo] = useState({}); // path -> book-info result
    const [open, setOpen] = useState(null); // book being explored
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        if (!window.electronAPI) return;
        const list = (await window.electronAPI.scanBooks()) || [];
        setBooks(list);
        const entries = await Promise.all(list.map((b) => window.electronAPI.invoke('book-info', { path: b.path }).then((r) => [b.path, r])));
        setInfo(Object.fromEntries(entries));
    };

    useEffect(() => {
        refresh();
        window.addEventListener('refresh-engines', refresh);
        return () => window.removeEventListener('refresh-engines', refresh);
    }, []);

    const addBooks = async () => {
        const files = await window.electronAPI.invoke('pick-book-files');
        if (!files || !files.length) return;
        setBusy(true);
        const failed = [];
        for (const f of files) {
            const r = await window.electronAPI.installBook(f);
            if (!r || !r.success) failed.push(r ? r.error : f);
        }
        setBusy(false);
        if (failed.length) alert('Could not add: ' + failed.join('\n'));
        refresh();
    };

    const removeBook = async (book) => {
        if (!window.confirm(`Delete ${book.name} from the books folder?\n\nTournaments and Elo runs that use it will need another book.`)) return;
        const r = await window.electronAPI.invoke('remove-book', book.path);
        if (!r || !r.success) alert('Could not delete the book: ' + (r ? r.error : 'unknown error'));
        if (open && open.path === book.path) setOpen(null);
        refresh();
    };

    if (open) return <BookExplorer book={open} onBack={() => setOpen(null)} />;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground max-w-2xl">
                    Polyglot (.bin) books give engines their opening moves in tournaments, Quick Match and Elo runs, and mark book moves in Game Review. Drop a .bin file anywhere in the window to add it too.
                </p>
                <div className="flex items-center gap-2">
                    <button onClick={addBooks} disabled={busy} className="px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                        <Plus size={16} /> Add book
                    </button>
                    <button onClick={() => window.electronAPI.invoke('open-books-folder')} className="px-4 py-2.5 bg-card hover:bg-accent border border-white/5 rounded-xl text-sm font-medium flex items-center gap-2">
                        <FolderOpen size={16} /> Open folder
                    </button>
                </div>
            </div>

            {books.length === 0 ? (
                <div className="h-56 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl bg-card/50 text-center px-6">
                    <BookOpen className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground">No opening books yet.</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Add a Polyglot .bin book with the button above, or drop one on the window.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {books.map((b) => {
                        const i = info[b.path];
                        const top = i && i.ok ? i.moves.slice(0, 4) : [];
                        return (
                            <div
                                key={b.path}
                                onClick={() => setOpen(b)}
                                className="group p-5 rounded-2xl bg-card border border-white/5 hover:border-primary/50 transition-all cursor-pointer flex flex-col gap-3"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                                        <BookOpen size={20} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="font-bold text-foreground truncate" title={b.path}>{b.name.replace(/\.bin$/i, '')}</h4>
                                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                            {i && i.ok ? `${i.entries.toLocaleString()} positions · ${fmtSize(i.size)}` : i && !i.ok ? 'Could not read this book' : 'Reading…'}
                                        </p>
                                    </div>
                                    {i && i.removable && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeBook(b);
                                            }}
                                            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete this book"
                                            aria-label={`Delete ${b.name}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">First moves</p>
                                    {top.length === 0 ? (
                                        <p className="text-xs text-muted-foreground/70">{i && i.ok ? 'No moves from the starting position (it may start later in the game).' : '–'}</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {top.map((m) => (
                                                <div key={m.uci} className="flex items-center gap-2 text-xs">
                                                    <span className="w-10 font-mono font-bold text-foreground">{m.san}</span>
                                                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                                        <div className="h-full bg-primary/70" style={{ width: `${Math.max(2, m.pct)}%` }} />
                                                    </div>
                                                    <span className="w-10 text-right font-mono text-muted-foreground">{m.pct.toFixed(0)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <p className="text-[11px] text-primary/80 mt-auto">Explore the book →</p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// walk through a book: the board, the book's moves for this position and how often it plays them
function BookExplorer({ book, onBack }) {
    const [line, setLine] = useState([]); // SAN moves played from the start
    const [data, setData] = useState(null);
    const game = new Chess();
    for (const san of line) game.move(san);
    const fen = game.fen();

    useEffect(() => {
        let alive = true;
        setData(null);
        window.electronAPI.invoke('book-info', { path: book.path, fen }).then((r) => alive && setData(r));
        return () => {
            alive = false;
        };
    }, [fen, book.path]);

    const play = (san) => setLine((l) => [...l, san]);
    const history = game.history({ verbose: true });
    const last = history.length ? history[history.length - 1] : null;
    const moves = data && data.ok ? data.moves : [];

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <button onClick={onBack} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2">
                    <ArrowLeft size={14} /> All books
                </button>
                <h3 className="font-bold text-lg truncate">{book.name.replace(/\.bin$/i, '')}</h3>
            </div>
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full max-w-[520px] aspect-square">
                    <ChessBoard
                        fen={fen}
                        size="100%"
                        lastMove={last ? last.from + last.to : null}
                        arrows={moves.slice(0, 3).map((m, i) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: `hsl(var(--primary) / ${0.85 - i * 0.25})` }))}
                    />
                </div>
                <div className="flex-1 min-w-0 w-full bg-card border border-white/5 rounded-2xl p-4 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground font-mono truncate">
                            {line.length ? line.map((san, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${san}`).join(' ') : 'Starting position'}
                        </div>
                        <div className="flex gap-1 shrink-0">
                            <button onClick={() => setLine((l) => l.slice(0, -1))} disabled={!line.length} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30" title="Back one move" aria-label="Back one move">
                                <ChevronLeft size={14} />
                            </button>
                            <button onClick={() => setLine([])} disabled={!line.length} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30" title="Back to the start" aria-label="Back to the start">
                                <RotateCcw size={14} />
                            </button>
                        </div>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Book moves {game.turn() === 'w' ? 'for White' : 'for Black'}</p>
                        {!data ? (
                            <p className="text-sm text-muted-foreground">Reading…</p>
                        ) : moves.length === 0 ? (
                            <p className="text-sm text-muted-foreground">The book has no moves here: this is where it ends and the engines take over.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {moves.map((m) => (
                                    <button key={m.uci} onClick={() => play(m.san)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-black/20 hover:bg-primary/10 border border-white/5 hover:border-primary/30 text-left transition-colors">
                                        <span className="w-14 font-mono font-bold text-foreground">{m.san}</span>
                                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                                            <div className="h-full bg-primary/70" style={{ width: `${Math.max(2, m.pct)}%` }} />
                                        </div>
                                        <span className="w-14 text-right font-mono text-xs text-muted-foreground">{m.pct.toFixed(1)}%</span>
                                        <span className="w-14 text-right font-mono text-[10px] text-muted-foreground/60">w {m.weight}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {data && data.ok && <p className="text-[11px] text-muted-foreground">{data.entries.toLocaleString()} positions in this book. Percentages are how often the book picks each move.</p>}
                </div>
            </div>
        </div>
    );
}
