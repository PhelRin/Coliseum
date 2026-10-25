import React, { useState, useEffect } from 'react';
import { History, Download, Trash2, CalendarDays, Eye, Search } from 'lucide-react';

export function HistoryDashboard({ onAnalyzeGame }) {
    const [history, setHistory] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [outcomeFilter, setOutcomeFilter] = useState('all');
    const [lengthFilter, setLengthFilter] = useState('all');

    useEffect(() => {
        const load = async () => {
            if (window.electronAPI) {
                const data = await window.electronAPI.getStore('matchHistory');
                if (data) {
                    // Enrich with move counts parsed from PGN
                    const enriched = data.map(match => {
                        let moveCount = 0;
                        if (match.pgn) {
                            const matches = match.pgn.match(/\d+\./g);
                            if (matches && matches.length > 0) {
                                const lastMoveStr = matches[matches.length - 1];
                                moveCount = parseInt(lastMoveStr);
                            }
                        }
                        return { ...match, moveCount };
                    });
                    setHistory(enriched.reverse()); // Show newest first
                }
            }
        };
        load();
    }, []);

    const clearHistory = async () => {
        if (window.electronAPI && window.confirm("Clear all history?")) {
            await window.electronAPI.setStore('matchHistory', []);
            setHistory([]);
        }
    };

    const handleSavePgn = async (pgn, dateStr) => {
        if (!pgn || !window.electronAPI) return;
        const defaultPath = `match_${dateStr.replace(/[:.-]/g, '_')}.pgn`;
        const filePath = await window.electronAPI.dialogSaveFile({
            defaultPath,
            filters: [{ name: 'PGN Files', extensions: ['pgn'] }]
        });
        if (filePath) {
            await window.electronAPI.saveFileContent(filePath, pgn);
            alert('PGN Saved!');
        }
    };

    const filteredHistory = history.filter(match => {
        const nameMatch = match.white.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          match.black.toLowerCase().includes(searchTerm.toLowerCase());
        
        let outcomeMatch = true;
        if (outcomeFilter === 'white') outcomeMatch = match.winner === 'white';
        else if (outcomeFilter === 'black') outcomeMatch = match.winner === 'black';
        else if (outcomeFilter === 'draw') outcomeMatch = match.winner === 'draw';

        let lengthMatch = true;
        if (lengthFilter === 'short') lengthMatch = match.moveCount < 30;
        else if (lengthFilter === 'medium') lengthMatch = match.moveCount >= 30 && match.moveCount <= 60;
        else if (lengthFilter === 'long') lengthMatch = match.moveCount > 60;

        return nameMatch && outcomeMatch && lengthMatch;
    });

    return (
        <div className="space-y-4 animate-fade-in flex flex-col h-full">
            <div className="flex justify-between items-end shrink-0">
                <div>
                    <h2 className="text-3xl font-bold text-foreground">Archive</h2>
                    <p className="text-muted-foreground mt-1">Review past games and export PGNs</p>
                </div>
                {history.length > 0 && (
                    <button
                        onClick={clearHistory}
                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all flex items-center gap-2 text-sm font-bold uppercase tracking-wider border border-red-500/20 shadow-lg"
                    >
                        <Trash2 size={16} /> Clear All
                    </button>
                )}
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-4 shrink-0 bg-black/20 p-4 border border-white/5 rounded-xl">
                <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search engines by name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-black/30 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm font-medium text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all shadow-inner"
                    />
                </div>

                {/* Outcome Filter */}
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground whitespace-nowrap font-medium">Outcome:</span>
                    <select
                        value={outcomeFilter}
                        onChange={(e) => setOutcomeFilter(e.target.value)}
                        className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-foreground focus:outline-none focus:border-primary/50 cursor-pointer text-sm font-medium"
                    >
                        <option value="all">All Outcomes</option>
                        <option value="white">White Wins (1-0)</option>
                        <option value="black">Black Wins (0-1)</option>
                        <option value="draw">Draws</option>
                    </select>
                </div>

                {/* Length Filter */}
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground whitespace-nowrap font-medium">Moves:</span>
                    <select
                        value={lengthFilter}
                        onChange={(e) => setLengthFilter(e.target.value)}
                        className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-foreground focus:outline-none focus:border-primary/50 cursor-pointer text-sm font-medium"
                    >
                        <option value="all">All Lengths</option>
                        <option value="short">Short (&lt; 30 moves)</option>
                        <option value="medium">Medium (30 - 60 moves)</option>
                        <option value="long">Long (&gt; 60 moves)</option>
                    </select>
                </div>
            </div>

            {history.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-2xl bg-card/20 pb-16">
                    <History className="w-16 h-16 text-muted-foreground/20 mb-4" />
                    <p className="text-muted-foreground font-medium">No matches found in history.</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col border border-white/10 rounded-2xl bg-black/20 overflow-hidden shadow-2xl">
                    {/* Header Row */}
                    <div className="flex items-center px-6 py-3 bg-white/5 border-b border-white/10 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <div className="w-32">Date</div>
                        <div className="flex-1">White</div>
                        <div className="flex-1">Black</div>
                        <div className="w-32 text-center">Result</div>
                        <div className="w-48">Termination</div>
                        <div className="w-24 text-right">Actions</div>
                    </div>

                    {/* Table Body */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {filteredHistory.map((match, i) => {
                            const d = new Date(match.date);
                            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();

                            return (
                                <div key={i} className="flex items-center px-6 py-3 border-b border-white/5 hover:bg-white/5 transition-colors group">
                                    <div className="w-32 text-sm text-foreground">
                                        {d.toLocaleDateString()}
                                    </div>
                                    <div className={`flex-1 font-bold ${match.winner === 'white' ? 'text-primary' : 'text-foreground'}`}>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-zinc-200 border border-zinc-400" />
                                            {match.white}
                                        </div>
                                    </div>
                                    <div className={`flex-1 font-bold ${match.winner === 'black' ? 'text-primary' : 'text-foreground'}`}>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600" />
                                            {match.black}
                                        </div>
                                    </div>
                                    <div className="w-32 text-center">
                                        <span className={`px-3 py-1 rounded text-xs font-bold uppercase ${match.winner === 'draw' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-primary/20 text-primary'}`}>
                                            {match.winner === 'draw' ? 'Draw' : match.winner === 'white' ? '1-0' : '0-1'}
                                        </span>
                                    </div>
                                    <div className="w-48 text-xs text-muted-foreground flex items-center gap-2 pr-4">
                                        {match.moveCount > 0 && (
                                            <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded font-mono text-[10px] text-primary/80 shrink-0">
                                                {match.moveCount} moves
                                            </span>
                                        )}
                                        <span className="truncate">{match.reason}</span>
                                    </div>
                                    <div className="w-24 flex items-center justify-end gap-1">
                                        {match.pgn && (
                                            <>
                                                <button
                                                    onClick={() => onAnalyzeGame(match.pgn)}
                                                    className="p-2 text-muted-foreground hover:bg-primary/20 hover:text-primary rounded-lg transition-colors border border-transparent hover:border-primary/30"
                                                    title="Analyze Game"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleSavePgn(match.pgn, dateStr)}
                                                    className="p-2 text-muted-foreground hover:bg-blue-500/20 hover:text-blue-400 rounded-lg transition-colors border border-transparent hover:border-blue-500/30"
                                                    title="Download PGN"
                                                >
                                                    <Download size={18} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )
                        })}

                        {filteredHistory.length === 0 && (
                            <div className="p-8 text-center text-muted-foreground">
                                No games match your search.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
