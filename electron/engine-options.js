// Engine options: reading an engine's "option" lines, and deciding which saved settings are
// sent to it at start-up.
//
// The rule: an engine is only ever sent settings the user changed. A setting that is the
// engine's own default, has no value, isn't a valid value for its type, or is a button, is not
// sent. An engine nobody configured gets no "setoption" at all, exactly as when it is started
// by hand.

const TYPES = new Set(['check', 'spin', 'combo', 'button', 'string']);

// "option name <name> type <type> [default <x>] [min <n>] [max <n>] [var <x>]..." (UCI).
// Names, string defaults and combo values may contain spaces. The line may end in "\r".
function parseOptionLine(line) {
    const parts = String(line || '').trim().split(/\s+/);
    if (parts[0] !== 'option' || parts[1] !== 'name') return null;
    let typeIdx = -1;
    for (let i = 3; i < parts.length - 1; i++) {
        if (parts[i] === 'type' && TYPES.has(parts[i + 1])) {
            typeIdx = i;
            break;
        }
    }
    if (typeIdx < 0) return null;
    const opt = { name: parts.slice(2, typeIdx).join(' '), type: parts[typeIdx + 1] };
    const rest = parts.slice(typeIdx + 2);
    if (opt.type === 'string') {
        // everything after "default" is the value (a path can contain any word)
        const d = rest.indexOf('default');
        if (d > -1) opt.default = rest.slice(d + 1).join(' ');
    } else if (opt.type === 'check') {
        const d = rest.indexOf('default');
        if (d > -1 && rest[d + 1] !== undefined) opt.default = rest[d + 1];
    } else if (opt.type === 'spin') {
        for (let i = 0; i < rest.length - 1; i++) {
            if (rest[i] === 'default') opt.default = rest[i + 1];
            else if (rest[i] === 'min' && Number.isFinite(Number(rest[i + 1]))) opt.min = Number(rest[i + 1]);
            else if (rest[i] === 'max' && Number.isFinite(Number(rest[i + 1]))) opt.max = Number(rest[i + 1]);
        }
    } else if (opt.type === 'combo') {
        opt.options = [];
        let key = null;
        let words = [];
        const flush = () => {
            if (key === 'default') opt.default = words.join(' ');
            else if (key === 'var' && words.length) opt.options.push(words.join(' '));
        };
        for (const w of rest) {
            if (w === 'default' || w === 'var') {
                flush();
                key = w;
                words = [];
            } else if (key) {
                words.push(w);
            }
        }
        flush();
    }
    return opt;
}

const JUNK = new Set(['undefined', 'null', 'nan']);
const isJunk = (v) => v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) || JUNK.has(String(v).trim().toLowerCase());
const emptyString = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === '<empty>';

// The value to send for `opt` (an option the engine listed), as text, or null when nothing
// should be sent: no real value, not valid for the option's type, a button, or the engine's
// own default.
function valueToSend(opt, value) {
    if (!opt || opt.type === 'button') return null;
    if (opt.type === 'string') {
        if (value === undefined || value === null || JUNK.has(String(value).trim().toLowerCase())) return null;
        const v = String(value).trim();
        if (emptyString(v)) return emptyString(opt.default) ? null : '<empty>';
        return opt.default !== undefined && v === String(opt.default).trim() ? null : v;
    }
    if (isJunk(value)) return null;
    if (opt.type === 'spin') {
        if (!/^[+-]?\d+$/.test(String(value).trim())) return null;
        let n = parseInt(String(value).trim(), 10);
        if (Number.isFinite(opt.min) && n < opt.min) n = opt.min;
        if (Number.isFinite(opt.max) && n > opt.max) n = opt.max;
        // Hash and Threads of WinBoard engines ("memory", "cores") have no default of their own
        if (!opt.special && opt.default !== undefined && /^[+-]?\d+$/.test(String(opt.default).trim()) && parseInt(opt.default, 10) === n) return null;
        return String(n);
    }
    if (opt.type === 'check') {
        const v = String(value).trim().toLowerCase();
        if (v !== 'true' && v !== 'false') return null;
        return opt.default !== undefined && String(opt.default).trim().toLowerCase() === v ? null : v;
    }
    if (opt.type === 'combo') {
        const v = String(value).trim();
        if (!v) return null;
        const vars = opt.options || [];
        const match = vars.find((x) => x.toLowerCase() === v.toLowerCase());
        if (vars.length && !match) return null;
        const chosen = match || v;
        return opt.default !== undefined && String(opt.default).trim().toLowerCase() === chosen.toLowerCase() ? null : chosen;
    }
    return null;
}

// `listed`: the options an engine reported, as a Map (lower-cased name -> option) or an array.
function byName(listed) {
    if (listed instanceof Map) return listed;
    const m = new Map();
    for (const o of listed || []) if (o && o.name) m.set(String(o.name).toLowerCase(), o);
    return m;
}

// The saved settings worth sending to an engine that listed `listed`: [[name, value], ...],
// with the engine's own spelling of each name. `skip`: lower-cased names to leave out.
function settingsToSend(listed, saved, skip = []) {
    const options = byName(listed);
    const out = [];
    for (const [name, value] of Object.entries(saved || {})) {
        const key = String(name).toLowerCase();
        if (skip.includes(key)) continue;
        const opt = options.get(key);
        const v = valueToSend(opt, value);
        if (v !== null) out.push([opt.name, v]);
    }
    return out;
}

// What the options window saves: only the settings that differ from the engine's defaults.
function changedSettings(available, values) {
    const out = {};
    for (const [name, value] of settingsToSend(available, values)) out[name] = value;
    return out;
}

// Send an engine its saved settings; returns what was sent.
function applySaved(engine, saved, skip = []) {
    const sent = settingsToSend(engine.options, saved, skip);
    for (const [name, value] of sent) engine.setOption(name, value);
    return sent;
}

// Values that were never real settings (written by the options window of 4.0.2 and earlier).
function scrub(saved) {
    const out = {};
    for (const [name, value] of Object.entries(saved || {})) if (!isJunk(value)) out[name] = value;
    return out;
}

module.exports = { parseOptionLine, valueToSend, settingsToSend, changedSettings, applySaved, scrub };
