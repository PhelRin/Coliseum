import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Users, GitMerge, Clock, Play, Settings, X, Check, FolderOpen, Search, Trash2, Swords, Repeat, Star, BookOpen, Cpu, Info, Crown } from 'lucide-react';
import { PromptModal } from './PromptModal';
import { getRatingTier } from './EngineStatsModal';

export const FORMATS = {
    gauntlet: { title: 'Gauntlet', desc: 'One main engine plays every opponent, as many matches as you like.', icon: Swords },
    round_robin: { title: 'Round Robin', desc: 'Everyone plays everyone. The fairest table.', icon: Repeat },
    swiss: { title: 'Swiss', desc: 'Rounds of pairings between engines on similar scores.', icon: Users },
    elimination: { title: 'Knockout', desc: 'Lose a match and you are out. Tiebreaks if level.', icon: Trophy },
    double_elimination: { title: 'Double Knockout', desc: 'Knockout with a second chance in a losers’ bracket.', icon: GitMerge },
};

const TIME_PRESETS = {
    bullet: { label: 'Bullet', sub: '1+0', initial: 60000, inc: 0 },
    blitz: { label: 'Blitz', sub: '3+2', initial: 180000, inc: 2000 },
    rapid: { label: 'Rapid', sub: '10+5', initial: 600000, inc: 5000 },
    custom: { label: 'Custom', sub: 'set your own' },
};

const fmtMinutes = (ms) => {
    const min = ms / 60000;
    if (min < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
    if (min < 90) return `${Math.round(min)} min`;
    const h = min / 60;
    return `${h.toFixed(h < 10 ? 1 : 0)} h`;
};

// rough length of one game for the summary (each side uses most of its clock)
function estimateGameMs(tc) {
    if (tc.movetime) return tc.movetime * 2 * 60;
    return Math.max(10000, (tc.initial * 2 + tc.inc * 2 * 50) * 0.8);
}

export function planFor(format, n, { matchesPerPairing, rounds }) {
    if (n < 2) return { matches: 0, games: 0, atLeast: false };
    if (format === 'gauntlet') return { matches: (n - 1) * matchesPerPairing, games: 2 * (n - 1) * matchesPerPairing, atLeast: false };
    if (format === 'round_robin') {
        const pairs = (n * (n - 1)) / 2;
        return { matches: pairs * matchesPerPairing, games: 2 * pairs * matchesPerPairing, atLeast: false };
    }
    if (format === 'swiss') return { matches: Math.floor(n / 2) * rounds, games: 2 * Math.floor(n / 2) * rounds, atLeast: false, byes: n % 2 ? rounds : 0 };
    if (format === 'elimination') return { matches: n - 1, games: 2 * (n - 1), atLeast: true };
    return { matches: 2 * n - 2, games: 2 * (2 * n - 2), atLeast: true };
}

export function TournamentSetup({ onStart }) {
    const [engines, setEngines] = useState([]);
    const [selected, setSelected] = useState([]); // paths
    const [hero, setHero] = useState(null);
    const [search, setSearch] = useState('');
    const [careerStats, setCareerStats] = useState({});
    const [format, setFormat] = useState('gauntlet');
    const [matchesPerPairing, setMatchesPerPairing] = useState(2);
    const [rounds, setRounds] = useState(5);
    const [order, setOrder] = useState('interleaved');
    const [tcType, setTcType] = useState('blitz');
    const [customInitial, setCustomInitial] = useState(5);
    const [customInc, setCustomInc] = useState(3);
    const [timeUnit, setTimeUnit] = useState('minutes');
    const [openingMode, setOpeningMode] = useState('builtin');
    const [book, setBook] = useState(null);
    const [installedBooks, setInstalledBooks] = useState([]);
    const [concurrency, setConcurrency] = useState(1);
    const [cpus, setCpus] = useState(null);
    const [savedTournament, setSavedTournament] = useState(null);
    const [presets, setPresets] = useState([]);
    const [showPrompt, setShowPrompt] = useState(false);
    const [showManagePresets, setShowManagePresets] = useState(false);

    const loadPresets = async () => {
        if (!window.electronAPI) return;
        const list = (await window.electronAPI.getPresets()) || [];
        setPresets(list.filter((p) => p.type === 'tournament'));
    };

    useEffect(() => {
        if (!window.electronAPI) return;
        window.electronAPI.scanEngines().then((list) => setEngines(list || []));
        window.electronAPI.getStore('engineCareerStats').then((s) => s && setCareerStats(s));
        // a tournament is already running in the background: show it instead of the lobby
        if (window.electronAPI.getTournamentState) {
            window.electronAPI.getTournamentState().then((s) => {
                if (s && s.active) onStart('RESUME');
            });
        }
        window.electronAPI.hasSavedTournament().then((s) => s && setSavedTournament(s));
        window.electronAPI.scanBooks().then((b) => setInstalledBooks(b || []));
        if (window.electronAPI.invoke) window.electronAPI.invoke('get-system-info').then((i) => i && setCpus(i.cpus));
        loadPresets();
    }, []);

    const engineName = (e) => (careerStats[e.path] && careerStats[e.path].name) || e.name.replace(/\.exe$/i, '');
    const ratingOf = (path) => (careerStats[path] && typeof careerStats[path].rating === 'number' ? careerStats[path].rating : 1500);
    const selectedEngines = engines.filter((e) => selected.includes(e.path));
    const filtered = engines.filter((e) => {
        const q = search.toLowerCase();
        return !q || engineName(e).toLowerCase().includes(q) || e.path.toLowerCase().includes(q);
    });

    // keep the main engine valid
    useEffect(() => {
        if (format !== 'gauntlet') return;
        if (!hero || !selected.includes(hero)) setHero(selected[0] || null);
    }, [format, selected, hero]);

    const toggle = (path) => setSelected((s) => (s.includes(path) ? s.filter((p) => p !== path) : [...s, path]));

    const tc = useMemo(() => {
        if (tcType === 'custom') {
            const mult = timeUnit === 'minutes' ? 60000 : 1000;
            return { type: 'custom', initial: Math.max(1, Number(customInitial) || 1) * mult, inc: Math.max(0, Number(customInc) || 0) * 1000 };
        }
        const p = TIME_PRESETS[tcType];
        return { type: tcType, initial: p.initial, inc: p.inc };
    }, [tcType, customInitial, customInc, timeUnit]);

    const plan = planFor(format, selected.length, { matchesPerPairing, rounds });
    const est = plan.games ? (plan.games * estimateGameMs(tc)) / Math.max(1, concurrency) : 0;
    const maxRounds = Math.max(1, selected.length - 1);
    const canStart = selected.length >= 2 && (format !== 'gauntlet' || !!hero) && (openingMode !== 'book' || !!book);
    const threadsHint = cpus ? Math.max(1, Math.floor(cpus / 2)) : null;

    const handleStart = () => {
        if (!canStart) return;
        const list = selectedEngines.map((e) => ({ name: engineName(e), path: e.path }));
        onStart({
            type: format,
            engines: format === 'gauntlet' ? [list.find((e) => e.path === hero), ...list.filter((e) => e.path !== hero)] : list,
            hero: format === 'gauntlet' ? hero : undefined,
            matchesPerPairing,
            rounds: Math.min(rounds, 50),
            order,
            concurrency,
            openings: openingMode === 'book' ? { mode: 'book', book } : { mode: openingMode },
            settings: tc,
        });
    };

    const savePreset = async (name) => {
        setShowPrompt(false);
        if (!window.electronAPI) return;
        await window.electronAPI.savePreset({
            name,
            type: 'tournament',
            config: { version: 2, format, matchesPerPairing, rounds, order, tcType, customInitial, customInc, timeUnit, openingMode, book, concurrency, engines: selected, hero },
        });
        loadPresets();
    };

    const loadPreset = (e) => {
        const p = presets.find((x) => x.name === e.target.value);
        if (!p || !p.config) return;
        const c = p.config;
        if (c.format && FORMATS[c.format]) setFormat(c.format);
        if (c.matchesPerPairing) setMatchesPerPairing(c.matchesPerPairing);
        if (c.rounds) setRounds(c.rounds);
        if (c.order) setOrder(c.order);
        if (c.version === 2) {
            setTcType(c.tcType || 'blitz');
            setCustomInitial(c.customInitial ?? 5);
            setCustomInc(c.customInc ?? 3);
            setTimeUnit(c.timeUnit || 'minutes');
            setOpeningMode(c.openingMode || 'builtin');
            setBook(c.book || null);
            setConcurrency(c.concurrency || 1);
            setHero(c.hero || null);
        } else {
            // presets saved by older versions
            if (c.timeControl) {
                const t = c.timeControl.type;
                if (TIME_PRESETS[t] && t !== 'custom') setTcType(t);
                else {
                    setTcType('custom');
                    setTimeUnit('seconds');
                    setCustomInitial(Math.round((c.timeControl.initial || 60000) / 1000));
                    setCustomInc(Math.round((c.timeControl.inc || 0) / 1000));
                }
            }
            if (c.commonBook) {
                setOpeningMode('book');
                setBook(c.commonBook);
            }
        }
        setSelected(engines.filter((x) => (c.engines || []).includes(x.path)).map((x) => x.path));
    };

    const browseBook = async () => {
        if (!window.electronAPI) return;
        const path = await window.electronAPI.dialogOpenFile({ filters: [{ name: 'Polyglot Book', extensions: ['bin'] }] });
        if (path) {
            setBook(path);
            setOpeningMode('book');
        }
    };

    const savedIsNew = savedTournament && Array.isArray(savedTournament.games);
    const savedDone = savedIsNew ? savedTournament.games.filter((g) => g.status === 'done').length : 0;

    return (
        <div className="space-y-6 pb-4 xl:pb-16">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl lg:text-3xl font-bold text-foreground">Create Tournament</h2>
                    <p className="text-muted-foreground mt-1 text-sm">Every match is two games from the same opening, one with each engine as White.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select onChange={loadPreset} value="" className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
                        <option value="" disabled>Load preset</option>
                        {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                    {presets.length > 0 && (
                        <button onClick={() => setShowManagePresets(true)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 rounded-xl" title="Delete presets">
                            <Trash2 size={16} />
                        </button>
                    )}
                    <button onClick={() => setShowPrompt(true)} className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm border border-white/5 text-foreground flex items-center gap-2">
                        <Settings size={14} /> Save preset
                    </button>
                </div>
            </div>

            {savedTournament && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 lg:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-yellow-400 font-bold">Unfinished tournament found</h3>
                        <p className="text-yellow-200/70 text-sm">
                            {savedIsNew
                                ? `${FORMATS[savedTournament.config.type]?.title || 'Tournament'} with ${savedTournament.config.engines.length} engines · ${savedDone} of ${savedTournament.games.length} games played.`
                                : 'It was started by an older version of Coliseum and can’t be resumed.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => {
                                window.electronAPI.clearSavedTournament();
                                setSavedTournament(null);
                            }}
                            className="px-4 py-2 hover:bg-yellow-500/10 text-yellow-500 rounded-xl text-sm font-bold"
                        >
                            Discard
                        </button>
                        {savedIsNew && (
                            <button
                                onClick={() => {
                                    window.electronAPI.resumeTournament();
                                    onStart('RESUME');
                                }}
                                className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl font-bold flex items-center gap-2"
                            >
                                <Play size={16} className="fill-current" /> Resume
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
                {/* ---------------- main column ---------------- */}
                <div className="space-y-6 min-w-0">
                    <Section title="Format" icon={<GitMerge size={16} className="text-primary" />}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {Object.entries(FORMATS).map(([key, f]) => {
                                const Icon = f.icon;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setFormat(key)}
                                        className={`text-left p-4 rounded-xl border transition-all flex gap-3 ${format === key ? 'bg-primary/10 border-primary/40 shadow-[0_0_15px_rgba(74,222,128,0.08)]' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
                                    >
                                        <Icon size={20} className={format === key ? 'text-primary shrink-0 mt-0.5' : 'text-muted-foreground shrink-0 mt-0.5'} />
                                        <span className="min-w-0">
                                            <span className={`block font-bold ${format === key ? 'text-primary' : 'text-foreground'}`}>{f.title}</span>
                                            <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">{f.desc}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* format options */}
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            {format === 'gauntlet' && (
                                <>
                                    <Field label="Main engine" hint="Plays every other selected engine.">
                                        <select
                                            value={hero || ''}
                                            onChange={(e) => setHero(e.target.value)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-foreground focus:border-primary outline-none"
                                        >
                                            {selected.length === 0 && <option value="">Select engines below</option>}
                                            {selectedEngines.map((e) => <option key={e.path} value={e.path}>{engineName(e)}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Matches per opponent" hint="1 match = 2 games, one as White and one as Black.">
                                        <Stepper value={matchesPerPairing} setValue={setMatchesPerPairing} min={1} max={100} />
                                    </Field>
                                    <Field label="Order" hint="Round by round means stopping early still gives a result against everyone.">
                                        <Segmented
                                            value={order}
                                            onChange={setOrder}
                                            options={[
                                                ['interleaved', 'Round by round'],
                                                ['sequential', 'One opponent at a time'],
                                            ]}
                                        />
                                    </Field>
                                </>
                            )}
                            {format === 'round_robin' && (
                                <Field label="Matches per pairing" hint="1 match = 2 games, one with each colour.">
                                    <Stepper value={matchesPerPairing} setValue={setMatchesPerPairing} min={1} max={50} />
                                </Field>
                            )}
                            {format === 'swiss' && (
                                <Field label="Rounds" hint={`Each round is one match (2 games) per engine. ${selected.length >= 2 ? `Up to ${maxRounds} rounds avoid rematches.` : ''}`}>
                                    <Stepper value={rounds} setValue={setRounds} min={1} max={50} />
                                </Field>
                            )}
                            {(format === 'elimination' || format === 'double_elimination') && (
                                <div className="md:col-span-2 text-xs text-muted-foreground bg-black/20 border border-white/5 rounded-xl p-3 flex gap-2">
                                    <Info size={14} className="shrink-0 mt-0.5 text-primary" />
                                    <span>
                                        Each round is a 2-game match. If it ends level: up to two more 2-game tiebreaks (new openings), then single sudden-death games. If even that stays level, the higher-rated engine goes through. Seeds come from the engines’ ratings.
                                    </span>
                                </div>
                            )}
                        </div>
                    </Section>

                    <Section
                        title="Engines"
                        icon={<Cpu size={16} className="text-primary" />}
                        right={
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">{selected.length} of {engines.length} selected</span>
                                <button onClick={() => setSelected(filtered.map((e) => e.path))} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-foreground">Select all</button>
                                <button onClick={() => setSelected([])} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground">Clear</button>
                            </div>
                        }
                    >
                        <div className="relative mb-3">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search engines…"
                                className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-primary outline-none"
                            />
                        </div>
                        {engines.length === 0 ? (
                            <p className="text-sm text-muted-foreground p-6 text-center border border-dashed border-white/10 rounded-xl">No engines found. Add some in Local Engines.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                                {filtered.map((e) => {
                                    const on = selected.includes(e.path);
                                    const isHero = format === 'gauntlet' && hero === e.path;
                                    const r = ratingOf(e.path);
                                    const tier = getRatingTier(r);
                                    return (
                                        <div
                                            key={e.path}
                                            onClick={() => toggle(e.path)}
                                            className={`group flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all min-w-0 ${on ? 'bg-primary/[0.07] border-primary/30' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
                                        >
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-white/20'}`}>
                                                {on && <Check size={13} className="text-black" strokeWidth={3} />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold text-sm text-foreground truncate" title={engineName(e)}>{engineName(e)}</div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <span className="text-[11px] font-mono text-primary">{r}</span>
                                                    <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tier.badgeClass}`}>{tier.title}</span>
                                                </div>
                                            </div>
                                            {format === 'gauntlet' && on && (
                                                <button
                                                    onClick={(ev) => {
                                                        ev.stopPropagation();
                                                        setHero(e.path);
                                                    }}
                                                    title={isHero ? 'Main engine' : 'Make this the main engine'}
                                                    className={`p-1.5 rounded-lg shrink-0 ${isHero ? 'text-yellow-400 bg-yellow-500/10' : 'text-muted-foreground/40 hover:text-yellow-400 hover:bg-white/5'}`}
                                                >
                                                    {isHero ? <Crown size={15} /> : <Star size={15} />}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Section>
                </div>

                {/* ---------------- settings column ---------------- */}
                <div className="space-y-6 min-w-0 xl:sticky xl:top-0">
                    <Section title="Time control" icon={<Clock size={16} className="text-primary" />}>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(TIME_PRESETS).map(([k, p]) => (
                                <button
                                    key={k}
                                    onClick={() => setTcType(k)}
                                    className={`px-3 py-2 rounded-xl border text-left transition-all ${tcType === k ? 'bg-primary text-black border-primary' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
                                >
                                    <span className="block text-sm font-bold">{p.label}</span>
                                    <span className={`block text-[11px] ${tcType === k ? 'text-black/70' : 'text-muted-foreground'}`}>{p.sub}</span>
                                </button>
                            ))}
                        </div>
                        {tcType === 'custom' && (
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <Field label="Base time">
                                    <div className="flex gap-1">
                                        <input type="number" min="1" value={customInitial} onChange={(e) => setCustomInitial(e.target.value)} className="w-full min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none" />
                                        <select value={timeUnit} onChange={(e) => setTimeUnit(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl px-2 text-xs">
                                            <option value="minutes">min</option>
                                            <option value="seconds">sec</option>
                                        </select>
                                    </div>
                                </Field>
                                <Field label="Increment (sec)">
                                    <input type="number" min="0" step="0.1" value={customInc} onChange={(e) => setCustomInc(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-primary outline-none" />
                                </Field>
                            </div>
                        )}
                    </Section>

                    <Section title="Openings" icon={<BookOpen size={16} className="text-primary" />}>
                        <Segmented
                            value={openingMode}
                            onChange={setOpeningMode}
                            options={[
                                ['builtin', 'Balanced set'],
                                ['book', 'Opening book'],
                                ['startpos', 'Start position'],
                            ]}
                        />
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                            {openingMode === 'builtin' && '50 balanced positions from popular openings, so repeated games don’t all start the same way.'}
                            {openingMode === 'book' && 'A line from the book is picked for each match and played in both games.'}
                            {openingMode === 'startpos' && 'Every game starts from the normal starting position.'}
                        </p>
                        {openingMode === 'book' && (
                            <div className="mt-3 space-y-2">
                                <select
                                    value={book || ''}
                                    onChange={(e) => setBook(e.target.value || null)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:border-primary outline-none"
                                >
                                    <option value="">Choose a book…</option>
                                    {installedBooks.map((b) => <option key={b.path} value={b.path}>{b.name}</option>)}
                                    {book && !installedBooks.some((b) => b.path === book) && <option value={book}>{book.split(/[\\/]/).pop()}</option>}
                                </select>
                                <button onClick={browseBook} className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm flex items-center justify-center gap-2">
                                    <FolderOpen size={14} /> Browse for a .bin book
                                </button>
                            </div>
                        )}
                    </Section>

                    <Section title="Games at once" icon={<Cpu size={16} className="text-primary" />}>
                        <Stepper value={concurrency} setValue={setConcurrency} min={1} max={cpus ? Math.max(1, Math.min(16, cpus)) : 8} />
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                            Each game runs two engines. {cpus ? `Your PC has ${cpus} CPU threads, so up to about ${threadsHint} game${threadsHint === 1 ? "" : "s"} at once is comfortable` : 'Keep this at or below half your CPU threads'}, if each engine uses 1 thread.
                        </p>
                    </Section>

                    {/* summary */}
                    <div className="bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-2xl p-5 space-y-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <Stat label="Engines" value={selected.length} />
                            <Stat label="Matches" value={plan.matches ? `${plan.atLeast ? '≥' : ''}${plan.matches}` : '–'} />
                            <Stat label="Games" value={plan.games ? `${plan.atLeast ? '≥' : ''}${plan.games}` : '–'} />
                        </div>
                        {plan.games > 0 && (
                            <p className="text-xs text-muted-foreground text-center">
                                {format === 'gauntlet' && `${selected.length - 1} opponent${selected.length === 2 ? '' : 's'} × ${matchesPerPairing} match${matchesPerPairing === 1 ? '' : 'es'} × 2 games. `}
                                Roughly {fmtMinutes(est)} at {concurrency} game{concurrency === 1 ? '' : 's'} at a time.
                            </p>
                        )}
                        <button
                            onClick={handleStart}
                            disabled={!canStart}
                            className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-primary text-black hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Play size={18} className="fill-current" /> Start {FORMATS[format].title}
                        </button>
                        {!canStart && (
                            <p className="text-[11px] text-center text-muted-foreground">
                                {selected.length < 2 ? 'Select at least 2 engines.' : openingMode === 'book' && !book ? 'Choose an opening book.' : 'Pick the main engine.'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* narrow windows: the start button stays in reach */}
            <div className="xl:hidden sticky -bottom-4 lg:-bottom-6 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-background border-t border-white/5 flex items-center gap-3 z-30">
                <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                    {plan.games
                        ? <><span className="text-foreground font-semibold">{FORMATS[format].title}</span> · {selected.length} engines · {plan.atLeast ? '≥' : ''}{plan.matches} matches · {plan.atLeast ? '≥' : ''}{plan.games} games · ~{fmtMinutes(est)}</>
                        : selected.length < 2 ? 'Select at least 2 engines.' : ''}
                </div>
                <button onClick={handleStart} disabled={!canStart} className="px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 bg-primary text-black hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                    <Play size={16} className="fill-current" /> Start
                </button>
            </div>

            {showPrompt && <PromptModal title="Save tournament preset" onClose={() => setShowPrompt(false)} onSubmit={savePreset} />}
            {showManagePresets && (
                <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowManagePresets(false)}>
                    <div className="bg-card w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-foreground">Tournament presets</h3>
                            <button onClick={() => setShowManagePresets(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-muted-foreground"><X size={16} /></button>
                        </div>
                        {presets.length === 0 && <p className="text-sm text-muted-foreground">No presets saved.</p>}
                        {presets.map((p) => (
                            <div key={p.name} className="flex items-center justify-between bg-black/30 rounded-xl px-3 py-2">
                                <span className="text-sm truncate">{p.name}</span>
                                <button
                                    onClick={async () => {
                                        await window.electronAPI.deletePreset(p.name, 'tournament');
                                        loadPresets();
                                    }}
                                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export function Section({ title, icon, right, children }) {
    return (
        <div className="bg-card rounded-2xl p-4 lg:p-5 border border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="font-bold flex items-center gap-2 text-foreground">{icon} {title}</h3>
                {right}
            </div>
            {children}
        </div>
    );
}

export function Field({ label, hint, children }) {
    return (
        <label className="block min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</span>
            {children}
            {hint && <span className="block text-[11px] text-muted-foreground/70 mt-1 leading-snug">{hint}</span>}
        </label>
    );
}

export function Stepper({ value, setValue, min = 1, max = 100 }) {
    const set = (v) => setValue(Math.max(min, Math.min(max, Number.isFinite(v) ? Math.round(v) : min)));
    return (
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-xl p-1 w-full">
            <button type="button" onClick={() => set(value - 1)} className="w-9 h-8 rounded-lg hover:bg-white/10 text-lg leading-none text-muted-foreground">−</button>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                onChange={(e) => set(parseInt(e.target.value, 10))}
                className="flex-1 min-w-0 bg-transparent text-center font-mono font-bold text-foreground outline-none"
            />
            <button type="button" onClick={() => set(value + 1)} className="w-9 h-8 rounded-lg hover:bg-white/10 text-lg leading-none text-muted-foreground">+</button>
        </div>
    );
}

export function Segmented({ value, onChange, options }) {
    return (
        <div className="flex flex-wrap gap-1 bg-black/40 border border-white/10 rounded-xl p-1">
            {options.map(([k, label]) => (
                <button
                    key={k}
                    type="button"
                    onClick={() => onChange(k)}
                    className={`flex-1 min-w-[90px] px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${value === k ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="bg-black/30 rounded-xl py-2">
            <div className="text-lg font-bold font-mono text-foreground">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
    );
}
