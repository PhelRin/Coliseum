import React, { useState, useEffect } from 'react';
import { Sword, Clock, Settings, Cpu, Bot, Play, Shield, X, ExternalLink, Download, FolderOpen, Save, Bookmark, Trash2 } from 'lucide-react';
import { PromptModal } from './PromptModal';

export function MatchSetup({ onStart }) {
    const [engines, setEngines] = useState([]);
    const [whiteEngine, setWhiteEngine] = useState(null);
    const [blackEngine, setBlackEngine] = useState(null);

    const [linkTimeControls, setLinkTimeControls] = useState(true);
    
    const [whiteTimeControl, setWhiteTimeControl] = useState({
        type: 'blitz',
        initial: 180000,
        inc: 2000
    });
    const [blackTimeControl, setBlackTimeControl] = useState({
        type: 'blitz',
        initial: 180000,
        inc: 2000
    });
    
    // Custom Time Control Units
    const [whiteCustomInitial, setWhiteCustomInitial] = useState(3);
    const [whiteCustomInc, setWhiteCustomInc] = useState(2);
    const [whiteTimeUnit, setWhiteTimeUnit] = useState('minutes');

    const [blackCustomInitial, setBlackCustomInitial] = useState(3);
    const [blackCustomInc, setBlackCustomInc] = useState(2);
    const [blackTimeUnit, setBlackTimeUnit] = useState('minutes');

    const [whiteBook, setWhiteBook] = useState(null);
    const [blackBook, setBlackBook] = useState(null);

    const [presets, setPresets] = useState([]);
    const [installedBooks, setInstalledBooks] = useState([]);
    const [showPrompt, setShowPrompt] = useState(false);
    const [showManagePresets, setShowManagePresets] = useState(false);

    const handleDeletePreset = async (name) => {
        if (window.electronAPI) {
            await window.electronAPI.deletePreset(name, 'match');
            loadPresets();
        }
    };

    const loadPresets = async () => {
        if (window.electronAPI) {
            const list = await window.electronAPI.getPresets();
            setPresets(list.filter(p => p.type === 'match'));
        }
    };

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.scanEngines().then(found => {
                const withHuman = [{ name: 'Human Player', path: 'manual' }, ...found];
                setEngines(withHuman);
                if (withHuman.length > 0) {
                    setWhiteEngine(withHuman[0]);
                    setBlackEngine(withHuman.length > 1 ? withHuman[1] : withHuman[0]);
                }
            });
            loadPresets();
            window.electronAPI.scanBooks().then(setInstalledBooks);
        }
    }, []);

    const handleSavePreset = () => {
        setShowPrompt(true);
    };

    const savePresetWithName = async (name) => {
        setShowPrompt(false);
        if (!name) return; // User cancelled prompt
        const config = {
            name,
            type: 'match',
            data: {
                whiteEngine,
                blackEngine,
                linkTimeControls,
                whiteTimeControl,
                blackTimeControl,
                whiteCustomInitial,
                whiteCustomInc,
                whiteTimeUnit,
                blackCustomInitial,
                blackCustomInc,
                blackTimeUnit,
                whiteBook,
                blackBook
            }
        };
        if (window.electronAPI) {
            await window.electronAPI.savePreset(config);
            loadPresets();
        }
    };

    const handleLoadPreset = (e) => {
        const presetName = e.target.value;
        if (!presetName) return;
        const preset = presets.find(p => p.name === presetName);
        if (preset && preset.data) {
            setWhiteEngine(preset.data.whiteEngine);
            setBlackEngine(preset.data.blackEngine);
            setLinkTimeControls(preset.data.linkTimeControls !== undefined ? preset.data.linkTimeControls : true);
            setWhiteTimeControl(preset.data.whiteTimeControl || preset.data.timeControl);
            setBlackTimeControl(preset.data.blackTimeControl || preset.data.timeControl);
            setWhiteCustomInitial(preset.data.whiteCustomInitial || preset.data.customInitial || 60);
            setWhiteCustomInc(preset.data.whiteCustomInc || preset.data.customInc || 0);
            setWhiteTimeUnit(preset.data.whiteTimeUnit || preset.data.timeUnit || 'minutes');
            setBlackCustomInitial(preset.data.blackCustomInitial || preset.data.customInitial || 60);
            setBlackCustomInc(preset.data.blackCustomInc || preset.data.customInc || 0);
            setBlackTimeUnit(preset.data.blackTimeUnit || preset.data.timeUnit || 'minutes');
            setWhiteBook(preset.data.whiteBook);
            setBlackBook(preset.data.blackBook);
        }
    };

    const selectBook = async (color) => {
        if (window.electronAPI) {
            const path = await window.electronAPI.dialogOpenFile({
                filters: [{ name: 'Polyglot Book', extensions: ['bin'] }]
            });
            if (path) {
                if (color === 'white') setWhiteBook(path);
                else setBlackBook(path);
            }
        }
    };

    const handleStart = () => {
        if (whiteEngine && blackEngine) {
            let finalWhiteTC = { ...whiteTimeControl };
            let finalBlackTC = { ...blackTimeControl };

            if (linkTimeControls) {
                finalBlackTC = { ...whiteTimeControl };
                if (whiteTimeControl.type === 'custom') {
                    const multiplier = whiteTimeUnit === 'minutes' ? 60 * 1000 : 1000;
                    finalWhiteTC.initial = whiteCustomInitial * multiplier;
                    finalWhiteTC.inc = whiteCustomInc * 1000;
                    
                    finalBlackTC.type = 'custom';
                    finalBlackTC.initial = whiteCustomInitial * multiplier;
                    finalBlackTC.inc = whiteCustomInc * 1000;
                }
            } else {
                if (whiteTimeControl.type === 'custom') {
                    const multiplier = whiteTimeUnit === 'minutes' ? 60 * 1000 : 1000;
                    finalWhiteTC.initial = whiteCustomInitial * multiplier;
                    finalWhiteTC.inc = whiteCustomInc * 1000;
                }
                if (blackTimeControl.type === 'custom') {
                    const multiplier = blackTimeUnit === 'minutes' ? 60 * 1000 : 1000;
                    finalBlackTC.initial = blackCustomInitial * multiplier;
                    finalBlackTC.inc = blackCustomInc * 1000;
                }
            }

            onStart({
                whitePath: whiteEngine.path,
                blackPath: blackEngine.path,
                settings: {
                    whiteTimeControl: finalWhiteTC,
                    blackTimeControl: finalBlackTC,
                    whiteBook,
                    blackBook
                }
            });
        }
    };

    const handleSelectEngine = (color, engine) => {
        if (color === 'white') {
            setWhiteEngine(engine);
            if (linkTimeControls) {
                const bothEngines = engine.path !== 'manual' && blackEngine?.path !== 'manual';
                if (bothEngines && whiteTimeControl.type === 'unlimited') {
                    const defaultBlitz = { type: 'blitz', initial: 180000, inc: 2000 };
                    setWhiteTimeControl(defaultBlitz);
                    setBlackTimeControl(defaultBlitz);
                }
            } else {
                if (engine.path !== 'manual' && whiteTimeControl.type === 'unlimited') {
                    setWhiteTimeControl({ type: 'blitz', initial: 180000, inc: 2000 });
                }
            }
        } else {
            setBlackEngine(engine);
            if (linkTimeControls) {
                const bothEngines = whiteEngine?.path !== 'manual' && engine.path !== 'manual';
                if (bothEngines && whiteTimeControl.type === 'unlimited') {
                    const defaultBlitz = { type: 'blitz', initial: 180000, inc: 2000 };
                    setWhiteTimeControl(defaultBlitz);
                    setBlackTimeControl(defaultBlitz);
                }
            } else {
                if (engine.path !== 'manual' && blackTimeControl.type === 'unlimited') {
                    setBlackTimeControl({ type: 'blitz', initial: 180000, inc: 2000 });
                }
            }
        }
    };

    const renderTimeControlPanel = (colorLabel, timeControlState, setTimeControlState, customInitialState, setCustomInitialState, customIncState, setCustomIncState, timeUnitState, setTimeUnitState, isHuman) => {
        return (
            <div className="bg-black/10 border border-white/5 rounded-xl p-5 flex-1">
                <h4 className="text-sm font-bold text-foreground mb-3 tracking-wide">{colorLabel} Time Control</h4>
                
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
                    <FormControl type="button" active={timeControlState.type === 'bullet'} onClick={() => setTimeControlState({ type: 'bullet', initial: 60000, inc: 0 })}>
                        Bullet (1+0)
                    </FormControl>
                    <FormControl type="button" active={timeControlState.type === 'blitz'} onClick={() => setTimeControlState({ type: 'blitz', initial: 180000, inc: 2000 })}>
                        Blitz (3+2)
                    </FormControl>
                    <FormControl type="button" active={timeControlState.type === 'rapid'} onClick={() => setTimeControlState({ type: 'rapid', initial: 600000, inc: 0 })}>
                        Rapid (10+0)
                    </FormControl>
                    <FormControl type="button" active={timeControlState.type === 'custom'} onClick={() => setTimeControlState({ ...timeControlState, type: 'custom' })}>
                        Custom
                    </FormControl>
                    {isHuman && (
                        <FormControl type="button" active={timeControlState.type === 'unlimited'} onClick={() => setTimeControlState({ type: 'unlimited', initial: -1, inc: 0 })}>
                            Unlimited
                        </FormControl>
                    )}
                </div>

                {timeControlState.type === 'custom' && (
                    <div className="flex flex-col gap-4 animate-fade-in bg-black/20 p-4 rounded-xl border border-white/5 mt-2">
                        <div className="flex justify-center mb-2">
                            <div className="bg-black/40 p-1 rounded-lg flex gap-1">
                                <button
                                    onClick={() => setTimeUnitState('minutes')}
                                    className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${timeUnitState === 'minutes' ? 'bg-primary text-black shadow-lg font-bold' : 'text-muted-foreground hover:bg-white/5'}`}
                                >
                                    Minutes
                                </button>
                                <button
                                    onClick={() => setTimeUnitState('seconds')}
                                    className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${timeUnitState === 'seconds' ? 'bg-primary text-black shadow-lg font-bold' : 'text-muted-foreground hover:bg-white/5'}`}
                                >
                                    Seconds
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-mono text-primary mb-2 uppercase tracking-wide">
                                    Initial Time ({timeUnitState})
                                </label>
                                <input
                                    type="number"
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-foreground font-mono"
                                    value={customInitialState}
                                    onChange={(e) => setCustomInitialState(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-mono text-primary mb-2 uppercase tracking-wide">
                                    Increment (Seconds)
                                </label>
                                <input
                                    type="number"
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-foreground font-mono"
                                    value={customIncState}
                                    onChange={(e) => setCustomIncState(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-8 pb-20">
            {/* Header */}
            <div className="border-b border-white/5 pb-6 flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-foreground">Quick Match</h2>
                    <p className="text-muted-foreground mt-1">Set up a 1v1 duel between two engines.</p>
                </div>
                <div className="flex gap-3">
                    <select
                        onChange={(e) => { handleLoadPreset(e); e.target.blur(); }}
                        value=""
                        className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 hover:bg-black/50 transition-colors text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                        <option value="" disabled>Load Preset</option>
                        {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                    {presets.length > 0 && (
                        <button
                            onClick={() => setShowManagePresets(true)}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 hover:border-red-500/30 rounded-xl transition-all flex items-center justify-center shrink-0"
                            title="Delete Presets"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                    <button
                        onClick={handleSavePreset}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm border border-white/5 text-foreground transition-all flex items-center gap-2"
                    >
                        <Settings size={14} /> Save Preset
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* White Engine */}
                <EngineCard
                    label="White Engine"
                    selected={whiteEngine}
                    engines={engines}
                    onSelect={(eng) => handleSelectEngine('white', eng)}
                    color="white"
                    icon={<Cpu />}
                    installedBooks={installedBooks}
                    bookPath={whiteBook}
                    onSelectBook={() => selectBook('white')}
                    onSetBookPath={(p) => setWhiteBook(p)}
                    onClearBook={() => setWhiteBook(null)}
                />
                {/* Black Engine */}
                <EngineCard
                    label="Black Engine"
                    selected={blackEngine}
                    engines={engines}
                    onSelect={(eng) => handleSelectEngine('black', eng)}
                    color="black"
                    icon={<Cpu />}
                    installedBooks={installedBooks}
                    bookPath={blackBook}
                    onSelectBook={() => selectBook('black')}
                    onSetBookPath={(p) => setBlackBook(p)}
                    onClearBook={() => setBlackBook(null)}
                />
            </div>

            <div className="bg-card border border-white/5 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Clock className="w-6 h-6 text-primary" />
                        <h3 className="text-xl font-bold text-foreground">Time Control</h3>
                    </div>
                    {/* Link/Unlink Toggle */}
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={linkTimeControls}
                            onChange={(e) => {
                                const checked = e.target.checked;
                                setLinkTimeControls(checked);
                                if (checked) {
                                    setBlackTimeControl({ ...whiteTimeControl });
                                }
                            }}
                            className="rounded border-white/10 bg-black/40 text-primary focus:ring-primary w-4 h-4"
                        />
                        <span className="text-xs font-semibold text-white">Same Time Control for Both Players</span>
                    </label>
                </div>

                {linkTimeControls ? (
                    renderTimeControlPanel(
                        "Shared", 
                        whiteTimeControl, 
                        (val) => { setWhiteTimeControl(val); setBlackTimeControl(val); }, 
                        whiteCustomInitial, 
                        setWhiteCustomInitial, 
                        whiteCustomInc, 
                        setWhiteCustomInc, 
                        whiteTimeUnit, 
                        setWhiteTimeUnit, 
                        whiteEngine?.path === 'manual' || blackEngine?.path === 'manual'
                    )
                ) : (
                    <div className="flex flex-col md:flex-row gap-6">
                        {renderTimeControlPanel(
                            "White", 
                            whiteTimeControl, 
                            setWhiteTimeControl, 
                            whiteCustomInitial, 
                            setWhiteCustomInitial, 
                            whiteCustomInc, 
                            setWhiteCustomInc, 
                            whiteTimeUnit, 
                            setWhiteTimeUnit, 
                            whiteEngine?.path === 'manual'
                        )}
                        {renderTimeControlPanel(
                            "Black", 
                            blackTimeControl, 
                            setBlackTimeControl, 
                            blackCustomInitial, 
                            setBlackCustomInitial, 
                            blackCustomInc, 
                            setBlackCustomInc, 
                            blackTimeUnit, 
                            setBlackTimeUnit, 
                            blackEngine?.path === 'manual'
                        )}
                    </div>
                )}
            </div>

            <button
                onClick={handleStart}
                className="w-full py-4 bg-primary text-black text-xl font-bold rounded-xl shadow-[0_0_20px_rgba(74,222,128,0.2)] hover:shadow-[0_0_30px_rgba(74,222,128,0.4)] hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-3"
            >
                <Sword className="w-6 h-6 fill-black" />
                Start Match
            </button>
            {showPrompt && <PromptModal title="Save Match Preset" onClose={() => setShowPrompt(false)} onSubmit={savePresetWithName} />}
            {showManagePresets && (
                <ManagePresetsModal
                    presets={presets}
                    onClose={() => setShowManagePresets(false)}
                    onDelete={handleDeletePreset}
                />
            )}
        </div>
    );
}

function ManagePresetsModal({ presets, onClose, onDelete }) {
    return (
        <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in">
            <div className="bg-card w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-6 space-y-4 animate-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg text-foreground">Manage Presets</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg text-muted-foreground"><X size={16} /></button>
                </div>
                
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1 scrollbar-hide">
                    {presets.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">No presets found.</p>
                    ) : (
                        presets.map(p => (
                            <div key={p.name} className="flex justify-between items-center p-3 bg-black/20 rounded-xl border border-white/5">
                                <span className="text-sm font-semibold text-white">{p.name}</span>
                                <button
                                    onClick={() => onDelete(p.name)}
                                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 hover:border-red-500/30 rounded-lg transition-colors flex items-center justify-center"
                                    title="Delete Preset"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <div className="pt-2">
                    <button
                        onClick={onClose}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-foreground font-medium rounded-xl transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

function EngineCard({ label, selected, engines, onSelect, color, icon, installedBooks = [], bookPath, onSelectBook, onSetBookPath, onClearBook }) {
    return (
        <div className="bg-card border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:border-white/10 transition-colors">
            <div className={`absolute top-0 left-0 w-1.5 h-full ${color === 'white' ? 'bg-zinc-200' : 'bg-zinc-800'}`}></div>

            <div className="flex justify-between items-center mb-4 pl-4">
                <h3 className="text-xl font-bold text-foreground">{label}</h3>
                <div className={`p-2 rounded-lg ${color === 'white' ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
                    {icon}
                </div>
            </div>

            <div className="pl-4">
                <select
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 appearance-none cursor-pointer hover:bg-black/50 transition-colors text-foreground focus:border-primary focus:outline-none"
                    value={selected?.name || ''}
                    onChange={(e) => {
                        onSelect(engines.find(eng => eng.name === e.target.value));
                        e.target.blur();
                    }}
                >
                    {engines.map(eng => (
                        <option key={eng.name} value={eng.name} className="bg-card text-foreground">
                            {eng.name}
                        </option>
                    ))}
                </select>

                <div className="mt-4 p-4 bg-black/20 rounded-xl min-h-[120px] flex items-center justify-center border border-dashed border-white/5">
                    {selected ? (
                        <div className="text-center">
                            <div className="text-5xl font-black opacity-10 font-mono tracking-tighter text-foreground">
                                {selected.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="mt-2 text-xs font-mono text-muted-foreground opacity-50 truncate max-w-[200px] mx-auto">
                                {selected.path}
                            </div>
                        </div>
                    ) : (
                        <div className="text-muted-foreground text-sm">Select an engine</div>
                    )}
                </div>

                {/* Book Selection */}
                <div className="mt-3 flex items-center gap-2">
                    <select
                        onChange={(e) => {
                            if (e.target.value === 'BROWSE') onSelectBook();
                            else onSetBookPath(e.target.value);
                            e.target.blur();
                        }}
                        value={bookPath || ""}
                        className="flex-1 py-2 bg-black/20 hover:bg-white/5 border border-white/5 rounded-lg text-xs font-mono text-muted-foreground focus:text-primary transition-colors pr-8 px-2 appearance-none cursor-pointer outline-none truncate"
                    >
                        <option value="" disabled>📖 Select Book (.bin)</option>
                        {installedBooks.map(b => <option key={b.path} value={b.path}>📖 {b.name}</option>)}
                        {bookPath && !installedBooks.find(b => b.path === bookPath) && (
                            <option value={bookPath}>📖 {bookPath.split(/[\\/]/).pop()}</option>
                        )}
                        <option value="BROWSE">Browse local files...</option>
                    </select>

                    {bookPath && (
                        <button onClick={onClearBook} className="p-2 hover:text-red-400 text-muted-foreground">×</button>
                    )}
                </div>
            </div>
        </div>
    )
}

function FormControl({ children, active, onClick, type }) {
    if (type === 'button') {
        return (
            <button
                onClick={onClick}
                className={`
                    w-full py-3 rounded-xl border font-medium transition-all
                    ${active ? 'bg-primary/20 border-primary text-primary' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'}
                `}
            >
                {children}
            </button>
        )
    }
}
