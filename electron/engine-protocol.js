// Which protocol each engine speaks: UCI or WinBoard (xboard / CECP).
//
// "auto" (the default) asks the engine: it is sent "uci" and is a UCI engine if it answers
// "uciok"; otherwise it gets "xboard" + "protover 2" and is a WinBoard engine if it lists its
// features. The answer is remembered per engine file until the file changes (a new build).
// The protocol can also be set by hand in the engine's settings.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const UciEngine = require('./uci');
const { XboardEngine } = require('./xboard');
const { launchFile } = require('./linked-engines');

const DETECT_MS = 4000;

let file = null;
let data = {}; // enginePath -> { mode: 'auto'|'uci'|'xboard', detected, sig }
const inFlight = new Map();

function init(userDataPath) {
    file = path.join(userDataPath, 'engine_protocols.json');
    try {
        if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) {
        data = {};
    }
}

function save() {
    if (!file) return;
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Protocol] Could not save:', e.message);
    }
}

function signature(p) {
    try {
        const st = fs.statSync(p);
        return `${Math.round(st.mtimeMs)}-${st.size}`;
    } catch (e) {
        return null;
    }
}

function getInfo(enginePath) {
    const e = data[enginePath] || {};
    const fresh = e.detected && e.sig === signature(enginePath);
    return { mode: e.mode || 'auto', detected: fresh ? e.detected : null };
}

function setMode(enginePath, mode) {
    const m = ['uci', 'xboard'].includes(mode) ? mode : 'auto';
    data[enginePath] = { ...(data[enginePath] || {}), mode: m };
    if (m === 'auto') delete data[enginePath].detected; // ask the engine again
    save();
    return getInfo(enginePath);
}

function rename(oldPath, newPath) {
    if (!data[oldPath]) return;
    data[newPath] = { ...data[oldPath] };
    delete data[oldPath];
    save();
}

/** 'uci' | 'xboard' for this engine (asks the engine if needed). */
async function resolveProtocol(enginePath) {
    const info = getInfo(enginePath);
    if (info.mode !== 'auto') return info.mode;
    if (info.detected) return info.detected;
    if (!inFlight.has(enginePath)) {
        inFlight.set(enginePath, detect(enginePath).then((proto) => {
            // only a clear answer is remembered; an engine that said nothing is asked again next time
            if (proto) {
                data[enginePath] = { ...(data[enginePath] || {}), mode: 'auto', detected: proto, sig: signature(enginePath) };
                save();
            }
            inFlight.delete(enginePath);
            return proto || 'uci';
        }));
    }
    return inFlight.get(enginePath);
}

// The cached protocol without asking the engine (UCI when unknown).
function knownProtocol(enginePath) {
    const info = getInfo(enginePath);
    return info.mode !== 'auto' ? info.mode : info.detected || 'uci';
}

async function detect(enginePath) {
    if (await probe(enginePath, ['uci'], /^\s*uciok\b/m)) return 'uci';
    if (await probe(enginePath, ['xboard', 'protover 2'], /^\s*feature\s/m)) return 'xboard';
    return null;
}

function probe(enginePath, commands, answer) {
    return new Promise((resolve) => {
        let out = '';
        let done = false;
        let proc;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                proc.stdin.write('quit\n');
            } catch (e) { /* closed */ }
            setTimeout(() => {
                try {
                    if (proc.exitCode === null) require('tree-kill')(proc.pid, 'SIGKILL', () => {});
                } catch (e) { /* gone */ }
            }, 200);
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), DETECT_MS);
        try {
            proc = spawn(launchFile(enginePath), { cwd: path.dirname(enginePath) });
        } catch (e) {
            clearTimeout(timer);
            resolve(false);
            return;
        }
        proc.on('error', () => finish(false));
        proc.on('close', () => finish(answer.test(out)));
        proc.stdin.on('error', () => {});
        proc.stdout.on('data', (d) => {
            out += d.toString();
            if (answer.test(out)) finish(true);
        });
        for (const c of commands) {
            try {
                proc.stdin.write(c + '\n');
            } catch (e) { /* closed */ }
        }
    });
}

function createEngine(enginePath, name, launchPath, protocol) {
    return protocol === 'xboard' ? new XboardEngine(enginePath, name, launchPath) : new UciEngine(enginePath, name, launchPath);
}

module.exports = { init, getInfo, setMode, rename, resolveProtocol, knownProtocol, createEngine };
