import React, { useState, useEffect } from 'react';
import { Settings, X, Save, RotateCcw } from 'lucide-react';
import { defaultValue, startValue, isChanged, changedValues } from '../utils/engineOptionValues';

export function EngineConfigModal({ engine, onClose }) {
    const [options, setOptions] = useState([]);
    const [values, setValues] = useState({});
    const [loading, setLoading] = useState(true);
    const [protocol, setProtocol] = useState(null); // { protocol, mode }
    const [link, setLink] = useState(null); // { linked, copy }: for a linked engine, whether it runs as a copy
    const [loadError, setLoadError] = useState(null);
    const [reload, setReload] = useState(0);

    const changeProtocol = async (mode) => {
        if (!window.electronAPI) return;
        await window.electronAPI.invoke('set-engine-protocol', { path: engine.path, mode });
        setReload((n) => n + 1);
    };

    const changeCopy = async (copy) => {
        if (!window.electronAPI) return;
        await window.electronAPI.invoke('set-engine-copy', { path: engine.path, copy });
        setLink((l) => ({ ...(l || { linked: true }), copy }));
        setReload((n) => n + 1);
    };

    // asked on its own, so the switch is there even for an engine that doesn't start
    useEffect(() => {
        if (!window.electronAPI || !engine) return;
        window.electronAPI.invoke('get-engine-info', engine.path).then((info) => setLink(info || null)).catch(() => setLink(null));
    }, [engine]);

    useEffect(() => {
        if (window.electronAPI && engine) {
            setLoading(true);
            setLoadError(null);
            window.electronAPI.getEngineOptions(engine.path).then(data => {
                setProtocol({ protocol: data.protocol || 'uci', mode: data.protocolMode || 'auto' });
                // buttons ("Clear Hash") are actions, not settings: they are never saved or sent
                const settings = data.available.filter(opt => opt.type !== 'button');
                setOptions(settings);
                // the engine's defaults, with the saved settings on top
                const initialValues = {};
                const saved = data.saved || {};
                settings.forEach(opt => {
                    initialValues[opt.name] = startValue(opt, saved[opt.name]);
                });
                setValues(initialValues);
                setLoading(false);
            }).catch(err => {
                console.error("Failed to load options", err);
                setOptions([]);
                setLoadError('The engine did not answer. If it is a WinBoard engine, choose WinBoard below.');
                setLoading(false);
            });
        }
    }, [engine, reload]);

    const handleChange = (name, value, type) => {
        let v = value;
        if (type === 'spin') {
            const n = parseInt(value, 10);
            v = Number.isFinite(n) ? n : ''; // an emptied box means "the engine's default"
        }
        setValues(prev => ({ ...prev, [name]: v }));
    };

    const resetToDefaults = () => {
        const defaults = {};
        options.forEach(opt => {
            defaults[opt.name] = defaultValue(opt);
        });
        setValues(defaults);
    };

    // Only what differs from the engine's defaults is saved, and only that is sent to the engine
    // when it starts. An engine with nothing changed is started exactly as it is by hand.
    const handleSave = async () => {
        if (window.electronAPI) {
            await window.electronAPI.saveEngineOptions(engine.path, changedValues(options, values), options);
            onClose();
        }
    };

    const changedCount = options.filter(opt => isChanged(opt, values[opt.name])).length;

    if (!engine) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-2xl max-h-[85vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col">
                <div className="flex items-center justify-between p-6 border-b border-white/5">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-3">
                            <Settings className="text-primary" />
                            Configure {engine.name}
                        </h2>
                        <p className="text-sm text-muted-foreground font-mono mt-1 opacity-70">{engine.path}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-black/20 border border-white/5 rounded-xl p-3">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">Protocol</div>
                            <div className="text-xs text-muted-foreground">
                                {protocol ? (protocol.mode === 'auto' ? `Detected: ${protocol.protocol === 'xboard' ? 'WinBoard (xboard)' : 'UCI'}` : 'Set by hand') : 'Checking…'}
                            </div>
                        </div>
                        <div className="flex gap-1 bg-black/40 border border-white/10 rounded-xl p-1">
                            {[['auto', 'Auto'], ['uci', 'UCI'], ['xboard', 'WinBoard']].map(([k, label]) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => changeProtocol(k)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${(protocol?.mode || 'auto') === k ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {link && link.linked && (
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-black/20 border border-white/5 rounded-xl p-3">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-foreground">Run a copy</div>
                                <div className="text-xs text-muted-foreground">
                                    {link.copy
                                        ? 'On: Coliseum plays with a copy of the file, so you can rebuild the engine while it is in use.'
                                        : 'Off: the engine runs from its own folder. Switch on for an engine you are building, so you can rebuild it while Coliseum is using it.'}
                                </div>
                            </div>
                            <div className="flex gap-1 bg-black/40 border border-white/10 rounded-xl p-1">
                                {[[false, 'Off'], [true, 'On']].map(([k, label]) => (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => changeCopy(k)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${link.copy === k ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {link && link.linked && link.copy && (
                        <p className="text-xs text-muted-foreground -mt-3">Engines that look for files next to themselves (Lc0 and its network, adapters, licensed engines) may not work as a copy.</p>
                    )}
                    {protocol && protocol.protocol === 'xboard' && !loading && (
                        <p className="text-xs text-muted-foreground -mt-3">WinBoard engines play games, tournaments and Elo runs. Analysis, Game Review and the Tactics Trainer need a UCI engine.</p>
                    )}
                    {loadError && !loading && <p className="text-sm text-red-400">{loadError}</p>}
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                        </div>
                    ) : options.length === 0 ? (
                        <div className="text-center text-muted-foreground py-10">No configurable options found.</div>
                    ) : (
                        options.map((opt, i) => (
                            <div key={i} className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-foreground flex justify-between">
                                    <span>
                                        {opt.name}
                                        {isChanged(opt, values[opt.name]) && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-primary">changed</span>}
                                    </span>
                                    {opt.type === 'spin' && Number.isFinite(opt.min) && Number.isFinite(opt.max) && <span className="text-xs text-muted-foreground">Min: {opt.min} Max: {opt.max}</span>}
                                </label>

                                {opt.type === 'check' && (
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => handleChange(opt.name, !values[opt.name], 'check')}
                                            className={`w-12 h-6 rounded-full transition-colors relative ${values[opt.name] ? 'bg-primary' : 'bg-white/10'}`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-md ${values[opt.name] ? 'left-7' : 'left-1'}`} />
                                        </button>
                                        <span className="text-sm text-muted-foreground">{values[opt.name] ? 'Enabled' : 'Disabled'}</span>
                                    </div>
                                )}

                                {opt.type === 'spin' && (
                                    <div className="flex gap-4 items-center">
                                        {Number.isFinite(opt.min) && Number.isFinite(opt.max) && (
                                            <input
                                                type="range"
                                                min={opt.min}
                                                max={opt.max}
                                                value={values[opt.name] === '' || values[opt.name] === undefined ? opt.min : values[opt.name]}
                                                onChange={(e) => handleChange(opt.name, e.target.value, 'spin')}
                                                className="flex-1 accent-primary h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                                            />
                                        )}
                                        <input
                                            type="number"
                                            min={Number.isFinite(opt.min) ? opt.min : undefined}
                                            max={Number.isFinite(opt.max) ? opt.max : undefined}
                                            value={values[opt.name] ?? ''}
                                            placeholder="default"
                                            onChange={(e) => handleChange(opt.name, e.target.value, 'spin')}
                                            className="w-24 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-right font-mono text-sm"
                                        />
                                    </div>
                                )}

                                {opt.type === 'string' && (
                                    <input
                                        type="text"
                                        value={values[opt.name] || ''}
                                        onChange={(e) => handleChange(opt.name, e.target.value, 'string')}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-3 text-sm focus:border-primary outline-none"
                                    />
                                )}

                                {opt.type === 'combo' && (
                                    <div className="relative">
                                        <select
                                            value={values[opt.name] ?? ''}
                                            onChange={(e) => handleChange(opt.name, e.target.value, 'combo')}
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-3 text-sm focus:border-primary outline-none appearance-none cursor-pointer"
                                        >
                                            {opt.options?.map((val, idx) => (
                                                <option key={idx} value={val} className="bg-background text-foreground">
                                                    {val}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground">
                                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                        </div>
                                    </div>
                                )}

                            </div>
                        ))
                    )}
                </div>

                <div className="p-6 border-t border-white/5 bg-black/20 rounded-b-2xl">
                    {!loading && options.length > 0 && (
                        <p className="text-xs text-muted-foreground mb-3">
                            {changedCount === 0
                                ? 'Nothing is changed: the engine starts with its own defaults.'
                                : `${changedCount} ${changedCount === 1 ? 'setting is' : 'settings are'} changed. Only changed settings are sent to the engine when it starts.`}
                        </p>
                    )}
                    <div className="flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={resetToDefaults}
                        disabled={loading || options.length === 0 || changedCount === 0}
                        title="Put every setting back to the engine's own default"
                        className="mr-auto px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-colors flex items-center gap-2 text-sm disabled:opacity-40"
                    >
                        <RotateCcw size={16} />
                        Reset to defaults
                    </button>
                    <button onClick={onClose} className="px-6 py-2.5 rounded-xl hover:bg-white/5 transition-colors">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-6 py-2.5 bg-primary text-black font-bold rounded-xl hover:brightness-110 active:scale-[0.99] transition-all flex items-center gap-2 shadow-[0_0_15px_hsl(var(--primary)/0.2)] disabled:opacity-50"
                    >
                        <Save size={18} />
                        Save Configuration
                    </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
