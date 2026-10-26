import React, { useState, useEffect } from 'react';
import { BookOpen, Settings, Play, Sword, Trophy, FolderOpen, CircuitBoard, Activity, TrendingUp, Twitch, History, Heart, Volume2, VolumeX, RotateCcw, Zap, Grid, Link2, Unlink, AlertTriangle, Copy, X } from 'lucide-react';
import { MatchSetup } from './components/MatchSetup';
import { Arena } from './components/Arena';
import { TournamentSetup } from './components/TournamentSetup';
import { TournamentDashboard } from './components/TournamentDashboard';
import { EloEstimationDashboard } from './components/EloEstimationDashboard';
import { TwitchDashboard } from './components/TwitchSidebar';
import { HistoryDashboard } from './components/HistoryDashboard';

import { TitleBar } from './components/TitleBar';
import { GameAnalysis } from './components/GameAnalysis';
import { SettingsModal } from './components/SettingsModal';
import { audio } from './utils/audio';
import { EngineStatsModal, getRatingTier } from './components/EngineStatsModal';
import Training from './components/Training';
import { BoardEditor } from './components/BoardEditor';
import { PlayView } from './components/PlayView';
import { SidebarNav } from './components/SidebarNav';
import { BooksView } from './components/BooksView';

// the sidebar tabs in their default order (people can reorder and hide them: "Customize")
const NAV_ITEMS = [
    { id: 'play', label: 'Play', icon: <Play /> },
    { id: 'home', label: 'Tournament', icon: <Trophy /> },
    { id: 'match', label: 'Quick Match', icon: <Sword /> },
    { id: 'analysis', label: 'Game Analysis', icon: <Activity /> },
    { id: 'board-editor', label: 'Board Editor', icon: <Grid /> },
    { id: 'training', label: 'Tactics Trainer', icon: <Zap /> },
    { id: 'twitch', label: 'Twitch', icon: <Twitch /> },
    { id: 'history', label: 'Archive', icon: <History /> },
    { id: 'elo', label: 'Elo Estimation', icon: <Activity /> },
    { id: 'engines', label: 'Engines & Books', icon: <FolderOpen /> },
];

function App() {
    const [activeTab, setActiveTab] = useState('home'); // 'home', 'match', 'engines', 'review', 'twitch'
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);
    const [sidebarPinned, setSidebarPinned] = useState(null); // null = follow the window width
    const [matchActive, setMatchActive] = useState(false);
    const [matchParams, setMatchParams] = useState(null);
    const [tournamentActive, setTournamentActive] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Global Review Archive State
    const [selectedAnalysisPgn, setSelectedAnalysisPgn] = useState(null);
    const [autoAnalyze, setAutoAnalyze] = useState(false);

    const handleAnalyzePosition = (fenOrPgn, autoStartAnalysis = false) => {
        setSelectedAnalysisPgn(fenOrPgn);
        setAutoAnalyze(autoStartAnalysis);
        setActiveTab('analysis');
    };

    // Global Drag & Drop State
    const [isDragging, setIsDragging] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [toastMessage, setToastMessage] = useState(null);
    const [dropChoice, setDropChoice] = useState(null); // dropped engine waiting for Link / Copy

    // Audio Settings State
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [audioVolume, setAudioVolume] = useState(1.0);

    // Auto-Update State
    const [updateInfo, setUpdateInfo] = useState(null); // { available: boolean, downloaded: boolean, version: string, progress: number }

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getAudioSettings().then(settings => {
                audio.setSettings(settings.enabled, settings.volume);
                setAudioEnabled(settings.enabled);
                setAudioVolume(settings.volume);
            });
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI && window.electronAPI.on) {
            const unsubAvailable = window.electronAPI.on('update-available', (info) => {
                setUpdateInfo({ available: true, downloaded: false, version: info.version, progress: 0 });
            });
            const unsubProgress = window.electronAPI.on('update-download-progress', (progressObj) => {
                setUpdateInfo(prev => prev ? { ...prev, progress: Math.round(progressObj.percent) } : null);
            });
            const unsubDownloaded = window.electronAPI.on('update-downloaded', (info) => {
                setUpdateInfo(prev => prev ? { ...prev, downloaded: true, version: info.version } : { available: true, downloaded: true, version: info.version });
            });
            const unsubError = window.electronAPI.on('update-error', (err) => {
                console.error("AutoUpdater error:", err);
            });

            return () => {
                if (unsubAvailable) unsubAvailable();
                if (unsubProgress) unsubProgress();
                if (unsubDownloaded) unsubDownloaded();
                if (unsubError) unsubError();
            };
        }
    }, []);

    // narrow window: collapse the sidebar (unless the user chose otherwise)
    useEffect(() => {
        const onResize = () => {
            if (sidebarPinned === null) setIsSidebarCollapsed(window.innerWidth < 1280);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [sidebarPinned]);

    // a tournament still running in the background (e.g. after a reload): show it
    useEffect(() => {
        if (window.electronAPI && window.electronAPI.getTournamentState) {
            window.electronAPI.getTournamentState().then((s) => {
                if (s && s.active) setTournamentActive(true);
            });
        }
    }, []);

    const toggleAudioMute = () => {
        const newEnabled = !audioEnabled;
        setAudioEnabled(newEnabled);
        audio.setSettings(newEnabled, audioVolume);
        if (window.electronAPI) {
            window.electronAPI.saveAudioSettings({ enabled: newEnabled, volume: audioVolume });
        }
    };

    const handleTabChange = (tabName) => {
        if (activeTab === 'match' && tabName !== 'match' && matchActive) {
            endMatch();
        }
        if (tabName !== 'analysis') {
            setSelectedAnalysisPgn(null);
            setAutoAnalyze(false);
        }
        setActiveTab(tabName);
    };

    const startMatch = (params) => {
        setTournamentActive(false);
        setMatchParams(params);
        setMatchActive(true);
    };

    const endMatch = () => {
        if (window.electronAPI) window.electronAPI.stopMatch();
        setMatchActive(false);
        setMatchParams(null);
    };

    const startTournament = (config) => {
        setMatchActive(false);
        // 'RESUME': the lobby has already asked the backend to resume the saved tournament
        if (config !== 'RESUME' && window.electronAPI) window.electronAPI.startTournament(config);
        setTournamentActive(true);
    };

    const handleGlobalDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (!file) return;

        if (file.name.toLowerCase().endsWith('.bin')) {
            if (window.electronAPI && window.electronAPI.installBook) {
                setInstalling(true);
                const result = await window.electronAPI.installBook(file.path);
                if (!result.success) {
                    alert("Book installation failed: " + result.error);
                } else {
                    window.dispatchEvent(new Event('refresh-engines'));
                    setActiveTab('engines');
                    setTimeout(() => window.dispatchEvent(new Event('show-books')), 50);
                    setToastMessage("Book Installed Successfully!");
                    setTimeout(() => setToastMessage(null), 4000);
                }
                setInstalling(false);
            }
        } else if (window.electronAPI && window.electronAPI.installEngine) {
            // ask every time: link it where it is, or copy it into the engines folder
            setDropChoice({ path: file.path, name: file.name });
        }
    };

    const addDroppedEngine = async (mode) => {
        const choice = dropChoice;
        setDropChoice(null);
        if (!choice || !window.electronAPI) return;
        setInstalling(mode);
        const result = mode === 'link'
            ? await window.electronAPI.linkEngine(choice.path)
            : await window.electronAPI.installEngine(choice.path);
        setInstalling(false);
        if (result && result.success) {
            window.dispatchEvent(new Event('refresh-engines'));
            setActiveTab('engines');
            const count = mode === 'link' && result.linked ? result.linked.length : 1;
            setToastMessage(mode === 'link'
                ? (count > 1 ? `${count} engines linked from ${choice.name}` : `Engine linked: ${choice.name}`)
                : `Engine Installed: ${choice.name}`);
            setTimeout(() => setToastMessage(null), 4000);
        } else {
            alert((mode === 'link' ? 'Could not link the engine: ' : 'Installation failed: ') + (result ? result.error : 'unknown error'));
        }
    };

    return (
        <div
            className="flex h-screen w-screen bg-background text-foreground overflow-hidden selection:bg-primary/20 pt-8"
            onDragEnter={(e) => {
                e.preventDefault();
                if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                    if (activeTab !== 'analysis') setIsDragging(true);
                }
            }}
            onDragOver={(e) => {
                if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                    if (activeTab !== 'analysis') e.preventDefault();
                }
            }}
        >
            <TitleBar />
            {/* SIDEBAR */}
            <aside className={`bg-card border-r border-white/5 flex flex-col pt-5 pb-3 z-50 transition-all duration-300 shrink-0 min-h-0 ${isSidebarCollapsed ? 'w-[72px] px-2' : 'w-60 px-3'}`}>
                <div
                    className={`flex items-center gap-3 mb-6 cursor-pointer shrink-0 ${isSidebarCollapsed ? 'justify-center' : 'px-3'}`}
                    onClick={() => {
                        setIsSidebarCollapsed(!isSidebarCollapsed);
                        setSidebarPinned(!isSidebarCollapsed);
                    }}
                    title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-primary to-primary2 flex items-center justify-center shadow-[0_0_15px_hsl(var(--primary)/0.3)] hover:scale-105 transition-transform">
                        <CircuitBoard className="w-6 h-6 text-black" />
                    </div>
                    {!isSidebarCollapsed && (
                        <div className="overflow-hidden">
                            <h1 className="font-bold text-lg tracking-tight leading-none truncate ml-2">Coliseum</h1>
                            <p className="text-[10px] text-muted-foreground tracking-widest uppercase truncate ml-2">Engine Manager</p>
                        </div>
                    )}
                </div>

                <SidebarNav
                    items={NAV_ITEMS}
                    activeTab={activeTab}
                    onSelect={handleTabChange}
                    collapsed={isSidebarCollapsed}
                    onExpand={() => {
                        setIsSidebarCollapsed(false);
                        setSidebarPinned(false);
                    }}
                    Item={SidebarItem}
                />

                <div className="mt-2 pt-2 space-y-1 shrink-0">
                    <SidebarItem
                        active={false}
                        onClick={toggleAudioMute}
                        icon={audioEnabled ? <Volume2 /> : <VolumeX />}
                        label={audioEnabled ? "Mute Sounds" : "Unmute Sounds"}
                        isSidebarCollapsed={isSidebarCollapsed}
                    />

                    <SidebarItem
                        active={showSettings}
                        onClick={() => setShowSettings(true)}
                        icon={<Settings />}
                        label="Settings"
                        isSidebarCollapsed={isSidebarCollapsed}
                    />

                    {/* Patreon Edge Case */}
                    <button
                        onClick={() => window.electronAPI && window.electronAPI.send('open-external', 'https://www.patreon.com/c/phelrin')}
                        title={isSidebarCollapsed ? "Support the Dev" : undefined}
                        className={`
                            w-full flex items-center gap-4 py-2.5 rounded-xl transition-all duration-300 group
                            ${isSidebarCollapsed ? 'justify-center px-0' : 'px-4'}
                            bg-gradient-to-r from-rose-500/10 to-orange-500/10 hover:from-rose-500/20 hover:to-orange-500/20 
                            border border-rose-500/20 hover:border-rose-500/40 
                            text-rose-200 hover:text-rose-100 shadow-[0_0_15px_rgba(244,63,94,0.05)] hover:shadow-[0_0_20px_rgba(244,63,94,0.15)]
                        `}
                    >
                        <Heart size={20} className="text-rose-400 group-hover:scale-110 group-hover:fill-rose-400/20 transition-all shrink-0" />
                        {!isSidebarCollapsed && <span className="font-medium whitespace-nowrap">Support the Dev</span>}
                    </button>
                </div>

                <div className="pt-3 mt-2 border-t border-white/5 shrink-0 [@media(max-height:760px)]:hidden">
                    {isSidebarCollapsed ? (
                        <div className="flex justify-center p-2">
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" title="System Ready" />
                        </div>
                    ) : (
                        <div className="px-4 py-3 rounded-xl bg-gradient-to-r from-primary/10 to-transparent border border-primary/10">
                            <p className="text-xs text-muted-foreground mb-1">Status</p>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                <span className="text-xs font-mono text-primary">System Ready</span>
                            </div>
                        </div>
                    )}
                </div>
            </aside>

            {/* MAIN CONTENT */}
            <main className="flex-1 min-w-0 overflow-hidden relative flex flex-col">
                {/* Top Bar (Optional, for now just spacing) */}
                <div className="h-12 border-b border-white/5 flex items-center px-4 lg:px-6 xl:px-8 bg-background/50 backdrop-blur-xl shrink-0 z-40">
                    <h2 className="text-base lg:text-lg font-bold capitalize text-foreground/80 truncate">
                        {activeTab === 'play' ? 'Play' :
                            activeTab === 'home' ? (tournamentActive ? 'Tournament' : 'Tournament Lobby') :
                            activeTab === 'match' ? (matchActive ? 'Live Arena' : 'Match Setup') :
                                activeTab === 'elo' ? 'Strength Estimation' :
                                    activeTab === 'analysis' ? 'Game Analysis' :
                                        activeTab === 'board-editor' ? 'Board Editor' :
                                            activeTab === 'training' ? 'Tactics Trainer' :
                                                activeTab === 'twitch' ? 'Twitch Integration' :
                                                    activeTab === 'history' ? 'Match Archive' :
                                                        activeTab === 'engines' ? 'Engines & Books' :
                                                            'Coliseum'}
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-4 lg:p-6 xl:p-8 relative">
                    <div className="max-w-[1600px] mx-auto animate-fade-in h-full">
                        {activeTab === 'home' && (
                            tournamentActive ? <TournamentDashboard onExit={() => setTournamentActive(false)} /> : <TournamentSetup onStart={startTournament} />
                        )}
                        {activeTab === 'play' && <PlayView onReviewGame={(pgn) => handleAnalyzePosition(pgn, true)} />}
                        {activeTab === 'match' && (
                            matchActive ? <Arena matchParams={matchParams} onBack={endMatch} /> : <MatchSetup onStart={startMatch} />
                        )}

                        {activeTab === 'analysis' && (
                            <GameAnalysis 
                                initialPgn={selectedAnalysisPgn} 
                                autoAnalyze={autoAnalyze} 
                            />
                        )}

                        {activeTab === 'board-editor' && (
                            <BoardEditor onAnalyzePosition={handleAnalyzePosition} />
                        )}

                        {activeTab === 'training' && <Training onAnalyzePosition={handleAnalyzePosition} />}

                        {activeTab === 'twitch' && <TwitchDashboard />}

                        {activeTab === 'elo' && <EloEstimationDashboard />}
                        {activeTab === 'history' && <HistoryDashboard onAnalyzeGame={(pgn) => handleAnalyzePosition(pgn, false)} />}
                        {activeTab === 'engines' && <EnginesAndBooks />}
                    </div>
                </div>
            </main>

            {isDragging && (
                <div
                    className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in"
                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={handleGlobalDrop}
                    onDragOver={(e) => e.preventDefault()}
                >
                    <div className="pointer-events-none flex flex-col items-center justify-center">
                        <CircuitBoard className="w-24 h-24 text-primary mb-6 animate-bounce drop-shadow-[0_0_20px_hsl(var(--primary)/0.5)]" />
                        <h2 className="text-4xl font-black text-white drop-shadow-xl tracking-tight">Drop an Engine or .bin Book</h2>
                        <p className="text-primary font-bold mt-2 uppercase tracking-widest text-sm">Engines, .bin books or folders</p>
                    </div>
                </div>
            )}

            {dropChoice && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in p-6" onClick={() => setDropChoice(null)}>
                    <div className="w-full max-w-xl bg-card border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col gap-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="text-xl font-bold text-white">Add engine</h3>
                                <p className="text-sm text-muted-foreground mt-1 truncate" title={dropChoice.path}>{dropChoice.name}</p>
                            </div>
                            <button type="button" onClick={() => setDropChoice(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5" aria-label="Cancel">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => addDroppedEngine('link')}
                                className="text-left p-4 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-all flex flex-col gap-2"
                            >
                                <span className="flex items-center gap-2 text-primary font-bold"><Link2 size={16} /> Link it</span>
                                <span className="text-xs text-muted-foreground leading-relaxed">Use it from where it is. Rebuild it any time: Coliseum runs your newest build, and nothing is copied into the engines folder.</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => addDroppedEngine('copy')}
                                className="text-left p-4 rounded-xl border border-white/10 bg-black/20 hover:bg-white/5 transition-all flex flex-col gap-2"
                            >
                                <span className="flex items-center gap-2 text-white font-bold"><Copy size={16} /> Copy it</span>
                                <span className="text-xs text-muted-foreground leading-relaxed">Put a copy in Coliseum's engines folder. Later changes to the original are not picked up.</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {installing && (
                <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary mb-6 shadow-[0_0_30px_hsl(var(--primary)/0.4)]"></div>
                    <h2 className="text-3xl font-bold text-white tracking-tight drop-shadow-lg">{installing === 'link' ? 'Linking engine...' : 'Installing to Vault...'}</h2>
                </div>
            )}

            {toastMessage && (
                <div className="fixed bottom-6 right-6 z-[100] bg-primary text-black font-bold px-6 py-4 rounded-xl shadow-[0_0_20px_hsl(var(--primary)/0.3)] animate-in slide-in-from-bottom-5 fade-in duration-300">
                    {toastMessage}
                </div>
            )}

            {updateInfo && (
                <div className="fixed bottom-6 left-6 z-[100] max-w-sm bg-card/90 border border-primary/40 p-5 rounded-2xl shadow-[0_0_30px_hsl(var(--primary)/0.15)] backdrop-blur-xl animate-in slide-in-from-left-5 fade-in duration-300 flex flex-col gap-3">
                    <div>
                        <h4 className="text-sm font-extrabold text-white flex items-center gap-1.5">
                            <Zap size={14} className="text-primary animate-pulse" /> Update Available (v{updateInfo.version})
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {updateInfo.downloaded 
                                ? "The update has been downloaded successfully. Restart the application to install it!"
                                : `Downloading update... ${updateInfo.progress}%`}
                        </p>
                    </div>

                    {!updateInfo.downloaded && (
                        <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden border border-white/5">
                            <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${updateInfo.progress}%` }} />
                        </div>
                    )}

                    <div className="flex gap-2 justify-end mt-1">
                        {updateInfo.downloaded ? (
                            <button
                                onClick={() => window.electronAPI.send('restart-and-install')}
                                className="px-4 py-2 bg-primary text-black font-extrabold text-xs rounded-xl hover:brightness-110 transition-all flex items-center gap-1 shadow shadow-primary/20 cursor-pointer"
                            >
                                Restart & Install
                            </button>
                        ) : (
                            <span className="text-[10px] text-muted-foreground font-mono self-center">Downloading...</span>
                        )}
                        <button
                            onClick={() => setUpdateInfo(null)}
                            className="px-3 py-2 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white border border-white/5 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                        >
                            {updateInfo.downloaded ? "Later" : "Dismiss"}
                        </button>
                    </div>
                </div>
            )}

            {showSettings && (
                <SettingsModal
                    onClose={() => {
                        setShowSettings(false);
                        if (window.electronAPI) {
                            window.electronAPI.getAudioSettings().then(settings => {
                                setAudioEnabled(settings.enabled);
                                setAudioVolume(settings.volume);
                            });
                        }
                    }}
                />
            )}
        </div>
    );
}

function SidebarItem({ active, onClick, icon, label, isSidebarCollapsed }) {
    return (
        <button
            onClick={onClick}
            title={isSidebarCollapsed ? label : undefined}
            className={`
                w-full flex items-center gap-3 py-2.5 [@media(max-height:760px)]:py-2 rounded-xl transition-all duration-200 group
                ${isSidebarCollapsed ? 'justify-center px-0' : 'px-3'}
                ${active ? 'bg-primary/10 text-primary border border-primary/20 shadow-[0_0_10px_hsl(var(--primary)/0.05)]' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent'}
            `}
        >
            {React.cloneElement(icon, { size: 20, className: active ? "fill-primary/20 shrink-0" : "group-hover:scale-110 transition-transform shrink-0" })}
            {!isSidebarCollapsed && <span className="font-medium whitespace-nowrap">{label}</span>}
            {active && !isSidebarCollapsed && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_5px_currentColor] shrink-0" />}
        </button>
    )
}

import { EngineConfigModal } from './components/EngineConfigModal';

// "Engines & Books": the engines and the opening books, as two tabs on one page
function EnginesAndBooks() {
    const [tab, setTab] = useState(() => {
        try {
            return localStorage.getItem('enginesTab') === 'books' ? 'books' : 'engines';
        } catch (e) {
            return 'engines';
        }
    });
    const choose = (t) => {
        setTab(t);
        try {
            localStorage.setItem('enginesTab', t);
        } catch (e) { /* not available */ }
    };
    useEffect(() => {
        const show = () => choose('books');
        window.addEventListener('show-books', show);
        return () => window.removeEventListener('show-books', show);
    }, []);
    return (
        <div className="space-y-6">
            <div className="flex gap-1 bg-card border border-white/5 rounded-xl p-1 w-fit">
                {[['engines', 'Engines', CircuitBoard], ['books', 'Opening books', BookOpen]].map(([id, label, Icon]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => choose(id)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors ${tab === id ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                    >
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>
            {tab === 'books' ? (
                <div className="space-y-6">
                    <div>
                        <h2 className="text-3xl font-bold text-foreground">Opening Books</h2>
                        <p className="text-muted-foreground mt-1">Polyglot books for tournaments, matches and Game Review</p>
                    </div>
                    <BooksView />
                </div>
            ) : (
                <EnginesView />
            )}
        </div>
    );
}

function EnginesView() {
    const [engines, setEngines] = useState([]);
    const [careerStats, setCareerStats] = useState({});
    const [editingEngine, setEditingEngine] = useState(null);
    const [viewingStatsEngine, setViewingStatsEngine] = useState(null);

    const fetchEngines = async () => {
        if (window.electronAPI) {
            try {
                const foundEngines = await window.electronAPI.scanEngines();
                const linked = (window.electronAPI.listLinkedEngines && await window.electronAPI.listLinkedEngines()) || [];
                const stats = await window.electronAPI.getStore('engineCareerStats') || {};
                // linked engines whose file is gone still show, so they can be relinked or removed
                setEngines([...(foundEngines || []), ...linked.filter((l) => l.missing)]);
                setCareerStats(stats);
            } catch (e) {
                console.error("Failed to load engines or stats:", e);
            }
        }
    };

    useEffect(() => {
        fetchEngines();
        window.addEventListener('refresh-engines', fetchEngines);
        return () => window.removeEventListener('refresh-engines', fetchEngines);
    }, []);

    const openEngineFolder = () => {
        if (window.electronAPI) {
            window.electronAPI.openEnginesFolder();
        }
    };

    const linkByPath = async () => {
        if (!window.electronAPI || !window.electronAPI.pickEngineFiles) return;
        const files = await window.electronAPI.pickEngineFiles();
        if (!files || !files.length) return;
        const failed = [];
        for (const f of files) {
            const r = await window.electronAPI.linkEngine(f);
            if (!r || !r.success) failed.push(r ? r.error : f);
        }
        if (failed.length) alert('Could not link: ' + failed.join('\n'));
        fetchEngines();
    };

    const relink = async (engine) => {
        const files = await window.electronAPI.pickEngineFiles();
        if (!files || !files.length) return;
        const r = await window.electronAPI.relinkEngine(engine.path, files[0]);
        if (!r || !r.success) alert('Could not relink: ' + (r ? r.error : 'unknown error'));
        fetchEngines();
    };

    const unlink = async (engine) => {
        if (!window.confirm(`Remove ${engine.name} from Coliseum?\n\nOnly the link is removed. The engine file itself is not deleted.`)) return;
        await window.electronAPI.unlinkEngine(engine.path);
        fetchEngines();
    };

    const handleResetAllElo = async () => {
        if (window.confirm("Are you sure you want to reset ELO ratings and career stats for ALL local engines? This will clear all historical matches.")) {
            if (window.electronAPI) {
                try {
                    await window.electronAPI.setStore('engineCareerStats', {});
                    fetchEngines();
                    alert("All local engine ratings have been reset to 1500.");
                } catch (e) {
                    console.error("Failed to reset all engine stats:", e);
                }
            }
        }
    };

    return (
        <div className="relative space-y-6 min-h-[500px] h-full">

            {editingEngine && (
                <EngineConfigModal
                    engine={editingEngine}
                    onClose={() => setEditingEngine(null)}
                />
            )}

            {viewingStatsEngine && (
                <EngineStatsModal
                    engine={viewingStatsEngine}
                    onClose={() => {
                        setViewingStatsEngine(null);
                        fetchEngines(); // reload stats in case of resets
                    }}
                />
            )}

            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-foreground">Local Engines</h2>
                    <p className="text-muted-foreground mt-1">Manage your analysis tools</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    <button
                        onClick={linkByPath}
                        title="Use an engine from its own folder (e.g. your build folder) without copying it"
                        className="px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover:border-primary/50 rounded-xl transition-all flex items-center gap-2 text-sm font-medium cursor-pointer"
                    >
                        <Link2 size={16} /> Add engine by path
                    </button>
                    <button
                        onClick={handleResetAllElo}
                        className="px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-xl transition-all flex items-center gap-2 text-sm font-medium cursor-pointer"
                    >
                        <RotateCcw size={16} /> Reset All Engine ELOs
                    </button>
                    <button
                        onClick={openEngineFolder}
                        className="px-6 py-2.5 bg-card hover:bg-accent border border-white/5 text-foreground rounded-xl transition-all flex items-center gap-2 text-sm font-medium cursor-pointer"
                    >
                        <FolderOpen size={16} /> Open Directory
                    </button>
                </div>
            </div>

            {engines.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl bg-card/50">
                    <CircuitBoard className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No engines yet.</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Drop an engine anywhere in the window, or use Add engine by path.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {engines.map((engine, i) => {
                        const stats = careerStats[engine.path] || { rating: 1500 };
                        const tier = getRatingTier(stats.rating);
                        return (
                            <div key={engine.path || i} className={`group p-5 rounded-2xl bg-card border transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] cursor-default relative overflow-hidden flex flex-col ${engine.missing ? 'border-red-500/30' : 'border-white/5 hover:border-primary/50'}`}>
                                <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${engine.missing ? 'bg-red-400 text-red-400' : 'bg-primary'}`} />
                                </div>
                                <div className="flex items-center gap-4 mb-4">
                                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-gray-800 to-black border border-white/10 flex items-center justify-center font-bold text-xl shadow-inner font-mono shrink-0 ${engine.missing ? 'text-red-400/70' : 'text-primary'}`}>
                                        {engine.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="overflow-hidden min-w-0 flex-1">
                                        <h4 className="font-bold text-foreground truncate" title={engine.path}>{engine.name}</h4>
                                        <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                            <span className="text-[10px] font-mono text-primary font-bold">{stats.rating} ELO</span>
                                            <span className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tier.badgeClass}`}>
                                                {tier.title}
                                            </span>
                                            {engine.linked && !engine.missing && (
                                                <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-400/30 bg-sky-400/10 text-sky-300 flex items-center gap-1" title="Linked: used from its own folder">
                                                    <Link2 size={9} /> Linked
                                                </span>
                                            )}
                                            {engine.missing && (
                                                <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-300 flex items-center gap-1">
                                                    <AlertTriangle size={9} /> Not found
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {engine.linked && (
                                    <p className={`-mt-1 mb-3 text-[10px] font-mono truncate ${engine.missing ? 'text-red-300/70' : 'text-muted-foreground/60'}`} title={engine.path}>
                                        {engine.path.length > 46 ? `…${engine.path.slice(-45)}` : engine.path}
                                    </p>
                                )}
                                <div className="mt-auto pt-4 border-t border-white/5 flex justify-between items-center text-xs text-muted-foreground/50 font-mono">
                                    {engine.missing ? (
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => relink(engine)}
                                                className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-primary hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                                title="Point Coliseum at the engine's new location. Its rating and settings are kept."
                                            >
                                                <Link2 size={12} /> Relink
                                            </button>
                                            <button
                                                onClick={() => unlink(engine)}
                                                className="px-2.5 py-1.5 bg-white/5 hover:bg-red-500/15 rounded-lg text-red-300 hover:text-red-200 transition-colors flex items-center gap-1 cursor-pointer"
                                            >
                                                <Unlink size={12} /> Remove
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => setEditingEngine(engine)}
                                                className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-primary hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                            >
                                                <Settings size={12} /> Configure
                                            </button>
                                            <button
                                                onClick={() => setViewingStatsEngine(engine)}
                                                className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-amber-400 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                            >
                                                <TrendingUp size={12} /> Stats
                                            </button>
                                            {engine.linked && (
                                                <button
                                                    onClick={() => unlink(engine)}
                                                    className="p-1.5 bg-white/5 hover:bg-red-500/15 rounded-lg text-muted-foreground hover:text-red-300 transition-colors flex items-center cursor-pointer"
                                                    title="Unlink (the file itself is not deleted)"
                                                    aria-label="Unlink"
                                                >
                                                    <Unlink size={12} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <span className={engine.missing ? 'text-red-400/70' : ''}>{engine.missing ? 'MISSING' : 'READY'}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default App;

