import React, { useState } from 'react';
import { AlertTriangle, Flame } from 'lucide-react';

// the four parts of an EAS score, in a fixed order and colour
export const PARTS = [
    { key: 'sacs', label: 'Sacrifices', color: '#3987e5' },
    { key: 'earlySacs', label: 'Early sacrifices', color: '#d95926' },
    { key: 'shortWins', label: 'Short wins', color: '#199e70' },
    { key: 'badDraws', label: 'Few bad draws', color: '#c98500' },
];

export const fmtScore = (n) => (typeof n === 'number' ? n.toLocaleString('en-GB') : '–');
const pct = (n) => (typeof n === 'number' ? `${n % 1 === 0 ? n : n.toFixed(1)}%` : '–');

export function PartsLegend() {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {PARTS.map((p) => (
                <span key={p.key} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} /> {p.label}
                </span>
            ))}
        </div>
    );
}

// the score split into its parts, scaled to the highest score in the list
function PartsBar({ row, max }) {
    const [hover, setHover] = useState(null);
    const pts = row.points;
    if (!pts) return <div className="h-2.5 rounded-full bg-white/5" />;
    const total = PARTS.reduce((a, p) => a + (pts[p.key] || 0), 0) || 1;
    const width = Math.max(2, (row.eas / (max || row.eas || 1)) * 100);
    return (
        <div className="relative">
            <div className="flex h-2.5 gap-[2px]" style={{ width: `${width}%` }}>
                {PARTS.map((p) => {
                    const v = pts[p.key] || 0;
                    if (!v) return null;
                    return (
                        <div
                            key={p.key}
                            className="h-full first:rounded-l-full last:rounded-r-full"
                            style={{ width: `${(v / total) * 100}%`, background: p.color, opacity: hover && hover !== p.key ? 0.45 : 1 }}
                            onMouseEnter={() => setHover(p.key)}
                            onMouseLeave={() => setHover(null)}
                        />
                    );
                })}
            </div>
            {hover && (
                <div className="absolute -top-8 left-0 z-10 px-2 py-1 rounded-lg bg-black/90 border border-white/10 text-[11px] text-foreground whitespace-nowrap pointer-events-none">
                    {PARTS.find((p) => p.key === hover).label}: <span className="font-mono">{fmtScore(pts[hover])}</span> points
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, hint, good }) {
    return (
        <div className="min-w-0" title={hint}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
            <div className={`font-mono text-sm font-semibold ${good === false ? 'text-red-400' : 'text-foreground'}`}>{value}</div>
        </div>
    );
}

/** The engines of one EAS report, best first. compact: fewer details (tournament screen). */
export function EasResults({ report, compact = false }) {
    const rows = (report && report.rows) || [];
    if (!rows.length) return <p className="text-sm text-muted-foreground">The report has no engines in it. Check the full report below.</p>;
    const max = Math.max(...rows.map((r) => r.eas || 0));
    return (
        <div className="space-y-3">
            {!compact && <PartsLegend />}
            {rows.map((r, i) => (
                <div key={r.name} className="bg-black/20 border border-white/5 rounded-xl p-3 lg:p-4">
                    <div className="flex items-start gap-3">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-orange-500/15 text-orange-400' : 'bg-white/5 text-muted-foreground'}`}>
                            {i === 0 ? <Flame size={14} /> : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-semibold text-foreground truncate" title={r.name}>{r.name}</span>
                                {r.unreliable && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 flex items-center gap-1" title="The EAS tool needs at least 50 wins and 30 draws for a reliable score.">
                                        <AlertTriangle size={10} /> Not enough games yet
                                    </span>
                                )}
                            </div>
                            <div className="mt-2"><PartsBar row={r} max={max} /></div>
                        </div>
                        <div className="text-right shrink-0">
                            <div className="font-mono font-bold text-lg leading-none text-foreground">{fmtScore(r.eas)}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">EAS score</div>
                        </div>
                    </div>
                    <div className={`grid gap-3 mt-3 pl-10 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'}`}>
                        <Stat label="Wins with a sac" value={pct(r.sacsPct)} hint="Share of this engine's wins that contain a sacrifice" />
                        <Stat label="Early sacs" value={pct(r.earlySacsPct)} hint="Share of its sacrifices played early in the game" />
                        <Stat label="Short wins" value={pct(r.shortWinsPct)} hint="Share of its wins that were short" />
                        <Stat label="Bad draws" value={pct(r.badDrawsPct)} hint="Draws before the endgame, or after being a pawn up (fewer is better)" />
                        {!compact && <Stat label="Avg. win" value={r.avgWinMoves ? `${r.avgWinMoves} moves` : '–'} hint="Average length of its won games" />}
                        {!compact && <Stat label="Wins" value={r.wins ?? '–'} />}
                    </div>
                    {!compact && r.sacBreakdown && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pl-10">
                            {[['queen', 'Queen'], ['five', '5+ pawns'], ['four', '4 pawns'], ['three', '3 pawns'], ['two', '2 pawns'], ['one', '1 pawn']].map(([k, l]) => (
                                <span key={k} className={`text-[10px] px-2 py-0.5 rounded-md border ${r.sacBreakdown[k] ? 'bg-[#3987e5]/10 border-[#3987e5]/25 text-foreground' : 'border-white/5 text-muted-foreground/50'}`}>
                                    {l} sac <span className="font-mono">{pct(r.sacBreakdown[k])}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
