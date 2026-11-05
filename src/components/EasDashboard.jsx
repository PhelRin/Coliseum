import React, { useEffect, useState } from 'react';
import { Flame, Play, Square, FileText, Trophy, Archive, Trash2, Download, Search, ChevronDown, ChevronRight, ExternalLink, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { useEas, splitPgn, EAS_CREDIT, SPCC_URL } from './eas/useEas';
import { EasResults } from './eas/EasResults';
import { Section, Segmented } from './TournamentSetup';
import { FORMATS } from './TournamentSetup';

const fmtDate = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

export function EasDashboard({ onAnalyze, focusReport }) {
    const eas = useEas();
    const [source, setSource] = useState('tournament');
    const [file, setFile] = useState(null);
    const [mode, setMode] = useState('gauntlet');
    const [tournament, setTournament] = useState(null); // { label, pgn, games, type }
    const [archiveCount, setArchiveCount] = useState(0);
    const [selected, setSelected] = useState(null); // full report
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!window.electronAPI) return;
        (async () => {
            const st = await window.electronAPI.getTournamentState();
            const pgn = await window.electronAPI.invoke('get-tournament-pgn');
            if (st && st.config && pgn) {
                const games = (pgn.match(/^\[Event /gm) || []).length;
                const f = FORMATS[st.config.type];
                setTournament({ pgn, games, type: st.config.type, label: `${f ? f.title : 'Tournament'} (${st.config.engines.length} engines)` });
                setMode(st.config.type === 'gauntlet' ? 'gauntlet' : 'all');
            } else setSource('file');
            const hist = (await window.electronAPI.getStore('matchHistory')) || [];
            setArchiveCount(hist.filter((h) => h.pgn).length);
        })();
    }, []);

    useEffect(() => {
        if (!eas.running) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [eas.running]);

    const open = async (id) => setSelected(await window.electronAPI.invoke('eas-report', id));
    // a report picked on another screen, else the latest one
    useEffect(() => {
        if (focusReport) open(focusReport);
    }, [focusReport]);
    useEffect(() => {
        if (!focusReport && !selected && eas.reports.length) open(eas.reports[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eas.reports.length]);

    const pickFile = async () => {
        const p = await window.electronAPI.dialogOpenFile({ filters: [{ name: 'PGN', extensions: ['pgn'] }] });
        if (p) {
            setFile(p);
            setSource('file');
        }
    };

    const start = async () => {
        let src, label;
        if (source === 'tournament' && tournament) {
            src = { pgn: tournament.pgn };
            label = tournament.label;
        } else if (source === 'file' && file) {
            src = { path: file };
            label = file.split(/[\\/]/).pop();
        } else if (source === 'archive') {
            const hist = (await window.electronAPI.getStore('matchHistory')) || [];
            src = { pgn: hist.filter((h) => h.pgn).map((h) => h.pgn).join('\n\n') };
            label = 'Quick Match archive';
        } else return;
        const rep = await eas.run(src, mode, label);
        if (rep) open(rep.id);
    };

    const canRun = eas.info && eas.info.available && !eas.running && ((source === 'tournament' && tournament) || (source === 'file' && file) || (source === 'archive' && archiveCount > 0));

    return (
        <div className="space-y-6 pb-16">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-2xl lg:text-3xl font-bold text-foreground flex items-center gap-3"><Flame className="text-orange-400" /> Engine Aggressiveness</h2>
                    <p className="text-muted-foreground mt-1 text-sm max-w-3xl">
                        How aggressively do your engines win? The EAS score rewards wins with sacrifices (more for bigger and earlier ones), short wins, and few "bad draws". It is worked out from each engine's own wins, so a weaker engine can still score high.
                    </p>
                </div>
                <button onClick={() => window.electronAPI.send('open-external', SPCC_URL)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                    sp-cc.de <ExternalLink size={12} />
                </button>
            </div>

            {eas.info && !eas.info.available && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 text-sm text-yellow-200 flex gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {eas.info.reason}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
                <div className="space-y-6 min-w-0">
                    {/* run */}
                    <Section title="Evaluate games" icon={<Search size={16} className="text-primary" />}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <SourceCard active={source === 'tournament'} disabled={!tournament} onClick={() => tournament && setSource('tournament')} icon={<Trophy size={16} />} title="Last tournament" sub={tournament ? `${tournament.label} · ${tournament.games} games` : 'No tournament games yet'} />
                            <SourceCard active={source === 'file'} onClick={file ? () => setSource('file') : pickFile} icon={<FileText size={16} />} title="PGN file" sub={file ? file.split(/[\\/]/).pop() : 'Choose a .pgn file…'} action={file ? <button onClick={(e) => { e.stopPropagation(); pickFile(); }} className="text-[11px] text-primary hover:underline">Change</button> : null} />
                            <SourceCard active={source === 'archive'} disabled={!archiveCount} onClick={() => archiveCount && setSource('archive')} icon={<Archive size={16} />} title="Quick Match archive" sub={archiveCount ? `${archiveCount} games` : 'No saved games'} />
                        </div>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                            <div>
                                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Score</span>
                                <Segmented value={mode} onChange={setMode} options={[['gauntlet', 'Main engine only (gauntlet)'], ['all', 'Every engine']]} />
                                <p className="text-[11px] text-muted-foreground/80 mt-1">
                                    {mode === 'gauntlet' ? 'Scores the engine that played the most games, for testing one engine against a field.' : 'Scores every engine in the games, for a ranking.'}
                                </p>
                            </div>
                            {eas.running ? (
                                <button onClick={eas.cancel} className="px-5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold flex items-center justify-center gap-2">
                                    <Square size={14} className="fill-current" /> Stop
                                </button>
                            ) : (
                                <button onClick={start} disabled={!canRun} className="px-6 py-3 rounded-xl bg-primary text-black font-bold flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed">
                                    <Play size={16} className="fill-current" /> Run EAS
                                </button>
                            )}
                        </div>

                        {eas.running && (
                            <div className="mt-4 bg-black/30 border border-white/5 rounded-xl p-3">
                                <div className="flex items-center gap-2 text-sm text-foreground mb-2">
                                    <Loader2 size={14} className="animate-spin text-primary" />
                                    Evaluating {eas.running.label} · {eas.running.games} games
                                    <span className="ml-auto font-mono text-xs text-muted-foreground">{fmtSecs(Math.max(0, Math.round((now - eas.running.startedAt) / 1000)))}</span>
                                </div>
                                <div className="font-mono text-[11px] text-primary/70 space-y-0.5 max-h-32 overflow-y-auto">
                                    {eas.lines.slice(-6).map((l, i) => <div key={i} className="truncate">&gt; {l}</div>)}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-2">Large databases can take a few minutes. The tool plays a short sound when it finishes.</p>
                            </div>
                        )}
                        {eas.error && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{eas.error}</div>}
                    </Section>

                    {/* report */}
                    {selected ? <ReportView report={selected} onAnalyze={onAnalyze} /> : (
                        <div className="bg-card border border-white/5 rounded-2xl p-10 text-center text-sm text-muted-foreground">Run the tool on some games and the results show up here.</div>
                    )}
                </div>

                {/* side: past reports + credit */}
                <div className="space-y-6 min-w-0 xl:sticky xl:top-0">
                    <Section title="Reports" icon={<FileText size={16} className="text-primary" />}>
                        {eas.reports.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No reports yet.</p>
                        ) : (
                            <div className="space-y-1.5 max-h-[420px] overflow-y-auto -mx-1 px-1">
                                {eas.reports.map((r) => {
                                    const top = r.report && r.report.rows && r.report.rows[0];
                                    const on = selected && selected.id === r.id;
                                    return (
                                        <div key={r.id} onClick={() => open(r.id)} className={`group rounded-xl px-3 py-2 cursor-pointer border ${on ? 'bg-primary/[0.07] border-primary/30' : 'border-transparent hover:bg-white/5'}`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-foreground truncate flex-1">{r.label}</span>
                                                <button onClick={(e) => { e.stopPropagation(); eas.remove(r.id); if (on) setSelected(null); }} className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400" title="Delete report">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground truncate">
                                                {fmtDate(r.at)} · {r.games} games · {r.mode === 'gauntlet' ? 'gauntlet' : 'all engines'}
                                            </div>
                                            {top && <div className="text-[11px] text-muted-foreground truncate"><Flame size={10} className="inline text-orange-400 mr-1" />{top.name} <span className="font-mono">{top.eas.toLocaleString('en-GB')}</span></div>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Section>
                    <div className="text-[11px] text-muted-foreground leading-relaxed bg-card border border-white/5 rounded-2xl p-4 space-y-2">
                        <p className="flex gap-2"><Info size={13} className="shrink-0 mt-0.5 text-primary" /><span>{EAS_CREDIT}</span></p>
                        <p>Scores depend on time control, openings, opponents and whether games are played to mate, so compare engines run under the same conditions. Coliseum plays every game to mate.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SourceCard({ active, disabled, onClick, icon, title, sub, action }) {
    return (
        <div onClick={disabled ? undefined : onClick} className={`text-left p-3 rounded-xl border transition-all min-w-0 ${disabled ? 'opacity-40 cursor-not-allowed border-white/5 bg-black/10' : active ? 'bg-primary/10 border-primary/40 cursor-pointer' : 'bg-black/20 border-white/5 hover:bg-white/5 cursor-pointer'}`}>
            <div className={`flex items-center gap-2 font-bold text-sm ${active ? 'text-primary' : 'text-foreground'}`}>{icon} {title}</div>
            <div className="text-[11px] text-muted-foreground mt-1 truncate" title={sub}>{sub}</div>
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}

export function ReportView({ report, onAnalyze }) {
    const [showRaw, setShowRaw] = useState(false);
    const [category, setCategory] = useState(null);
    const games = splitPgn(report.interesting);
    const cats = [...new Set(games.map((g) => g.annotator))];
    const shown = games.filter((g) => !category || g.annotator === category).slice(0, 200);
    const save = async (text, name) => {
        const p = await window.electronAPI.dialogSaveFile({ defaultPath: name, filters: [{ name: 'PGN', extensions: ['pgn'] }] });
        if (p) await window.electronAPI.saveFileContent(p, text);
    };
    const r = report.report || {};
    return (
        <div className="space-y-6">
            <Section
                title={report.label}
                icon={<Flame size={16} className="text-orange-400" />}
                right={<span className="text-[11px] text-muted-foreground">{fmtDate(report.at)} · {report.games} games · took {fmtSecs(report.seconds || 0)}</span>}
            >
                <EasResults report={r} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-[11px] text-muted-foreground">
                    {r.avgWinLength && <span>Average won game: {r.avgWinLength} moves</span>}
                    {r.shortWinLimit && <span>Short win: under {r.shortWinLimit} moves</span>}
                    {r.earlySacLimit && <span>Early sacrifice: before move {r.earlySacLimit}</span>}
                    {report.errorCount > 0 && <span className="text-yellow-400">{report.errorCount} games with irregular endings (time losses, crashes) were left out</span>}
                </div>
            </Section>

            <Section
                title={`Interesting wins (${report.interestingCount || 0})`}
                icon={<Trophy size={16} className="text-primary" />}
                right={report.interesting ? <button onClick={() => save(report.interesting, 'interesting_wins.pgn')} className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1.5"><Download size={12} /> Save PGN</button> : null}
            >
                {games.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sacrifices, very short wins or imbalances were found.</p>
                ) : (
                    <>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            <Chip on={!category} onClick={() => setCategory(null)}>All</Chip>
                            {cats.map((c) => (
                                <Chip key={c} on={category === c} onClick={() => setCategory(c)}>{c.replace(/ found in this game$/, '').replace(/^Game /, '')} · {games.filter((g) => g.annotator === c).length}</Chip>
                            ))}
                        </div>
                        <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
                            {shown.map((g, i) => (
                                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm min-w-0">
                                    <span className="flex-1 min-w-0 truncate"><span className="text-foreground">{g.white}</span> <span className="text-muted-foreground/60">vs</span> <span className="text-foreground">{g.black}</span></span>
                                    <span className="font-mono text-xs text-muted-foreground shrink-0">{g.result}</span>
                                    <span className="hidden md:block w-28 text-[11px] text-muted-foreground truncate shrink-0">{g.moves ? `${g.moves} moves` : ''}</span>
                                    <button onClick={() => onAnalyze && onAnalyze(g.pgn)} className="text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 shrink-0">Review</button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Section>

            <div className="bg-card border border-white/5 rounded-2xl">
                <button onClick={() => setShowRaw((v) => !v)} className="w-full px-5 py-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Full report from the EAS tool
                    <span className="ml-auto text-[11px] text-muted-foreground font-normal" onClick={(e) => { e.stopPropagation(); save(report.raw, 'statistics_EAS_ratinglist.txt'); }}>Save</span>
                </button>
                {showRaw && <pre className="px-5 pb-5 text-[11px] leading-relaxed text-muted-foreground overflow-x-auto whitespace-pre">{report.raw}</pre>}
            </div>
        </div>
    );
}

function Chip({ on, onClick, children }) {
    return (
        <button onClick={onClick} className={`text-[11px] px-2.5 py-1 rounded-lg border ${on ? 'bg-primary/10 border-primary/30 text-primary' : 'border-white/10 text-muted-foreground hover:text-foreground'}`}>
            {children}
        </button>
    );
}
