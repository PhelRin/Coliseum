import React, { useState } from 'react';
import { Flame, Play, Square, Loader2, ArrowRight } from 'lucide-react';
import { useEas, EAS_CREDIT } from './useEas';
import { EasResults } from './EasResults';

/** Run the EAS tool on a finished tournament's games, shown on the tournament results screen. */
export function EasCard({ type, label, onOpenEas }) {
    const eas = useEas();
    const [report, setReport] = useState(null);
    const mode = type === 'gauntlet' ? 'gauntlet' : 'all';

    const run = async () => {
        const pgn = await window.electronAPI.invoke('get-tournament-pgn');
        if (!pgn) return eas.setError('No games to evaluate.');
        const rep = await eas.run({ pgn }, mode, label);
        if (rep) setReport(rep);
    };

    return (
        <div className="bg-card border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-2 bg-black/10">
                <h3 className="font-bold text-sm flex items-center gap-2 text-foreground"><Flame size={15} className="text-orange-400" /> Aggressiveness (EAS)</h3>
                {report && onOpenEas && (
                    <button onClick={() => onOpenEas(report.id)} className="text-xs text-primary flex items-center gap-1 hover:underline">
                        Full report <ArrowRight size={12} />
                    </button>
                )}
            </div>
            <div className="p-4 space-y-3">
                {!report && !eas.running && (
                    <div className="flex flex-wrap items-center gap-4">
                        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
                            {mode === 'gauntlet' ? 'Score how aggressively the main engine won its games' : 'Rank the engines by how aggressively they won'}: sacrifices, short wins and bad draws.
                        </p>
                        <button onClick={run} disabled={!eas.info || !eas.info.available} className="px-4 py-2 rounded-xl bg-primary text-black text-sm font-bold flex items-center gap-2 disabled:opacity-30">
                            <Play size={14} className="fill-current" /> Run EAS
                        </button>
                    </div>
                )}
                {eas.info && !eas.info.available && <p className="text-xs text-yellow-400">{eas.info.reason}</p>}
                {eas.running && (
                    <div className="flex items-center gap-3 text-sm">
                        <Loader2 size={14} className="animate-spin text-primary shrink-0" />
                        <span className="truncate flex-1 text-muted-foreground font-mono text-xs">{eas.lines[eas.lines.length - 1] || 'Starting the EAS tool…'}</span>
                        <button onClick={eas.cancel} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-bold flex items-center gap-1.5 shrink-0">
                            <Square size={10} className="fill-current" /> Stop
                        </button>
                    </div>
                )}
                {eas.error && <p className="text-sm text-red-400">{eas.error}</p>}
                {report && <EasResults report={report.report} compact />}
                <p className="text-[10px] text-muted-foreground/70">{EAS_CREDIT}</p>
            </div>
        </div>
    );
}
