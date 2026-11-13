// The values the engine options window shows and saves.

// What an option shows before the user touches it: the engine's own default.
export const defaultValue = (opt) => {
    if (opt.type === 'spin') {
        const n = parseInt(opt.default, 10);
        return Number.isFinite(n) ? n : '';
    }
    if (opt.type === 'check') return String(opt.default).trim().toLowerCase() === 'true';
    if (opt.type === 'combo') return opt.default ?? opt.options?.[0] ?? '';
    if (opt.type === 'string') return !opt.default || opt.default === '<empty>' ? '' : opt.default;
    return undefined;
};

// A saved value, if it is a real one for this kind of option; otherwise the default.
export const startValue = (opt, saved) => {
    const def = defaultValue(opt);
    if (saved === undefined || saved === null) return def;
    if (opt.type === 'spin') {
        const n = parseInt(saved, 10);
        return Number.isFinite(n) ? n : def;
    }
    if (opt.type === 'check') return String(saved).trim().toLowerCase() === 'true';
    if (opt.type === 'string') return saved === '<empty>' ? '' : String(saved);
    return String(saved);
};

export const isChanged = (opt, value) => String(value ?? '') !== String(defaultValue(opt) ?? '');

// The settings that differ from the engine's defaults: the only ones that are saved.
export const changedValues = (options, values) => {
    const changed = {};
    options.forEach((opt) => {
        if (opt.type !== 'button' && isChanged(opt, values[opt.name])) changed[opt.name] = values[opt.name];
    });
    return changed;
};
