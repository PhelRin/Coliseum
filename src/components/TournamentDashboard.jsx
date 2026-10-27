import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Square, Download, Crown, Swords, Clock, ArrowLeft, Activity, ListOrdered, GitMerge, Medal } from 'lucide-react';
import { LiveGameCard } from './live/LiveGameCard';
import { useLiveGames, useNow } from './live/useLive';
import { FORMATS } from './TournamentSetup';

const fmtPts = (x) => (x === undefined || x === null ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const resultText = (w) => (w === 'white' ? '1-0' : w === 'black' ? '0-1' : w === 'draw' ? '½-½' : '–');

function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function EloBadge({ elo, error, small = false }) {
    if (elo === undefined || elo === null || !Number.isFinite(elo)) return <span className="text-muted-foreground font-mono text-xs">–</span>;
    const v = Math.round(elo);
    const cls = v > 0 ? 'text-primary' : v < 0 ? 'text-red-400' : 'text-muted-foreground';
    return (
        <span className={`font-mono tabular-nums ${small ? 'text-xs' : 'text-sm'} ${cls}`}>
            {v > 0 ? '+' : ''}{v}
            {error !== null && error !== undefined && Number.isFinite(error) && <span className="text-muted-foreground text-[0.85em]"> ±{Math.round(error)}</span>}
        </span>
    );
}

// a horizontal bar centred on 0 that shows an Elo difference and its error margin
export function EloBar({ elo, error, range = 400 }) {
    if (elo === undefined || elo === null || !Number.isFinite(elo)) return <div className="h-2 rounded-full bg-white/5" />;
    const clamp = (x) => Math.max(-range, Math.min(range, x));
    const pos = (x) => ((clamp(x) + range) / (2 * range)) * 100;
    const lo = Number.isFinite(error) ? pos(elo - error) : pos(elo);
    const hi = Number.isFinite(error) ? pos(elo + error) : pos(elo);
    return (
        <div className="relative h-2 rounded-full bg-white/5 overflow-hidden">
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20" />
            <div className={`absolute top-0 bottom-0 ${elo >= 0 ? 'bg-primary/25' : 'bg-red-500/25'}`} style={{ left: `${lo}%`, width: `${Math.max(0.5, hi - lo)}%` }} />
            <div className={`absolute top-0 bottom-0 w-1 rounded-full ${elo >= 0 ? 'bg-primary' : 'bg-red-400'}`} style={{ left: `calc(${pos(elo)}% - 2px)` }} />
        </div>
    );
}

export function WDL({ w, d, l }) {
    return (
        <span className="font-mono text-xs tabular-nums whitespace-nowrap">
            <span className="text-primary">{w}</span>
            <span className="text-muted-foreground/50"> / </span>
            <span className="text-muted-foreground">{d}</span>
            <span className="text-muted-foreground/50"> / </span>
            <span className="text-red-400">{l}</span>
        </span>
    );
}

export function TournamentDashboard({ onExit }) {
    const [snap, setSnap] = useState(null);
    const [ended, setEnded] = useState(null); // null | 'finished' | 'stopped'
    const [featuredSlot, setFeaturedSlot] = useState(null);
    const [endedAt, setEndedAt] = useState(null);
    const [warning, setWarning] = useState(null);
    const live = useLiveGames('tournament-game');
    const now = useNow(250);

    useEffect(() => {
        if (!window.electronAPI) return undefined;
        let alive = true;
        const offs = [
            window.electronAPI.on('tournament-warning', (msg) => setWarning(String(msg || ''))),
            window.electronAPI.on('tournament-update', (d) => {
                if (d && d.config) setSnap(d);
                if (d && d.finished) setEnded('finished');
            }),
            window.electronAPI.on('tournament-finished', (d) => {
                if (d && d.config) setSnap(d);
                setEndedAt((t) => t || (d && d.finishedAt) || Date.now());
                setEnded(d && d.cancelled ? 'stopped' : 'finished');
            }),
        ];
        window.electronAPI.getTournamentState().then((s) => {
            if (!alive || !s || !s.config) return;
            setSnap((cur) => cur || s);
            if (s.finished) setEnded('finished');
            else if (!s.active) setEnded((e) => e || 'stopped');
        });
        return () => {
            alive = false;
            offs.forEach((f) => f && f());
        };
    }, []);

    const cfg = snap && snap.config;
    const concurrency = (cfg && cfg.concurrency) || 1;

    // the boards: one per slot, from the live events (names filled in from the snapshot)
    const boards = useMemo(() => {
        if (!snap) return [];
        const out = [];
        for (let s = 0; s < concurrency; s++) {
            const playing = snap.games.find((g) => g.status === 'playing' && g.slot === s);
            const l = live[s];
            // l.gameId is missing when this screen opened mid-game and missed the 'assigned' event
            if (playing && (!l || (l.gameId !== undefined && l.gameId !== playing.id))) {
                out.push({ slot: s, gameId: playing.id, matchId: playing.matchId, white: playing.white, black: playing.black, status: 'starting', info: { w: {}, b: {} }, fen: null });
            } else if (l) {
                out.push({ ...l, gameId: l.gameId ?? (playing && playing.id), matchId: l.matchId ?? (playing && playing.matchId), white: l.white || (playing && playing.white), black: l.black || (playing && playing.black) });
            }
        }
        return out;
    }, [snap, live, concurrency]);

    if (!snap || !cfg) {
        return <div className="p-10 text-center text-muted-foreground animate-pulse">Loading tournament…</div>;
    }

    const fmt = FORMATS[cfg.type] || FORMATS.round_robin;
    const isKnockout = cfg.type === 'elimination' || cfg.type === 'double_elimination';
    const p = snap.progress || {};
    const pct = p.totalGames ? Math.min(100, (p.games / p.totalGames) * 100) : 0;
    const featured = boards.find((b) => b.slot === featuredSlot) || boards.find((b) => b.status === 'playing') || boards[0];
    const others = boards.filter((b) => b !== featured);
    const matchOf = (b) => b && snap.matches[b.matchId];
    const labelFor = (b) => {
        if (cfg.type === 'sprt') return b && b.gameId !== undefined ? `SPRT · game ${b.gameId}` : 'SPRT';
        const m = matchOf(b);
        if (!m) return null;
        const idx = m.games ? m.games.indexOf(b.gameId) : -1;
        return `${m.round || `Match ${m.label}`}${idx >= 0 ? ` · game ${idx + 1}` : ''}`;
    };
    const isOver = ended !== null || snap.finished;

    const exportPgn = async () => {
        const pgn = await window.electronAPI.invoke('get-tournament-pgn');
        if (!pgn) return;
        const filePath = await window.electronAPI.dialogSaveFile({ defaultPath: `coliseum_${cfg.type}_${new Date().toISOString().slice(0, 10)}.pgn`, filters: [{ name: 'PGN Files', extensions: ['pgn'] }] });
        if (filePath) await window.electronAPI.saveFileContent(filePath, pgn);
    };

    const recent = snap.sprt
        ? (snap.sprt.recent || []).map((r, i) => ({ id: `s${i}`, white: { name: r.white }, black: { name: r.black }, result: { winner: r.winner, reason: r.reason } }))
        : snap.games.filter((g) => g.status === 'done' && g.result).slice(-14).reverse();

    return (
        <div className="space-y-5 pb-16">
            {/* header */}
            <div className="bg-card border border-white/5 rounded-2xl p-4 lg:p-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <fmt.icon size={20} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-bold text-lg text-foreground leading-tight">
                                {fmt.title}
                                {cfg.type === 'gauntlet' && snap.standings?.gauntlet && <span className="text-muted-foreground font-normal"> · {snap.standings.gauntlet.hero.name}</span>}
                                {cfg.type === 'sprt' && <span className="text-muted-foreground font-normal"> · {cfg.engines[0]?.name} vs {cfg.engines[1]?.name}</span>}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                {cfg.engines.length} engines · {tcLabel(cfg.settings)} · {concurrency} at a time
                                {cfg.type === 'swiss' && p.totalRounds ? ` · round ${p.round} of ${p.totalRounds}` : ''}
                            </p>
                        </div>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-muted-foreground">
                                {p.games} of {isKnockout && !isOver ? '≥' : cfg.type === 'sprt' ? 'up to ' : ''}{p.totalGames} games
                            </span>
                            <span className="text-muted-foreground font-mono flex items-center gap-1"><Clock size={11} /> {fmtDuration((isOver ? snap.finishedAt || endedAt || now : now) - snap.startedAt)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={exportPgn} disabled={!p.games} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2 disabled:opacity-30">
                            <Download size={14} /> PGN
                        </button>
                        {isOver ? (
                            <button onClick={onExit} className="px-3 py-2 rounded-xl bg-primary text-black font-bold text-sm flex items-center gap-2">
                                <ArrowLeft size={14} /> Lobby
                            </button>
                        ) : (
                            <button onClick={() => window.electronAPI.stopTournament()} className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm font-bold flex items-center gap-2" title="Stops now. You can resume it from the lobby.">
                                <Square size={12} className="fill-current" /> Stop
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {(warning || snap.warning) && <div className="text-sm text-yellow-200 bg-yellow-500/10 border border-yellow-500/25 rounded-xl px-4 py-3">{warning || snap.warning}</div>}

            {isOver && <ResultBanner snap={snap} stopped={ended === 'stopped'} />}

            {snap.sprt && <SprtCard s={snap.sprt} names={[cfg.engines[0]?.name, cfg.engines[1]?.name]} />}

            {/* live games: the featured board, the others beside it */}
            {!isOver && (
                <div className="flex flex-col md:[@media(min-aspect-ratio:1/1)]:flex-row gap-4 items-start">
                    <div className="h-[clamp(340px,calc(100vh-230px),780px)] aspect-[0.87] max-w-full shrink-0">
                        {featured ? (
                            <LiveGameCard game={featured} now={now} big label={labelFor(featured)} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-card rounded-2xl border border-white/5">Waiting for the next game…</div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0 w-full space-y-4">
                        {others.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:[@media(min-aspect-ratio:1/1)]:grid-cols-2 2xl:grid-cols-3 gap-3">
                                {others.map((b) => (
                                    <LiveGameCard key={b.slot} game={b} now={now} onClick={() => setFeaturedSlot(b.slot)} label={labelFor(b)} />
                                ))}
                            </div>
                        )}
                        <RecentGames games={recent.slice(0, others.length ? 6 : 12)} />
                    </div>
                </div>
            )}

            {/* standings */}
            <div className="space-y-5 min-w-0">
                {cfg.type === 'gauntlet' && snap.standings?.gauntlet && <GauntletTable g={snap.standings.gauntlet} />}
                {(cfg.type === 'round_robin' || cfg.type === 'swiss') && <StandingsTable rows={snap.standings.rows} type={cfg.type} />}
                {cfg.type === 'round_robin' && cfg.engines.length <= 12 && <CrossTable rows={snap.standings.rows} />}
                {isKnockout && <Bracket matches={snap.matches} champion={snap.standings.champion} />}
                {isOver && <RecentGames games={recent} />}
            </div>
        </div>
    );
}

function tcLabel(s) {
    if (!s) return '';
    if (s.movetime) return s.movetime >= 1000 ? `${+(s.movetime / 1000).toFixed(2)} s/move` : `${s.movetime} ms/move`;
    if (s.depth) return `depth ${s.depth}`;
    if (s.nodes) return `${Number(s.nodes).toLocaleString()} nodes`;
    if (s.type === 'unlimited') return 'unlimited';
    const base = s.initial >= 60000 ? `${+(s.initial / 60000).toFixed(1)}` : `${+(s.initial / 1000).toFixed(1)}s`;
    return `${base}+${+((s.inc || 0) / 1000).toFixed(1)}`;
}

function Card({ title, icon, right, children, pad = true }) {
    return (
        <div className="bg-card border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 bg-black/10">
                <h3 className="font-bold text-sm flex items-center gap-2 text-foreground">{icon} {title}</h3>
                {right}
            </div>
            <div className={pad ? 'p-4' : ''}>{children}</div>
        </div>
    );
}

function ResultBanner({ snap, stopped }) {
    const cfg = snap.config;
    const st = snap.standings || {};
    let title = null;
    let sub = null;
    const sp = snap.sprt;
    if (stopped) {
        title = cfg.type === 'sprt' ? 'SPRT stopped' : 'Tournament stopped';
        sub = 'Games played so far are below. You can resume it from the lobby.';
    } else if (sp) {
        const [a, b] = cfg.engines.map((e) => e.name);
        title = sp.result === 'H1' ? `H1 accepted: ${a} is stronger than ${b}` : sp.result === 'H0' ? `H0 accepted: ${a} is not ${sp.elo1} Elo stronger than ${b}` : `No decision after ${sp.games} games`;
        sub = Number.isFinite(sp.elo) ? `Elo ${fmtElo(sp.elo)} (95%: ${fmtElo(sp.eloLow)} to ${fmtElo(sp.eloHigh)}) · LLR ${(sp.llr || 0).toFixed(2)} · ${sp.games} games` : null;
    } else if (cfg.type === 'gauntlet' && st.gauntlet) {
        const h = st.gauntlet.hero;
        title = `${h.name} scored ${fmtPts(h.points)} / ${h.played}`;
        sub = st.gauntlet.performance ? `Performance rating ${Math.round(st.gauntlet.performance)}` : null;
    } else if (st.champion) {
        title = `${st.champion.name} wins the ${(FORMATS[cfg.type] || {}).title || 'tournament'}`;
    } else if (st.rows && st.rows[0]) {
        title = `${st.rows[0].name} wins with ${fmtPts(st.rows[0].points)} points`;
    }
    const failed = !stopped && sp && sp.result === 'H0';
    const neutral = !stopped && sp && sp.result !== 'H1' && sp.result !== 'H0';
    return (
        <div className={`rounded-2xl p-5 border flex items-center gap-4 ${stopped || neutral ? 'bg-yellow-500/10 border-yellow-500/20' : failed ? 'bg-gradient-to-r from-red-500/15 to-transparent border-red-500/25' : 'bg-gradient-to-r from-primary/15 to-transparent border-primary/25'}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${stopped || neutral ? 'bg-yellow-500/15' : failed ? 'bg-red-500/15' : 'bg-primary/15'}`}>
                {stopped ? <Square size={18} className="text-yellow-400 fill-current" /> : sp ? <Activity size={24} className={failed ? 'text-red-400' : neutral ? 'text-yellow-400' : 'text-primary'} /> : <Crown size={24} className="text-primary" />}
            </div>
            <div className="min-w-0">
                <div className={`text-lg font-bold truncate ${stopped ? 'text-yellow-300' : 'text-foreground'}`}>{title}</div>
                {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
            </div>
        </div>
    );
}

function GauntletTable({ g }) {
    const h = g.hero;
    return (
        <Card title="Gauntlet results" icon={<Swords size={15} className="text-primary" />} pad={false}>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-white/5">
                <MiniStat label="Score" value={`${fmtPts(h.points)} / ${h.played}`} />
                <MiniStat label="W / D / L" value={<WDL w={h.wins} d={h.draws} l={h.losses} />} />
                <MiniStat label="Elo vs field" value={<EloBadge elo={h.played ? h.elo : null} error={h.error} />} />
                <MiniStat label="Performance" value={g.performance ? Math.round(g.performance) : '–'} />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left font-semibold px-4 py-2">Opponent</th>
                            <th className="text-right font-semibold px-2 py-2 hidden sm:table-cell">Rating</th>
                            <th className="text-center font-semibold px-2 py-2">W / D / L</th>
                            <th className="text-left font-semibold px-2 py-2 hidden md:table-cell">Matches</th>
                            <th className="text-right font-semibold px-4 py-2 min-w-[160px]">{h.name} Elo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {g.opponents.map((o) => (
                            <tr key={o.path} className="border-t border-white/5">
                                <td className="px-4 py-2.5 max-w-[220px]">
                                    <div className="font-semibold text-foreground truncate" title={o.name}>{o.name}</div>
                                    <div className="text-[11px] text-muted-foreground">{fmtPts(o.points)} / {o.games} · {o.games ? Math.round((o.points / o.games) * 100) : 0}%</div>
                                </td>
                                <td className="px-2 py-2.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">{o.rating ?? '–'}</td>
                                <td className="px-2 py-2.5 text-center"><WDL w={o.wins} d={o.draws} l={o.losses} /></td>
                                <td className="px-2 py-2.5 hidden md:table-cell">
                                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                                        {o.matches.length === 0 && <span className="text-xs text-muted-foreground/50">–</span>}
                                        {o.matches.slice(-12).map((m, i) => {
                                            const [a, b] = m.split('–').map(Number);
                                            return (
                                                <span key={i} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${a > b ? 'bg-primary/15 text-primary' : a < b ? 'bg-red-500/15 text-red-400' : 'bg-white/5 text-muted-foreground'}`}>{m}</span>
                                            );
                                        })}
                                        {o.matches.length > 12 && <span className="text-[10px] text-muted-foreground">+{o.matches.length - 12}</span>}
                                    </div>
                                </td>
                                <td className="px-4 py-2.5">
                                    <div className="flex flex-col items-end gap-1">
                                        <EloBadge elo={o.games ? o.elo : null} error={o.error} small />
                                        <div className="w-full max-w-[180px]"><EloBar elo={o.games ? o.elo : null} error={o.error} /></div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-white/5">Elo is how much stronger (+) or weaker (−) {h.name} played than each opponent, with a 95% margin. The margin shrinks with more games.</p>
        </Card>
    );
}

const fmtElo = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}`);

// The SPRT at a glance: where the log-likelihood ratio sits between the two bounds, the Elo
// estimate so far and the game-pair (pentanomial) counts.
function SprtCard({ s, names }) {
    const llr = Number.isFinite(s.llr) ? s.llr : 0;
    const lower = Number.isFinite(s.lower) ? s.lower : Math.log(s.beta / (1 - s.alpha));
    const upper = Number.isFinite(s.upper) ? s.upper : Math.log((1 - s.beta) / s.alpha);
    const span = upper - lower || 1;
    const pos = Math.max(0, Math.min(100, ((llr - lower) / span) * 100));
    const zero = ((0 - lower) / span) * 100;
    const decided = s.result === 'H1' || s.result === 'H0';
    const status = s.result === 'H1' ? { text: 'H1 accepted', cls: 'bg-primary/15 text-primary border-primary/30' }
        : s.result === 'H0' ? { text: 'H0 accepted', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
            : s.result === 'limit' ? { text: 'Game limit reached', cls: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' }
                : { text: 'Running', cls: 'bg-white/5 text-muted-foreground border-white/10' };
    const maxPenta = Math.max(1, ...(s.penta || [0]));
    return (
        <Card
            title="SPRT"
            icon={<Activity size={15} className="text-primary" />}
            right={<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.text}</span>}
        >
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
                <div className="space-y-4 min-w-0">
                    <div>
                        <div className="flex items-end justify-between gap-3 mb-2">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Log-likelihood ratio</div>
                                <div className={`text-3xl font-black font-mono tabular-nums ${llr >= upper ? 'text-primary' : llr <= lower ? 'text-red-400' : 'text-foreground'}`}>{llr.toFixed(2)}</div>
                            </div>
                            <div className="text-right text-[11px] text-muted-foreground font-mono">
                                bounds {lower.toFixed(2)} … {upper.toFixed(2)}
                            </div>
                        </div>
                        <div className="relative h-3 rounded-full bg-gradient-to-r from-red-500/30 via-white/5 to-primary/30">
                            <div className="absolute top-[-3px] bottom-[-3px] w-px bg-white/30" style={{ left: `${zero}%` }} />
                            <div className={`absolute top-[-4px] w-2.5 h-5 rounded-full shadow ${decided ? (s.result === 'H1' ? 'bg-primary' : 'bg-red-400') : 'bg-white'}`} style={{ left: `calc(${pos}% - 5px)` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                            <span>H0: gain ≤ {s.elo0} Elo</span>
                            <span>H1: gain ≥ {s.elo1} Elo</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <MiniStat label="Elo" value={fmtElo(s.elo)} />
                        <MiniStat label="95% range" value={!Number.isFinite(s.elo) ? '–' : `${fmtElo(s.eloLow)} … ${fmtElo(s.eloHigh)}`} />
                        <MiniStat label="LOS" value={s.los === null || s.los === undefined ? '–' : `${(s.los * 100).toFixed(1)}%`} />
                        <MiniStat label="W / D / L" value={<WDL w={s.wdl?.w || 0} d={s.wdl?.d || 0} l={s.wdl?.l || 0} />} />
                    </div>
                </div>
                <div className="min-w-0">
                    <div className="flex items-baseline justify-between mb-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Game pairs ({s.pairs || 0})</div>
                        <div className="text-[10px] text-muted-foreground">{names[0]}'s score per pair</div>
                    </div>
                    <div className="grid grid-cols-5 gap-2 items-end h-28">
                        {(s.penta || [0, 0, 0, 0, 0]).map((c, i) => (
                            <div key={i} className="flex flex-col items-center justify-end h-full gap-1 min-w-0">
                                <span className="text-[11px] font-mono text-foreground tabular-nums">{c}</span>
                                <div className={`w-full rounded-t-md ${i < 2 ? 'bg-red-400/60' : i === 2 ? 'bg-white/20' : 'bg-primary/60'}`} style={{ height: `${Math.max(3, (c / maxPenta) * 72)}%` }} />
                                <span className="text-[10px] font-mono text-muted-foreground">{['0', '½', '1', '1½', '2'][i]}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">α {s.alpha} · β {s.beta} · up to {s.maxGames} games. Each pair is the same opening twice, colours swapped.</p>
                </div>
            </div>
        </Card>
    );
}

function MiniStat({ label, value }) {
    return (
        <div className="bg-black/20 rounded-xl px-3 py-2 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="font-bold text-foreground font-mono mt-0.5 truncate">{value}</div>
        </div>
    );
}

function StandingsTable({ rows, type }) {
    return (
        <Card title="Standings" icon={<ListOrdered size={15} className="text-primary" />} pad={false} right={<span className="text-[10px] text-muted-foreground uppercase tracking-wider">{type === 'swiss' ? 'Ties: Buchholz, then SB' : 'Ties: SB, then wins'}</span>}>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left font-semibold pl-4 pr-1 py-2 w-8">#</th>
                            <th className="text-left font-semibold px-2 py-2">Engine</th>
                            <th className="text-right font-semibold px-2 py-2">Pts</th>
                            <th className="text-center font-semibold px-2 py-2">W / D / L</th>
                            <th className="text-right font-semibold px-2 py-2 hidden sm:table-cell">%</th>
                            {type === 'swiss' && <th className="text-right font-semibold px-2 py-2" title="Buchholz: total points of opponents">BH</th>}
                            <th className="text-right font-semibold pl-2 pr-4 py-2" title="Sonneborn-Berger">SB</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={r.path} className={`border-t border-white/5 ${i === 0 && r.played ? 'bg-primary/[0.04]' : ''}`}>
                                <td className="pl-4 pr-1 py-2.5 font-mono text-xs text-muted-foreground">{i === 0 && r.played ? <Medal size={14} className="text-yellow-400" /> : i + 1}</td>
                                <td className="px-2 py-2.5 max-w-[240px]">
                                    <div className="font-semibold text-foreground truncate" title={r.name}>{r.name}</div>
                                    <div className="text-[11px] text-muted-foreground">{r.played} games</div>
                                </td>
                                <td className="px-2 py-2.5 text-right font-mono font-bold text-foreground">{fmtPts(r.points)}</td>
                                <td className="px-2 py-2.5 text-center"><WDL w={r.wins} d={r.draws} l={r.losses} /></td>
                                <td className="px-2 py-2.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">{r.played ? Math.round(r.scorePct) : 0}</td>
                                {type === 'swiss' && <td className="px-2 py-2.5 text-right font-mono text-xs text-muted-foreground">{fmtPts(r.buchholz)}</td>}
                                <td className="pl-2 pr-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{fmtPts(r.sonnebornBerger)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function CrossTable({ rows }) {
    const short = (n) => (n.length > 22 ? n.slice(0, 21) + '…' : n);
    return (
        <Card title="Cross table" icon={<Activity size={15} className="text-primary" />} pad={false}>
            <div className="overflow-x-auto">
                <table className="text-xs">
                    <thead>
                        <tr>
                            <th className="px-3 py-2" />
                            {rows.map((r, i) => (
                                <th key={r.path} className="px-2 py-2 font-mono text-muted-foreground" title={r.name}>{i + 1}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={r.path} className="border-t border-white/5">
                                <td className="px-3 py-1.5 whitespace-nowrap text-foreground" title={r.name}><span className="font-mono text-muted-foreground mr-2">{i + 1}</span>{short(r.name)}</td>
                                {rows.map((c) => {
                                    if (c.path === r.path) return <td key={c.path} className="bg-white/[0.03]" />;
                                    const v = r.vs.find((x) => x.path === c.path);
                                    if (!v || !v.games) return <td key={c.path} className="px-2 py-1.5 text-center text-muted-foreground/30">·</td>;
                                    const pct = v.points / v.games;
                                    return (
                                        <td key={c.path} className={`px-2 py-1.5 text-center font-mono ${pct > 0.5 ? 'text-primary' : pct < 0.5 ? 'text-red-400' : 'text-muted-foreground'}`} title={`${r.name} vs ${c.name}: ${fmtPts(v.points)} / ${v.games}`}>
                                            {fmtPts(v.points)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function Bracket({ matches, champion }) {
    const groups = useMemo(() => {
        const order = [];
        const by = {};
        matches.forEach((m) => {
            const b = m.bracket || 'W';
            if (!by[b]) {
                by[b] = { key: b, rounds: [], map: {} };
                order.push(b);
            }
            const g = by[b];
            if (!g.map[m.round]) {
                g.map[m.round] = { name: m.round, matches: [] };
                g.rounds.push(g.map[m.round]);
            }
            g.map[m.round].matches.push(m);
        });
        return order.map((k) => by[k]);
    }, [matches]);
    const titles = { W: groups.length > 1 ? 'Winners bracket' : 'Bracket', L: 'Losers bracket', GF: 'Grand final' };
    return (
        <Card title="Bracket" icon={<GitMerge size={15} className="text-primary" />} right={champion ? <span className="text-xs text-yellow-400 flex items-center gap-1"><Crown size={12} /> {champion.name}</span> : null}>
            <div className="space-y-5">
                {groups.map((g) => (
                    <div key={g.key}>
                        {groups.length > 1 && <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{titles[g.key] || g.key}</div>}
                        <div className="flex gap-3 overflow-x-auto pb-2">
                            {g.rounds.map((r) => {
                                const visible = r.matches.filter((m) => !(m.isGrandFinalReset && (m.skipped || (!m.resetNeeded && m.status !== 'done'))) && !(m.a && m.a.isBye && m.b && m.b.isBye));
                                if (!visible.length) return null;
                                return (
                                    <div key={r.name} className="flex flex-col gap-2 min-w-[190px] w-[190px] shrink-0">
                                        <div className="text-[11px] font-semibold text-muted-foreground truncate">{r.name}</div>
                                        <div className="flex flex-col justify-around gap-2 flex-1">
                                            {visible.map((m) => <BracketMatch key={m.id} m={m} />)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

function BracketMatch({ m }) {
    const row = (side) => {
        const e = m[side];
        const won = m.status === 'done' && m.winner === side;
        const lost = m.status === 'done' && m.winner && m.winner !== side && m.winner !== 'draw';
        const ph = e && e.isPlaceholder;
        return (
            <div className={`flex items-center gap-2 px-2.5 py-1.5 ${won ? 'bg-primary/10' : ''}`}>
                {e && e.seed && !ph && <span className="text-[9px] font-mono text-muted-foreground w-3 shrink-0">{e.seed}</span>}
                <span className={`truncate text-xs flex-1 min-w-0 ${ph || (e && e.isBye) ? 'text-muted-foreground/50 italic' : won ? 'text-primary font-semibold' : lost ? 'text-muted-foreground line-through decoration-white/20' : 'text-foreground'}`} title={e ? e.name : ''}>
                    {e ? e.name : '—'}
                </span>
                {!m.bye && m.games && m.games.length > 0 && <span className="text-xs font-mono text-foreground shrink-0">{fmtPts(m.points ? m.points[side] : 0)}</span>}
            </div>
        );
    };
    return (
        <div className={`rounded-lg border bg-black/20 overflow-hidden ${m.status === 'playing' ? 'border-primary/40' : 'border-white/5'}`}>
            {row('a')}
            <div className="h-px bg-white/5" />
            {row('b')}
            {(m.tiebreaks > 0 || m.suddenDeath > 0) && (
                <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-yellow-400/80 bg-yellow-500/5 border-t border-white/5">
                    {m.suddenDeath ? 'Sudden death' : `Tiebreak ${m.tiebreaks}`}
                </div>
            )}
        </div>
    );
}

function RecentGames({ games }) {
    if (!games.length) return null;
    return (
        <Card title="Latest games" icon={<Trophy size={15} className="text-primary" />} pad={false}>
            <div className="divide-y divide-white/5">
                {games.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 px-4 py-2 text-sm min-w-0">
                        <span className="flex-1 min-w-0 truncate text-right text-foreground" title={g.white.name}>{g.white.name}</span>
                        <span className={`font-mono text-xs px-2 py-0.5 rounded shrink-0 ${g.result.winner === 'draw' ? 'bg-white/5 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{resultText(g.result.winner)}</span>
                        <span className="flex-1 min-w-0 truncate text-foreground" title={g.black.name}>{g.black.name}</span>
                        <span className="hidden md:block w-40 truncate text-[11px] text-muted-foreground" title={g.result.reason}>{g.result.reason}</span>
                    </div>
                ))}
            </div>
        </Card>
    );
}
