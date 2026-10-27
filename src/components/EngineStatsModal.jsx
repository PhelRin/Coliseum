import React, { useState, useEffect } from 'react';
import { X, Trophy, Activity, RotateCcw, TrendingUp, Shield, Zap } from 'lucide-react';

export function getRatingTier(rating) {
    if (rating < 1600) return { title: 'Amateur', badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' };
    if (rating < 2000) return { title: 'Candidate', badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)] font-semibold' };
    if (rating < 2400) return { title: 'Master', badgeClass: 'bg-teal-500/10 text-teal-400 border-teal-500/20 shadow-[0_0_10px_rgba(20,184,166,0.1)] font-bold' };
    if (rating < 2800) return { title: 'Grandmaster', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.15)] font-bold' };
    return { title: 'Super GM', badgeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.25)] font-black animate-pulse' };
}

export function EngineStatsModal({ engine, onClose }) {
    const [careerStats, setCareerStats] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadStats = async () => {
        if (!engine) return;
        setLoading(true);
        if (window.electronAPI) {
            try {
                const allStats = await window.electronAPI.getStore('engineCareerStats') || {};
                const stats = allStats[engine.path];
                if (stats) {
                    setCareerStats(stats);
                } else {
                    // Default stats structure
                    setCareerStats({
                        name: engine.name,
                        path: engine.path,
                        rating: 1500,
                        ratingHistory: [
                            { timestamp: Date.now(), rating: 1500, opponent: 'Initial Setup', result: 'none' }
                        ],
                        stats: {
                            wins: 0,
                            losses: 0,
                            draws: 0,
                            asWhite: { wins: 0, losses: 0, draws: 0 },
                            asBlack: { wins: 0, losses: 0, draws: 0 },
                            totalMoves: 0,
                            gameCount: 0
                        }
                    });
                }
            } catch (e) {
                console.error("Failed to load engine stats:", e);
            }
        }
        setLoading(false);
    };

    useEffect(() => {
        loadStats();
    }, [engine]);

    const handleReset = async () => {
        if (!engine) return;
        if (window.confirm(`Are you sure you want to reset all ELO ratings and stats for ${engine.name}? This will wipe out all career history.`)) {
            if (window.electronAPI) {
                try {
                    const allStats = await window.electronAPI.getStore('engineCareerStats') || {};
                    delete allStats[engine.path];
                    await window.electronAPI.setStore('engineCareerStats', allStats);
                    loadStats();
                    window.dispatchEvent(new Event('refresh-engines'));
                } catch (e) {
                    console.error("Failed to reset engine stats:", e);
                }
            }
        }
    };

    if (!engine) return null;

    // Helper to calculate play style
    const getPlayStyle = (stats) => {
        if (!stats || stats.gameCount === 0) return 'Balanced / Universal';
        const drawRate = stats.draws / stats.gameCount;
        const winRate = stats.wins / stats.gameCount;
        if (drawRate > 0.45) return 'Solid / Defensive';
        if (winRate > 0.50 && drawRate < 0.25) return 'Tactical / Aggressive';
        if (stats.losses > stats.wins && drawRate < 0.30) return 'Experimental / Unstable';
        return 'Balanced / Universal';
    };

    // Helper to render SVG Chart
    const renderEloChart = () => {
        if (!careerStats || !careerStats.ratingHistory || careerStats.ratingHistory.length === 0) return null;
        
        const history = careerStats.ratingHistory;
        const width = 500;
        const height = 140;

        const ratings = history.map(h => h.rating);
        let minRating = Math.min(...ratings);
        let maxRating = Math.max(...ratings);

        // Enforce a visual vertical padding/spread of at least 150 Elo
        const range = maxRating - minRating;
        if (range < 150) {
            const paddingNeeded = (150 - range) / 2;
            minRating -= paddingNeeded;
            maxRating += paddingNeeded;
        } else {
            minRating -= 20;
            maxRating += 20;
        }

        const points = history.map((h, i) => {
            const x = history.length > 1 ? (i / (history.length - 1)) * (width - 40) + 20 : width / 2;
            const y = height - (((h.rating - minRating) / (maxRating - minRating)) * (height - 30) + 15);
            return { x, y, rating: h.rating, label: h.opponent };
        });

        let pathD = '';
        let fillD = '';
        if (points.length === 1) {
            pathD = `M 20,${points[0].y} L ${width - 20},${points[0].y}`;
            fillD = `M 20,${points[0].y} L ${width - 20},${points[0].y} L ${width - 20},${height} L 20,${height} Z`;
        } else {
            pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
            fillD = `${pathD} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;
        }

        return (
            <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                <defs>
                    <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" style={{ stopColor: 'hsl(var(--primary))' }} stopOpacity="0.25" />
                        <stop offset="100%" style={{ stopColor: 'hsl(var(--primary))' }} stopOpacity="0.0" />
                    </linearGradient>
                </defs>
                {/* Horizontal Guide Lines */}
                <line x1="20" y1={height * 0.25} x2={width - 20} y2={height * 0.25} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
                <line x1="20" y1={height * 0.5} x2={width - 20} y2={height * 0.5} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
                <line x1="20" y1={height * 0.75} x2={width - 20} y2={height * 0.75} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />

                {/* Shaded Area Fill */}
                <path d={fillD} fill="url(#chartGlow)" />

                {/* Line Path */}
                <path d={pathD} fill="none" style={{ stroke: 'hsl(var(--primary))' }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                {/* Data Points */}
                {points.map((p, i) => (
                    <g key={i} className="group/dot cursor-pointer">
                        <circle cx={p.x} cy={p.y} r="4" fill="#18181b" style={{ stroke: 'hsl(var(--primary))' }} strokeWidth="2" />
                        <circle cx={p.x} cy={p.y} r="8" style={{ fill: 'hsl(var(--primary))' }} opacity="0" className="hover:opacity-20 transition-opacity" />
                        {/* Tooltip on Hover */}
                        <title>{`${p.rating} ELO vs ${p.label || 'Initial'}`}</title>
                    </g>
                ))}
            </svg>
        );
    };

    const rating = careerStats ? careerStats.rating : 1500;
    const tier = getRatingTier(rating);
    const stats = careerStats ? careerStats.stats : { wins: 0, losses: 0, draws: 0, gameCount: 0, totalMoves: 0, asWhite: {}, asBlack: {} };
    const winPercentage = stats.gameCount > 0 ? (((stats.wins + stats.draws * 0.5) / stats.gameCount) * 100).toFixed(1) : '0.0';
    const averageMoves = stats.gameCount > 0 ? (stats.totalMoves / stats.gameCount).toFixed(0) : '0';

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-2xl max-h-[90vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5 bg-black/20 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/30 border border-primary/20 flex items-center justify-center text-primary font-mono font-bold text-2xl shadow-inner shadow-primary/10 shrink-0">
                            {engine.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-bold text-foreground truncate max-w-[280px]" title={engine.name}>
                                    {engine.name}
                                </h2>
                                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${tier.badgeClass}`}>
                                    {tier.title}
                                </span>
                            </div>
                            <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate opacity-60" title={engine.path}>
                                {engine.path}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                {/* Modal Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                        </div>
                    ) : (
                        <>
                            {/* Career Overview Stats Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <StatBox title="Rating" value={`${rating} ELO`} icon={<TrendingUp size={16} />} colorClass="text-primary" />
                                <StatBox title="Win Rate" value={`${winPercentage}%`} icon={<Trophy size={16} />} colorClass="text-amber-400" />
                                <StatBox title="Games Played" value={stats.gameCount} icon={<Activity size={16} />} colorClass="text-blue-400" />
                                <StatBox title="Play Style" value={getPlayStyle(stats)} icon={<Shield size={16} />} colorClass="text-purple-400" />
                            </div>

                            {/* ELO Progression Chart */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">ELO Rating Progression</h3>
                                    <span className="text-[10px] font-mono text-muted-foreground">Career Performance Curve</span>
                                </div>
                                <div className="h-40 w-full relative flex items-center justify-center">
                                    {careerStats && careerStats.ratingHistory && careerStats.ratingHistory.length <= 1 ? (
                                        <div className="text-xs text-muted-foreground text-center">
                                            No match history found. Play engine games to chart rating progression.
                                        </div>
                                    ) : (
                                        renderEloChart()
                                    )}
                                </div>
                            </div>

                            {/* Color Stats & Detailed Split */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-200 border border-zinc-400" />
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">White Performance</h4>
                                    </div>
                                    <div className="flex justify-between items-end">
                                        <div className="font-mono text-lg font-bold text-foreground">
                                            {stats.asWhite.wins || 0}W / {stats.asWhite.draws || 0}D / {stats.asWhite.losses || 0}L
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {stats.asWhite.wins + stats.asWhite.draws + stats.asWhite.losses > 0 ? (
                                                `Win Rate: ${(((stats.asWhite.wins + stats.asWhite.draws * 0.5) / (stats.asWhite.wins + stats.asWhite.draws + stats.asWhite.losses)) * 100).toFixed(0)}%`
                                            ) : (
                                                'No games played'
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col justify-between">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600" />
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Black Performance</h4>
                                    </div>
                                    <div className="flex justify-between items-end">
                                        <div className="font-mono text-lg font-bold text-foreground">
                                            {stats.asBlack.wins || 0}W / {stats.asBlack.draws || 0}D / {stats.asBlack.losses || 0}L
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {stats.asBlack.wins + stats.asBlack.draws + stats.asBlack.losses > 0 ? (
                                                `Win Rate: ${(((stats.asBlack.wins + stats.asBlack.draws * 0.5) / (stats.asBlack.wins + stats.asBlack.draws + stats.asBlack.losses)) * 100).toFixed(0)}%`
                                            ) : (
                                                'No games played'
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Game Details Split */}
                            <div className="flex justify-between items-center bg-black/20 border border-white/5 rounded-xl p-4 text-sm font-mono">
                                <span className="text-muted-foreground">Wins / Draws / Losses:</span>
                                <span className="font-bold text-foreground">
                                    <span className="text-primary">{stats.wins}W</span> / <span className="text-yellow-500">{stats.draws}D</span> / <span className="text-red-500">{stats.losses}L</span>
                                </span>
                            </div>

                            {/* Recent Match Logs */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Match Logs</h4>
                                <div className="border border-white/5 rounded-xl overflow-hidden bg-black/20 max-h-48 overflow-y-auto">
                                    {careerStats && careerStats.ratingHistory && careerStats.ratingHistory.length <= 1 ? (
                                        <div className="p-4 text-center text-xs text-muted-foreground">
                                            No games logged.
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-white/5">
                                            {careerStats.ratingHistory.slice(1).reverse().map((game, idx) => {
                                                const outcomeClass = game.result === 'win' ? 'text-primary' : game.result === 'loss' ? 'text-red-500' : 'text-yellow-500';
                                                return (
                                                    <div key={idx} className="flex justify-between items-center p-3 text-xs font-mono">
                                                        <div className="flex items-center gap-3">
                                                            <span className={`capitalize font-bold w-10 ${outcomeClass}`}>
                                                                {game.result}
                                                            </span>
                                                            <span className="text-foreground font-semibold">
                                                                vs {game.opponent}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground text-[10px]">
                                                                {new Date(game.timestamp).toLocaleDateString()}
                                                            </span>
                                                            <span className="font-bold text-foreground bg-white/5 px-2 py-0.5 rounded border border-white/10">
                                                                {game.rating} ELO
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Danger Zone */}
                            <div className="border border-red-500/20 bg-red-500/5 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-bold text-red-400 text-sm">Danger Zone</h4>
                                    <p className="text-xs text-red-200/70 mt-0.5">Resetting will erase all ELO ratings, badges, and career stats.</p>
                                </div>
                                <button
                                    onClick={handleReset}
                                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-wider border border-red-500/20 shrink-0"
                                >
                                    <RotateCcw size={14} /> Reset Statistics
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="p-6 border-t border-white/5 bg-black/20 rounded-b-2xl shrink-0 flex justify-end">
                    <button onClick={onClose} className="px-6 py-2.5 bg-primary text-black font-bold rounded-xl hover:brightness-110 active:scale-[0.99] transition-all flex items-center gap-2 shadow-[0_0_15px_hsl(var(--primary)/0.2)]">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

function StatBox({ title, value, icon, colorClass }) {
    return (
        <div className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col justify-between h-24">
            <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-bold uppercase tracking-wider">{title}</span>
                <span className={colorClass}>{icon}</span>
            </div>
            <div className={`font-bold font-mono truncate text-lg mt-2 ${colorClass}`}>
                {value}
            </div>
        </div>
    );
}
