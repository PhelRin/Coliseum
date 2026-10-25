import React, { useEffect, useRef, useState } from 'react';
import { Trophy, User, Upload, RefreshCw, Download, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';

// Where the puzzles come from:
//   tournaments - engine tournaments played in Coliseum (kept automatically)
//   mine        - the user's own games from Chess.com or Lichess
//   file        - any PGN file
// onLoaded({ pgn, label, playerName, source }) is called once games are ready.

const MODES = [
    { id: 'tournaments', label: 'Engine Tournaments', icon: Trophy },
    { id: 'mine', label: 'My Games', icon: User },
    { id: 'file', label: 'PGN File', icon: Upload },
];

const PLATFORMS = [
    { id: 'chesscom', label: 'Chess.com' },
    { id: 'lichess', label: 'Lichess' },
];

const ACCOUNT_KEY = 'onlineAccount';

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function PuzzleSource({ disabled, loadedLabel, onLoaded, onClear }) {
    const [mode, setMode] = useState('tournaments');

    // engine tournaments
    const [archive, setArchive] = useState([]);
    const [hasCurrent, setHasCurrent] = useState(false);
    const [selectedId, setSelectedId] = useState(null);

    // online games
    const [platform, setPlatform] = useState('chesscom');
    const [username, setUsername] = useState('');
    const [count, setCount] = useState(100);
    const [fetching, setFetching] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    const [fetched, setFetched] = useState(null);

    // pgn file
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);

    const refreshArchive = async () => {
        if (!window.electronAPI) return;
        try {
            const list = (await window.electronAPI.invoke('list-tournament-archive')) || [];
            setArchive(list);
            const current = await window.electronAPI.invoke('get-tournament-pgn');
            setHasCurrent(!!(current && current.trim()));
        } catch (e) {
            setArchive([]);
        }
    };

    useEffect(() => {
        refreshArchive();
        // remember the last account the user imported
        window.electronAPI?.getStore(ACCOUNT_KEY).then((acc) => {
            if (acc && acc.username) {
                setUsername(acc.username);
                if (acc.platform) setPlatform(acc.platform);
            }
        }).catch(() => {});
    }, []);

    const pickTournament = async (id) => {
        if (disabled) return;
        setSelectedId(id);
        let pgn = null;
        let label = '';
        if (id === 'current') {
            pgn = await window.electronAPI.invoke('get-tournament-pgn');
            label = 'Current tournament';
        } else {
            pgn = await window.electronAPI.invoke('read-tournament-archive', id);
            const entry = archive.find((e) => e.id === id);
            label = entry ? `${entry.title} (${fmtDate(entry.date)})` : 'Tournament';
        }
        if (pgn && pgn.trim()) onLoaded({ pgn, label, playerName: null, source: { type: 'tournament', label } });
    };

    const removeTournament = async (e, id) => {
        e.stopPropagation();
        if (disabled) return;
        await window.electronAPI.invoke('delete-tournament-archive', id);
        if (selectedId === id) {
            setSelectedId(null);
            onClear();
        }
        refreshArchive();
    };

    const fetchGames = async () => {
        if (disabled || fetching || !username.trim()) return;
        setFetching(true);
        setFetchError(null);
        setFetched(null);
        const res = await window.electronAPI.invoke('fetch-online-games', { platform, username: username.trim(), max: count });
        setFetching(false);
        if (!res || !res.ok) {
            setFetchError(res?.error || 'Could not fetch games.');
            return;
        }
        setFetched(res);
        window.electronAPI.setStore(ACCOUNT_KEY, { platform, username: username.trim() }).catch(() => {});
        const site = PLATFORMS.find((p) => p.id === platform)?.label || platform;
        const label = `${res.username} on ${site} (${res.count} games)`;
        onLoaded({
            pgn: res.pgn,
            label,
            playerName: res.username,
            source: { type: 'online', platform, username: res.username, label: `${res.username} · ${site}` },
        });
    };

    const loadFile = (file) => {
        const reader = new FileReader();
        reader.onload = (ev) => onLoaded({ pgn: ev.target.result, label: file.name, playerName: null, source: { type: 'pgn', label: file.name } });
        reader.readAsText(file);
    };

    const tab = (m) => {
        const Icon = m.icon;
        const active = mode === m.id;
        return (
            <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => { setMode(m.id); if (m.id === 'tournaments') refreshArchive(); }}
                className={`py-2 px-1 rounded-lg text-[10px] font-semibold flex flex-col items-center gap-1 transition-all ${active ? 'bg-primary text-black shadow-md' : 'text-muted-foreground hover:text-white'}`}
            >
                <Icon size={14} />
                {m.label}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white">Get puzzles from</label>
                {loadedLabel && (
                    <button onClick={() => { setSelectedId(null); setFetched(null); onClear(); }} disabled={disabled} className="text-[10px] text-red-400 hover:text-red-300 font-bold">
                        Clear
                    </button>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 border border-white/5 rounded-xl">{MODES.map(tab)}</div>

            {mode === 'tournaments' && (
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto hidden-scrollbar">
                    {hasCurrent && (
                        <SourceRow active={selectedId === 'current'} disabled={disabled} onClick={() => pickTournament('current')}
                            title="Current tournament" detail="The tournament in the Tournament tab" />
                    )}
                    {archive.map((e) => (
                        <SourceRow key={e.id} active={selectedId === e.id} disabled={disabled} onClick={() => pickTournament(e.id)}
                            title={e.title}
                            detail={`${fmtDate(e.date)} · ${e.games} games · ${e.engines.length} engines${e.finished ? '' : ' · stopped early'}`}
                            onDelete={(ev) => removeTournament(ev, e.id)} />
                    ))}
                    {!hasCurrent && archive.length === 0 && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed bg-black/20 border border-white/5 rounded-xl p-3">
                            Tournaments you play are kept here automatically when they finish or are stopped. To use an older tournament, export its PGN and choose PGN File.
                        </p>
                    )}
                </div>
            )}

            {mode === 'mine' && (
                <div className="flex flex-col gap-2.5 bg-black/20 border border-white/5 rounded-xl p-3">
                    <div className="grid grid-cols-2 gap-1.5">
                        {PLATFORMS.map((p) => (
                            <button key={p.id} type="button" disabled={disabled || fetching} onClick={() => setPlatform(p.id)}
                                className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${platform === p.id ? 'bg-primary/10 border-primary/45 text-primary' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchGames()}
                        placeholder={`${PLATFORMS.find((p) => p.id === platform)?.label} username`}
                        disabled={disabled || fetching}
                        spellCheck={false}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:border-primary outline-none"
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground shrink-0">Last</span>
                        <div className="grid grid-cols-3 gap-1 flex-1">
                            {[25, 50, 100].map((n) => (
                                <button key={n} type="button" disabled={disabled || fetching} onClick={() => setCount(n)}
                                    className={`py-1 rounded-lg border text-[10px] font-mono transition-all ${count === n ? 'bg-primary/10 border-primary/45 text-primary font-bold' : 'bg-black/20 border-white/5 text-muted-foreground'}`}>
                                    {n}
                                </button>
                            ))}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">games</span>
                    </div>
                    <button type="button" onClick={fetchGames} disabled={disabled || fetching || !username.trim()}
                        className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${username.trim() && !fetching ? 'bg-white/10 hover:bg-white/15 text-white border border-white/10' : 'bg-zinc-800 text-muted-foreground border border-white/5 cursor-not-allowed'}`}>
                        {fetching ? <><RefreshCw size={13} className="animate-spin" /> Fetching games...</> : <><Download size={13} /> Get my games</>}
                    </button>
                    {fetchError && (
                        <p className="text-[10px] text-red-400 flex items-start gap-1.5"><AlertCircle size={12} className="shrink-0 mt-0.5" /> {fetchError}</p>
                    )}
                    {fetched && (
                        <p className="text-[10px] text-primary flex items-start gap-1.5 leading-relaxed">
                            <CheckCircle size={12} className="shrink-0 mt-0.5" />
                            <span>{fetched.count} games loaded ({fetched.asWhite} as White, {fetched.asBlack} as Black){fetched.oldest ? `, ${fmtDate(fetched.oldest)} – ${fmtDate(fetched.newest)}` : ''}. Puzzles come from your moves only.</span>
                        </p>
                    )}
                    {!fetched && !fetchError && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                            Uses the site's public game archive. No login needed; only standard chess games are imported.
                        </p>
                    )}
                </div>
            )}

            {mode === 'file' && (
                <>
                    <input type="file" ref={fileInputRef} accept=".pgn,.txt" className="hidden"
                        onChange={(e) => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; }} />
                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            const f = e.dataTransfer.files[0];
                            if (f && /\.(pgn|txt)$/i.test(f.name)) loadFile(f);
                        }}
                        onClick={() => !disabled && fileInputRef.current?.click()}
                        className={`h-28 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all ${isDragging ? 'border-primary bg-primary/5' : 'border-white/10 bg-black/20 hover:border-primary/40 hover:bg-white/5'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
                    >
                        <Upload size={22} className="mb-2 text-muted-foreground" />
                        <span className="text-xs font-semibold text-white">Drag & drop a PGN file</span>
                        <span className="text-[10px] text-muted-foreground mt-1">or click to select one</span>
                    </div>
                </>
            )}

            {loadedLabel && (
                <div className="text-[11px] text-white bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 flex items-center gap-2">
                    <CheckCircle size={13} className="text-primary shrink-0" />
                    <span className="truncate">Ready: {loadedLabel}</span>
                </div>
            )}
        </div>
    );
}

function SourceRow({ active, disabled, onClick, title, detail, onDelete }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={disabled ? undefined : onClick}
            onKeyDown={(e) => !disabled && e.key === 'Enter' && onClick()}
            className={`group px-3 py-2 rounded-xl border text-left transition-all flex items-center gap-2 ${disabled ? 'opacity-60' : 'cursor-pointer'} ${active ? 'bg-primary/10 border-primary/40' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
        >
            <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold truncate ${active ? 'text-primary' : 'text-white'}`}>{title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
            </div>
            {onDelete && (
                <button type="button" onClick={onDelete} disabled={disabled} title="Remove from this list"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all shrink-0">
                    <Trash2 size={12} />
                </button>
            )}
        </div>
    );
}
