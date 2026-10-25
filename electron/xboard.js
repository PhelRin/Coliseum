// WinBoard / XBoard (CECP) engines, behind the same interface as UciEngine so the arbiter
// can play games with either kind:
//   start()  isReady()  sync()  setOption(name, value)  newGame(limits)
//   think({ startFen, moves, side }, go)  stop()  quit()
// and the events 'uciok' (handshake done), 'ready', 'bestmove', 'info', 'resign', 'quit', 'error'.
//
// Protocol notes (https://www.gnu.org/software/xboard/engine-intf.html):
//  * "xboard" + "protover 2", then the engine lists its features; "feature done=1" ends the list.
//    Protocol 1 engines send no features, so after a short wait the protocol defaults apply
//    (they can't be detected automatically; choose WinBoard for them in the engine settings).
//  * The engine is kept in force mode. When it is its turn it gets the moves it hasn't seen,
//    its clock ("time", centiseconds) and the opponent's ("otim"), then "go".
//  * Moves are coordinate notation (e2e4, e7e8q); a few engines answer in SAN, which the
//    arbiter converts.

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const { launchFile } = require('./linked-engines');

const FEATURE_WAIT_MS = 2000; // protocol 1 engines never send "feature done=1"
const FEATURE_DONE0_WAIT_MS = 15000; // "done=0": the engine asked for more time to start up

// features we understand and accept; anything else is rejected
const ACCEPTED = new Set([
    'ping', 'setboard', 'playother', 'usermove', 'time', 'draw', 'sigint', 'sigterm', 'reuse',
    'analyze', 'myname', 'variants', 'colors', 'ics', 'name', 'pause', 'nps', 'debug', 'memory', 'smp',
    'egt', 'option', 'done', 'exclude', 'setscore', 'highlight',
]);

class XboardEngine extends EventEmitter {
    constructor(enginePath, name, launchPath) {
        super();
        this.path = enginePath;
        this.launchPath = launchPath || null;
        this.name = name;
        this.protocol = 'xboard';
        this.process = null;
        this.buffer = '';
        this.verbose = true;
        this.features = {}; // as sent by the engine
        this.options = new Map(); // lower-cased name -> { name, type, ... } in UCI terms
        this.uciOk = false; // handshake done (name kept so the arbiter can treat both alike)
        this.ready = false;
        this.pingId = 0;
        this.featureTimer = null;
        this.positionSent = false;
        this.synced = 0; // plies of the game the engine already knows
        this.limits = {};
    }

    start() {
        try {
            this.process = spawn(this.launchPath || launchFile(this.path), { cwd: path.dirname(this.path) });
            this.process.stdout.on('data', (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop();
                for (const line of lines) if (line.trim()) this.parseLine(line.trim());
            });
            this.process.stderr.on('data', (data) => {
                if (this.verbose) console.error(`[${this.name}] stderr: ${data}`);
            });
            this.process.on('close', (code) => this.emit('quit', code));
            this.process.on('error', (err) => {
                console.error(`[${this.name}] Process Error:`, err);
                this.emit('error', err);
            });
            this.process.stdin.on('error', (err) => console.error(`[${this.name}] Stdin Error:`, err.message));

            this.send('xboard');
            this.send('protover 2');
            this.featureTimer = setTimeout(() => this.featuresDone(), FEATURE_WAIT_MS);
        } catch (error) {
            console.error(`Failed to start engine ${this.name}:`, error);
            this.emit('error', error);
        }
    }

    send(command) {
        if (!this.process) return;
        if (this.verbose) console.log(`[Algorithm -> ${this.name}] ${command}`);
        try {
            this.process.stdin.write(command + '\n');
        } catch (e) {
            console.error(`[XBoard] Failed to write to engine ${this.name}:`, e.message);
        }
    }

    parseLine(line) {
        if (this.verbose) console.log(`[${this.name} -> Algorithm] ${line}`);
        if (line.startsWith('#')) return; // comment / debug output

        if (/^feature\s/.test(line)) {
            this.parseFeatures(line.slice(8));
            return;
        }
        let m;
        if ((m = line.match(/^pong\s+(\d+)/))) {
            if (Number(m[1]) === this.pingId) {
                this.ready = true;
                this.emit('ready');
            }
            return;
        }
        if ((m = line.match(/^move\s+(\S+)/)) || (m = line.match(/^my move is\s*:?\s*(\S+)/i)) || (m = line.match(/^\d+\s*\.\s*\.\.\.\s*(\S+)/))) {
            this.synced += 1; // the engine has played it on its own board
            this.send('force'); // and must not start thinking (pondering) on the opponent's time
            this.emit('bestmove', m[1]);
            return;
        }
        if (/^resign\b/i.test(line) || /^tellics\s+resign\b/i.test(line)) {
            this.emit('resign');
            return;
        }
        if (/^offer\s+draw/i.test(line)) {
            this.emit('drawoffer');
            return;
        }
        if ((m = line.match(/^(1-0|0-1|1\/2-1\/2)\s*(\{.*\})?/))) {
            this.emit('claim', { result: m[1], comment: (m[2] || '').replace(/[{}]/g, '').trim() });
            return;
        }
        if (/^(Illegal move|Error)/i.test(line)) {
            console.error(`[${this.name}] ${line}`);
            this.emit('engine-error', line);
            return;
        }
        // thinking output: ply score time(cs) nodes pv
        if ((m = line.match(/^(\d+)[.&?!+-]*\s+(-?\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/))) {
            const score = Number(m[2]);
            const info = {
                depth: m[1],
                time: String(Number(m[3]) * 10),
                nodes: m[4],
                pv: (m[5] || '').replace(/\{[^}]*\}/g, '').replace(/\b\d+\.(\.\.)?/g, '').replace(/\s+/g, ' ').trim(),
                score: xboardScore(score),
            };
            this.emit('info', info);
        }
    }

    // feature key=value key="quoted value" ...
    parseFeatures(text) {
        const re = /(\w+)=("([^"]*)"|\S+)/g;
        let m;
        while ((m = re.exec(text))) {
            const key = m[1];
            const value = m[3] !== undefined ? m[3] : m[2];
            if (!ACCEPTED.has(key)) {
                this.send(`rejected ${key}`);
                continue;
            }
            if (key === 'option') this.addOption(value);
            else this.features[key] = /^\d+$/.test(value) ? Number(value) : value;
            if (key !== 'done') this.send(`accepted ${key}`);
            if (key === 'done') {
                clearTimeout(this.featureTimer);
                if (Number(value) === 1) this.featuresDone();
                else this.featureTimer = setTimeout(() => this.featuresDone(), FEATURE_DONE0_WAIT_MS);
            }
        }
    }

    // option="Name -type ..." -> the same shape UCI options have
    addOption(def) {
        const m = def.match(/^(.*?)\s+-(check|spin|slider|combo|string|file|path|button|save|reset)\b\s*(.*)$/);
        if (!m) return;
        const name = m[1].trim();
        const kind = m[2];
        const rest = m[3].trim();
        let opt;
        if (kind === 'check') opt = { name, type: 'check', default: rest === '1' ? 'true' : 'false' };
        else if (kind === 'spin' || kind === 'slider') {
            const [def0, min, max] = rest.split(/\s+/).map(Number);
            opt = { name, type: 'spin', default: String(def0), min, max };
        } else if (kind === 'combo') {
            const choices = rest.split(/\s*\/\/\/\s*/).map((s) => s.trim()).filter(Boolean);
            const def0 = (choices.find((c) => c.startsWith('*')) || choices[0] || '').replace(/^\*/, '');
            opt = { name, type: 'combo', default: def0, options: choices.map((c) => c.replace(/^\*/, '')) };
        } else if (kind === 'string' || kind === 'file' || kind === 'path') opt = { name, type: 'string', default: rest };
        else opt = { name, type: 'button' };
        opt.xboard = kind;
        this.options.set(name.toLowerCase(), opt);
    }

    featuresDone() {
        clearTimeout(this.featureTimer);
        if (this.uciOk) return;
        if (typeof this.features.myname === 'string' && this.features.myname.trim()) this.name = this.features.myname.trim();
        // memory / cores are separate commands in this protocol; offer them as options
        if (this.features.memory === 1 && !this.options.has('hash')) this.options.set('hash', { name: 'Hash', type: 'spin', default: '64', min: 1, max: 65536, special: 'memory' });
        if (this.features.smp === 1 && !this.options.has('threads')) this.options.set('threads', { name: 'Threads', type: 'spin', default: '1', min: 1, max: 512, special: 'cores' });
        this.uciOk = true;
        this.emit('uciok');
    }

    waitForUciOk(timeout = 5000) {
        return new Promise((resolve) => {
            if (this.uciOk) return resolve(true);
            const timer = setTimeout(() => {
                this.removeListener('uciok', onOk);
                resolve(false);
            }, timeout);
            const onOk = () => {
                clearTimeout(timer);
                resolve(true);
            };
            this.once('uciok', onOk);
        });
    }

    hasOption(name) {
        return this.options.has(String(name).toLowerCase());
    }

    setOption(name, value) {
        const opt = this.options.get(String(name).toLowerCase());
        if (!opt) return;
        if (opt.special === 'memory') return this.send(`memory ${parseInt(value, 10) || 64}`);
        if (opt.special === 'cores') return this.send(`cores ${parseInt(value, 10) || 1}`);
        if (opt.type === 'button') return this.send(`option ${opt.name}`);
        if (opt.type === 'check') return this.send(`option ${opt.name}=${String(value) === 'true' || String(value) === '1' ? 1 : 0}`);
        this.send(`option ${opt.name}=${value}`);
    }

    // engines without "ping" can't be synchronised; they are taken as ready
    isReady(timeout = 10000) {
        if (this.ready) return Promise.resolve();
        return this.sync(timeout);
    }

    sync(timeout = 10000) {
        if (!this.features.ping) {
            this.ready = true;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.removeListener('ready', onReady);
                reject(new Error('Timeout waiting for pong'));
            }, timeout);
            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };
            this.ready = false;
            this.once('ready', onReady);
            this.pingId += 1;
            this.send(`ping ${this.pingId}`);
        });
    }

    /**
     * limits: this engine's side of the time control:
     *   { initial, inc } clock (ms) | { movetime } | { depth } | { nodes } | { type: 'unlimited' }
     */
    newGame(limits = {}) {
        this.limits = limits || {};
        this.send('new');
        this.send('easy'); // no pondering
        this.send('post'); // thinking output
        this.send('computer');
        const l = this.limits;
        if (l.movetime && l.movetime % 1000 === 0) this.send(`st ${l.movetime / 1000}`);
        else if (l.movetime) {
            // "st" only takes whole seconds: one move per time control instead, with the
            // clock set to exactly the move time before every move (see think())
            this.send('level 1 0:01 0');
        }
        else if (l.depth) {
            this.send(`sd ${l.depth}`);
            this.send('st 86400'); // the depth limit ends the search, not the clock
        } else if (l.nodes) {
            // node-count mode: searching for 1 "second" at N nodes per second = N nodes
            this.send(`nps ${l.nodes}`);
            this.send('st 1');
        } else if (l.type === 'unlimited' || !(l.initial > 0)) {
            this.send('level 0 999 0');
        } else {
            this.send(`level 0 ${levelBase(l.initial)} ${+((l.inc || 0) / 1000).toFixed(2)}`);
        }
        this.send('force');
        this.positionSent = false;
        this.synced = 0;
    }

    /**
     * position: { startFen, moves (UCI, every move of the game so far), side ('w'|'b') }
     * go: { wtime, btime, ... } as for UCI (only the clocks are used here)
     */
    think(position, go = {}) {
        this.send('force');
        if (!this.positionSent) {
            if (position.startFen) this.sendBoard(position.startFen);
            this.positionSent = true;
            this.synced = 0;
        }
        const moves = position.moves || [];
        for (let i = this.synced; i < moves.length; i++) this.send(this.features.usermove ? `usermove ${moves[i]}` : moves[i]);
        this.synced = moves.length;
        if (this.limits.movetime && this.limits.movetime % 1000 !== 0) {
            const cs = Math.max(1, Math.round(this.limits.movetime / 10));
            if (this.features.time !== 0) {
                this.send(`time ${cs}`);
                this.send(`otim ${cs}`);
            }
        } else if (this.features.time !== 0 && go.wtime !== undefined && go.btime !== undefined && !this.limits.movetime && !this.limits.depth && !this.limits.nodes) {
            const own = position.side === 'b' ? go.btime : go.wtime;
            const opp = position.side === 'b' ? go.wtime : go.btime;
            this.send(`time ${Math.max(1, Math.round(own / 10))}`);
            this.send(`otim ${Math.max(1, Math.round(opp / 10))}`);
        }
        this.send('go');
    }

    sendBoard(fen) {
        // "setboard" has to be announced (its default is off); otherwise the older "edit" mode
        if (this.features.setboard === 1) {
            this.send(`setboard ${fen}`);
            return;
        }
        const [placement, turn] = fen.split(' ');
        // edit mode doesn't set the side to move: a first move from the start position does
        if (turn === 'b') this.send(this.features.usermove ? 'usermove a2a3' : 'a2a3');
        this.send('edit');
        this.send('#');
        const rows = placement.split('/');
        const pieces = { w: [], b: [] };
        rows.forEach((row, r) => {
            let file = 0;
            for (const ch of row) {
                if (/\d/.test(ch)) {
                    file += Number(ch);
                    continue;
                }
                const sq = 'abcdefgh'[file] + (8 - r);
                (ch === ch.toUpperCase() ? pieces.w : pieces.b).push(ch.toUpperCase() + sq);
                file++;
            }
        });
        pieces.w.forEach((p) => this.send(p));
        this.send('c');
        pieces.b.forEach((p) => this.send(p));
        this.send('.');
    }

    stop() {
        this.send('?'); // move now
    }

    quit() {
        this.send('quit');
        const proc = this.process;
        if (!proc) return;
        setTimeout(() => {
            if (proc.exitCode !== null) return;
            try {
                const kill = require('tree-kill');
                kill(proc.pid, 'SIGKILL', () => {});
            } catch (e) {
                try {
                    proc.kill();
                } catch (err) { /* gone */ }
            }
        }, 300);
    }
}

// "level" base time: minutes, or minutes:seconds
function levelBase(ms) {
    const total = Math.max(1, Math.round(ms / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return sec ? `${min}:${String(sec).padStart(2, '0')}` : String(min);
}

// xboard engines report mates as very large scores (e.g. 100000 - plies, or 32000 - plies)
function xboardScore(s) {
    const a = Math.abs(s);
    for (const base of [100000, 32767, 32000, 30000]) {
        if (a > base - 500 && a <= base) {
            const plies = base - a;
            const moves = Math.max(1, Math.ceil(plies / 2));
            return { unit: 'mate', value: String(s > 0 ? moves : -moves) };
        }
    }
    return { unit: 'cp', value: String(s) };
}

module.exports = { XboardEngine, levelBase, xboardScore };
