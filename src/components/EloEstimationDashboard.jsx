import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Play, Square, Check, Search, BookOpen, Cpu, Gauge, Anchor, ArrowLeft, Clock, ScrollText, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LiveGameCard } from './live/LiveGameCard';
import { useLiveGames, useNow } from './live/useLive';
import { Section, Field, Stepper, Segmented } from './TournamentSetup';
import { getRatingTier } from './EngineStatsModal';
import { WDL } from './TournamentDashboard';

// categorical colours for the dark surface, assigned in a fixed order and kept per engine
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const MAX_SERIES = SERIES.length;
const ROW_GRID = 'grid-cols-[24px_minmax(0,1fr)_auto] md:grid-cols-[24px_minmax(0,200px)_minmax(0,1fr)_auto]';

const SPEEDS = [
    ['fast', 'Fast', '0.1 s per move'],
    ['standard', 'Standard', '0.25 s per move'],
    ['slow', 'Slow', '1 s per move'],
];

const STORAGE_KEY = 'coliseum.eloSetup';
const loadSetup = () => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (e) {
        return {};
    }
};
const saveSetup = (s) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
};

function confidence(error, games) {
    if (!games) return { label: 'No games yet', cls: 'text-muted-foreground/60' };
    if (error === null || error === undefined || !Number.isFinite(error)) return { label: 'Needs more games', cls: 'text-muted-foreground' };
    if (error <= 35) return { label: 'Settled', cls: 'text-primary' };
    if (error <= 90) return { label: 'Getting there', cls: 'text-yellow-400' };
    return { label: 'Early estimate', cls: 'text-orange-400' };
}

function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function EloEstimationDashboard() {
    const saved = useMemo(loadSetup, []);
    const [engines, setEngines] = useState([]);
    const [career, setCareer] = useState({});
    const [selected, setSelected] = useState(saved.selected || []);
    const [search, setSearch] = useState('');
    const [speed, setSpeed] = useState(saved.speed || 'standard');
    const [concurrency, setConcurrency] = useState(saved.concurrency || 1);
    const [book, setBook] = useState(saved.book || '');
    const [books, setBooks] = useState([]);
    const [cpus, setCpus] = useState(null);
    const [anchorPath, setAnchorPath] = useState('');
    const [anchorRating, setAnchorRating] = useState(2000);
    const [anchor, setAnchor] = useState(null);
    const [status, setStatus] = useState(null);
    const [logs, setLogs] = useState([]);
    const [view, setView] = useState('setup');
    const [chartSet, setChartSet] = useState(null); // path -> colour slot
    const live = useLiveGames('elo-game');
    const now = useNow(250);

    const reloadCareer = () => window.electronAPI && window.electronAPI.getStore('engineCareerStats').then((s) => setCareer(s || {}));

    useEffect(() => {
        if (!window.electronAPI) return undefined;
        window.electronAPI.scanEngines().then((l) => setEngines(l || []));
        window.electronAPI.scanBooks().then((b) => setBooks(b || []));
        window.electronAPI.getStore('ratingAnchor').then((a) => {
            setAnchor(a || null);
            if (a) {
                setAnchorPath(a.path);
                setAnchorRating(a.rating);
            }
        });
        if (window.electronAPI.getSystemInfo) window.electronAPI.getSystemInfo().then((i) => i && setCpus(i.cpus));
        reloadCareer();
        const off = window.electronAPI.on('elo-update', (d) => {
            if (!d) return;
            if (d.logs) setLogs((l) => [...l, ...d.logs.map((m) => ({ m, t: Date.now() }))].slice(-80));
            if (d.error) setLogs((l) => [...l, { m: d.error, t: Date.now(), err: true }].slice(-80));
            if (d.leaderboard) {
                setStatus(d);
                if (d.active) setView('live');
                if (d.anchor !== undefined) setAnchor(d.anchor);
            }
        });
        window.electronAPI.getEloStatus();
        return () => off && off();
    }, []);

    useEffect(() => saveSetup({ selected, speed, concurrency, book }), [selected, speed, concurrency, book]);

    const nameOf = (e) => (career[e.path] && career[e.path].name) || e.name.replace(/\.exe$/i, '');
    const filtered = engines.filter((e) => !search || nameOf(e).toLowerCase().includes(search.toLowerCase()));
    const validSelected = selected.filter((p) => engines.some((e) => e.path === p));
    const toggle = (p) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

    const start = () => {
        const list = engines.filter((e) => validSelected.includes(e.path)).map((e) => ({ name: nameOf(e), path: e.path }));
        if (list.length < 2) return;
        setLogs([]);
        setChartSet(null);
        window.electronAPI.startElo({ engines: list, speed, concurrency, openings: book ? { mode: 'book', book } : { mode: 'builtin' } });
        setView('live');
    };

    const saveAnchor = async (clear = false) => {
        await window.electronAPI.setRatingAnchor(clear || !anchorPath ? null : { path: anchorPath, rating: Number(anchorRating) });
        const a = await window.electronAPI.getStore('ratingAnchor');
        setAnchor(a || null);
        if (clear) setAnchorPath('');
        reloadCareer();
    };

    if (view === 'live' && status) {
        return (
            <LiveView
                status={status}
                logs={logs}
                live={live}
                now={now}
                chartSet={chartSet}
                setChartSet={setChartSet}
                onBack={() => {
                    reloadCareer();
                    setView('setup');
                }}
            />
        );
    }

    const maxConc = cpus ? Math.max(1, Math.min(16, cpus)) : 8;

    return (
        <div className="space-y-6 pb-16">
            <div>
                <h2 className="text-2xl lg:text-3xl font-bold text-foreground flex items-center gap-3"><Activity className="text-primary" /> Elo Estimation</h2>
                <p className="text-muted-foreground mt-1 text-sm max-w-3xl">
                    Pick some engines and let them play each other non-stop. Every game nudges their ratings, and the ± range shows how sure the estimate is. It narrows as more games are played, so the longer it runs, the more exact it gets.
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
                <Section
                    title="Engines"
                    icon={<Cpu size={16} className="text-primary" />}
                    right={
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">{validSelected.length} selected</span>
                            <button onClick={() => setSelected(filtered.map((e) => e.path))} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10">Select all</button>
                            <button onClick={() => setSelected([])} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground">Clear</button>
                        </div>
                    }
                >
                    <div className="relative mb-3">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search engines…" className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-primary outline-none" />
                    </div>
                    {engines.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-6 text-center border border-dashed border-white/10 rounded-xl">No engines found. Add some in Local Engines.</p>
                    ) : (
                        <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                            {[...filtered]
                                .sort((a, b) => ((career[b.path] || {}).rating || 1500) - ((career[a.path] || {}).rating || 1500))
                                .map((e) => {
                                    const c = career[e.path] || {};
                                    const on = validSelected.includes(e.path);
                                    const games = (c.stats && c.stats.gameCount) || 0;
                                    const r = typeof c.rating === 'number' ? c.rating : 1500;
                                    const conf = confidence(c.ratingError, games);
                                    const tier = getRatingTier(r);
                                    return (
                                        <div key={e.path} onClick={() => toggle(e.path)} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${on ? 'bg-primary/[0.06]' : 'hover:bg-white/[0.03]'}`}>
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-white/20'}`}>{on && <Check size={13} className="text-black" strokeWidth={3} />}</div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold text-sm truncate text-foreground" title={nameOf(e)}>
                                                    {nameOf(e)}
                                                    {anchor && anchor.path === e.path && <Anchor size={11} className="inline ml-1.5 text-primary" />}
                                                </div>
                                                <div className={`text-[11px] ${conf.cls}`}>{conf.label} · {games} game{games === 1 ? '' : 's'}</div>
                                            </div>
                                            <span className={`hidden sm:inline text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${tier.badgeClass}`}>{tier.title}</span>
                                            <div className="text-right shrink-0 w-24">
                                                <div className="font-mono font-bold text-foreground">{r}</div>
                                                <div className="font-mono text-[11px] text-muted-foreground">{c.ratingError ? `± ${Math.round(c.ratingError)}` : games ? '± ?' : 'unrated'}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </Section>

                <div className="space-y-6 min-w-0 xl:sticky xl:top-0">
                    <Section title="Speed" icon={<Gauge size={16} className="text-primary" />}>
                        <div className="grid grid-cols-3 gap-2">
                            {SPEEDS.map(([k, label, sub]) => (
                                <button key={k} onClick={() => setSpeed(k)} className={`px-2 py-2 rounded-xl border text-left ${speed === k ? 'bg-primary text-black border-primary' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}>
                                    <span className="block text-sm font-bold">{label}</span>
                                    <span className={`block text-[10px] ${speed === k ? 'text-black/70' : 'text-muted-foreground'}`}>{sub}</span>
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">Faster means more games and a tighter ± sooner, but engines play a little below their best.</p>
                    </Section>

                    <Section title="Games at once" icon={<Cpu size={16} className="text-primary" />}>
                        <Stepper value={concurrency} setValue={setConcurrency} min={1} max={maxConc} />
                        <p className="text-xs text-muted-foreground mt-2">{cpus ? `Your PC has ${cpus} CPU threads; about ${Math.max(1, Math.floor(cpus / 2))} at once is comfortable.` : 'Keep this at or below half your CPU threads.'}</p>
                    </Section>

                    <Section title="Openings" icon={<BookOpen size={16} className="text-primary" />}>
                        <select value={book} onChange={async (e) => {
                            if (e.target.value === '__browse') {
                                const p = await window.electronAPI.dialogOpenFile({ filters: [{ name: 'Polyglot Book', extensions: ['bin'] }] });
                                setBook(p || '');
                            } else setBook(e.target.value);
                        }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:border-primary outline-none">
                            <option value="">No book: balanced set of 50 openings</option>
                            {books.map((b) => <option key={b.path} value={b.path}>{b.name}</option>)}
                            {book && !books.some((b) => b.path === book) && <option value={book}>{book.split(/[\\/]/).pop()}</option>}
                            <option value="__browse">Browse for a .bin book…</option>
                        </select>
                        <p className="text-xs text-muted-foreground mt-2">Each opening is played twice, once with each engine as White, so neither side gets lucky.</p>
                    </Section>

                    <Section title="Rating anchor" icon={<Anchor size={16} className="text-primary" />} right={anchor ? <span className="text-[11px] text-primary">On</span> : <span className="text-[11px] text-muted-foreground">Optional</span>}>
                        <p className="text-xs text-muted-foreground mb-3">Fix one engine you know the strength of, and every other rating is measured against it.</p>
                        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                            <select value={anchorPath} onChange={(e) => setAnchorPath(e.target.value)} className="min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-primary">
                                <option value="">No anchor</option>
                                {engines.map((e) => <option key={e.path} value={e.path}>{nameOf(e)}</option>)}
                            </select>
                            <input type="number" value={anchorRating} onChange={(e) => setAnchorRating(e.target.value)} disabled={!anchorPath} className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-primary disabled:opacity-40" />
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button onClick={() => saveAnchor(false)} disabled={!anchorPath} className="flex-1 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm disabled:opacity-30">Set anchor</button>
                            {anchor && <button onClick={() => saveAnchor(true)} className="px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5">Remove</button>}
                        </div>
                    </Section>

                    <button onClick={start} disabled={validSelected.length < 2} className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 bg-primary text-black hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed">
                        <Play size={18} className="fill-current" /> Start estimating
                    </button>
                    {validSelected.length < 2 && <p className="text-[11px] text-center text-muted-foreground -mt-4">Select at least 2 engines.</p>}
                    {status && status.session && !status.active && (
                        <button onClick={() => setView('live')} className="w-full py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 -mt-3">View last session</button>
                    )}
                </div>
            </div>
        </div>
    );
}

function LiveView({ status, logs, live, now, chartSet, setChartSet, onBack }) {
    const cfg = status.config || {};
    const session = status.session || { games: 0, timeline: [], recent: [] };
    const lb = status.leaderboard || [];
    const engines = status.engines || [];

    // colours follow the engine (session order), never its rank
    const colourSlots = useMemo(() => {
        if (chartSet) return chartSet;
        const m = {};
        engines.slice(0, MAX_SERIES).forEach((e, i) => (m[e.path] = i));
        return m;
    }, [chartSet, engines]);
    const toggleChart = (path) => {
        const cur = { ...colourSlots };
        if (cur[path] !== undefined) delete cur[path];
        else {
            const used = new Set(Object.values(cur));
            const free = [...Array(MAX_SERIES).keys()].find((i) => !used.has(i));
            if (free === undefined) return;
            cur[path] = free;
        }
        setChartSet(cur);
    };

    // the forest plot's scale
    const domain = useMemo(() => {
        let lo = Infinity, hi = -Infinity;
        lb.forEach((r) => {
            const e = Number.isFinite(r.error) ? r.error : 0;
            lo = Math.min(lo, r.rating - e);
            hi = Math.max(hi, r.rating + e);
        });
        if (!Number.isFinite(lo)) return [1300, 1700];
        const pad = Math.max(25, (hi - lo) * 0.08);
        return [Math.floor((lo - pad) / 50) * 50, Math.ceil((hi + pad) / 50) * 50];
    }, [lb]);
    const x = (v) => ((v - domain[0]) / (domain[1] - domain[0])) * 100;

    const boards = [];
    for (let s = 0; s < (cfg.concurrency || 1); s++) {
        const l = live[s];
        const cur = status.current && status.current[s];
        if (l) boards.push(cur && !l.white ? { ...l, white: cur.white, black: cur.black } : l);
    }
    const nameByPath = Object.fromEntries(lb.map((r) => [r.path, r.name]));
    const elapsed = (status.active ? now : (session.recent[0] && session.recent[0].at) || now) - (session.startedAt || now);

    return (
        <div className="space-y-5 pb-16">
            <div className="bg-card border border-white/5 rounded-2xl p-4 lg:p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Activity size={20} className={`text-primary ${status.active ? 'animate-pulse' : ''}`} />
                    </div>
                    <div>
                        <h2 className="font-bold text-lg text-foreground leading-tight">{status.active ? 'Estimating…' : 'Session finished'}</h2>
                        <p className="text-xs text-muted-foreground">{engines.length} engines · {cfg.movetime} ms per move · {cfg.concurrency} at a time · {cfg.openings && cfg.openings.mode === 'book' ? 'opening book' : 'balanced openings'}</p>
                    </div>
                </div>
                <div className="flex gap-3 flex-1 min-w-[220px]">
                    <HeadStat label="Games this session" value={session.games} />
                    <HeadStat label="Running for" value={<span className="flex items-center gap-1"><Clock size={12} />{fmtDuration(elapsed)}</span>} />
                </div>
                {status.active ? (
                    <button onClick={() => window.electronAPI.stopElo()} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm font-bold flex items-center gap-2">
                        <Square size={12} className="fill-current" /> Stop
                    </button>
                ) : (
                    <button onClick={onBack} className="px-4 py-2 rounded-xl bg-primary text-black text-sm font-bold flex items-center gap-2"><ArrowLeft size={14} /> Back to setup</button>
                )}
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 items-start">
                <div className="space-y-5 min-w-0">
                    {/* leaderboard */}
                    <div className="bg-card border border-white/5 rounded-2xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-bold text-sm text-foreground">Ratings</h3>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Info size={11} /> Bars show the likely range (95%). Overlapping bars: too close to call yet.</span>
                        </div>
                        <div className="divide-y divide-white/5">
                            {lb.map((r, i) => {
                                const err = Number.isFinite(r.error) ? r.error : null;
                                const conf = confidence(err, r.careerGames);
                                const slot = colourSlots[r.path];
                                const s = r.session || { wins: 0, draws: 0, losses: 0 };
                                return (
                                    <div key={r.path} className={`px-4 py-3 grid ${ROW_GRID} items-center gap-x-3 gap-y-2`}>
                                        <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                                        <div className="min-w-0">
                                            <button onClick={() => toggleChart(r.path)} title={slot !== undefined ? 'Hide from chart' : 'Show on chart'} className="flex items-center gap-2 min-w-0 max-w-full text-left">
                                                <span className="w-2.5 h-2.5 rounded-full shrink-0 border" style={slot !== undefined ? { background: SERIES[slot], borderColor: SERIES[slot] } : { borderColor: 'rgba(255,255,255,0.25)' }} />
                                                <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
                                                {status.anchor && status.anchor.path === r.path && <Anchor size={11} className="text-primary shrink-0" />}
                                            </button>
                                            <div className="text-[11px] text-muted-foreground mt-0.5 pl-[18px] flex flex-wrap gap-x-2">
                                                <span className={conf.cls}>{conf.label}</span>
                                                <span>{r.careerGames} games</span>
                                                {session.games > 0 && <span className="hidden sm:inline">session <WDL w={s.wins} d={s.draws} l={s.losses} /></span>}
                                            </div>
                                        </div>
                                        <div className="relative h-5 col-span-3 md:col-span-1 order-last md:order-none">
                                            <div className="absolute inset-y-2 inset-x-0 rounded-full bg-white/[0.04]" />
                                            {err !== null && (
                                                <div className="absolute inset-y-1.5 rounded-full bg-primary/20 border border-primary/30" style={{ left: `${x(r.rating - err)}%`, width: `${Math.max(1, x(r.rating + err) - x(r.rating - err))}%` }} />
                                            )}
                                            <div className="absolute top-0.5 bottom-0.5 w-1 rounded-full bg-primary" style={{ left: `calc(${x(r.rating)}% - 2px)` }} />
                                        </div>
                                        <div className="text-right w-16">
                                            <div className="font-mono font-bold text-lg leading-none text-foreground">{r.rating}</div>
                                            <div className="font-mono text-[11px] text-muted-foreground mt-1">{err !== null ? `± ${Math.round(err)}` : '± ?'}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className={`px-4 py-2 border-t border-white/5 hidden md:grid ${ROW_GRID} gap-x-3 text-[10px] font-mono text-muted-foreground`}>
                            <span />
                            <span />
                            <span className="flex justify-between"><span>{domain[0]}</span><span>{Math.round((domain[0] + domain[1]) / 2)}</span><span>{domain[1]}</span></span>
                            <span className="w-16" />
                        </div>
                    </div>

                    {/* timeline */}
                    <div className="bg-card border border-white/5 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-sm text-foreground">Rating over this session</h3>
                            <span className="text-[11px] text-muted-foreground">Click an engine’s dot above to show or hide it</span>
                        </div>
                        {session.timeline.length > 1 ? (
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={session.timeline} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
                                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="game" stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
                                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                                        <Tooltip
                                            contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                                            labelFormatter={(g) => `After game ${g}`}
                                            formatter={(v, key) => [v, nameByPath[key] || key]}
                                            itemSorter={(it) => -it.value}
                                        />
                                        {Object.entries(colourSlots).map(([path, slot]) => (
                                            <Line key={path} type="monotone" dataKey={path} stroke={SERIES[slot]} strokeWidth={2} dot={false} isAnimationActive={false} name={nameByPath[path] || path} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">The chart fills in as games finish.</div>
                        )}
                    </div>
                </div>

                <div className="space-y-5 min-w-0">
                    {status.active && (
                        boards.length ? (
                            <div className={`grid gap-3 ${boards.length === 1 ? 'grid-cols-1 max-w-[560px] mx-auto w-full' : 'grid-cols-2'}`}>
                                {boards.map((b) => <LiveGameCard key={b.slot} game={b} now={now} />)}
                            </div>
                        ) : (
                            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground bg-card rounded-2xl border border-white/5 animate-pulse">Starting engines…</div>
                        )
                    )}

                    <div className="bg-card border border-white/5 rounded-2xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
                            <ScrollText size={14} className="text-primary" />
                            <h3 className="font-bold text-sm text-foreground">Latest games</h3>
                        </div>
                        <div className="max-h-[340px] overflow-y-auto divide-y divide-white/5">
                            {session.recent.length === 0 && <p className="px-4 py-6 text-sm text-center text-muted-foreground">No games finished yet.</p>}
                            {session.recent.map((g, i) => (
                                <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm min-w-0">
                                    <span className="flex-1 min-w-0 truncate text-right text-foreground">{g.white}</span>
                                    <span className={`font-mono text-xs px-2 py-0.5 rounded shrink-0 ${g.winner === 'draw' ? 'bg-white/5 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½'}</span>
                                    <span className="flex-1 min-w-0 truncate text-foreground">{g.black}</span>
                                    <span className="hidden lg:block w-36 truncate text-[11px] text-muted-foreground" title={g.reason}>{g.reason}</span>
                                </div>
                            ))}
                        </div>
                        {logs.some((l) => l.err) && (
                            <div className="px-4 py-2 border-t border-white/5 text-xs text-red-400 space-y-1">
                                {logs.filter((l) => l.err).slice(-3).map((l, i) => <div key={i}>{l.m}</div>)}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function HeadStat({ label, value }) {
    return (
        <div className="bg-black/20 rounded-xl px-3 py-2 flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
            <div className="font-bold font-mono text-foreground">{value}</div>
        </div>
    );
}
