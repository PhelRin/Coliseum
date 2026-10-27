const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const { launchFile } = require('./linked-engines');

class UciEngine extends EventEmitter {
    // launchPath: the file to actually run, when it differs from the engine's path (a pinned
    // snapshot of a linked engine). The engine keeps its own folder as working directory.
    constructor(enginePath, name, launchPath) {
        super();
        this.path = enginePath;
        this.launchPath = launchPath || null;
        this.name = name;
        this.process = null;
        this.ready = false;
        this.options = new Map();
        this.id = Math.random().toString(36).substr(2, 9);
        this.buffer = '';
        this.verbose = true; // set false to silence per-line logging (analysis engines are very chatty)
        this.uciOk = false;
        this.protocol = 'uci';
    }

    start() {
        try {
            const engineDir = path.dirname(this.path);
            this.process = spawn(this.launchPath || launchFile(this.path), { cwd: engineDir });

            this.process.stdout.on('data', (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split('\n');
                // The last element is either empty (if ended with \n) or an incomplete line
                this.buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim()) this.parseLine(line.trim());
                }
            });

            this.process.stderr.on('data', (data) => {
                console.error(`[${this.name}] Error: ${data}`);
            });

            this.process.on('close', (code) => {
                this.emit('quit', code);
            });

            this.process.on('error', (err) => {
                console.error(`[${this.name}] Process Error:`, err);
                this.emit('error', err);
            });

            // Prevent EPIPE crashes
            this.process.stdin.on('error', (err) => {
                console.error(`[${this.name}] Stdin Error:`, err.message);
            });

            this.send('uci');
        } catch (error) {
            console.error(`Failed to start engine ${this.name}:`, error);
            this.emit('error', error);
        }
    }

    send(command) {
        if (this.process) {
            if (this.verbose) console.log(`[Algorithm -> ${this.name}] ${command}`);
            try {
                this.process.stdin.write(command + '\n');
            } catch (e) {
                console.error(`[UCI] Failed to write to engine ${this.name}:`, e.message);
            }
        }
    }

    parseLine(line) {
        if (this.verbose) console.log(`[${this.name} -> Algorithm] ${line}`);
        const parts = line.split(/\s+/);
        const cmd = parts[0];

        switch (cmd) {
            case 'id':
                if (parts[1] === 'name') {
                    this.name = parts.slice(2).join(' '); // Update name from engine
                }
                break;
            case 'uciok':
                this.uciOk = true;
                this.emit('uciok');
                break;
            case 'readyok':
                this.ready = true;
                this.emit('ready');
                break;
            case 'option': {
                // option name <Name with spaces> type <Type> [default <Default>] [min <Min> max <Max>]
                const typeIdx = parts.indexOf('type');
                if (parts[1] === 'name' && typeIdx > 2) {
                    const optName = parts.slice(2, typeIdx).join(' ');
                    const opt = { name: optName, type: parts[typeIdx + 1] };
                    const minIdx = parts.indexOf('min');
                    const maxIdx = parts.indexOf('max');
                    const defIdx = parts.indexOf('default');
                    if (minIdx > -1) opt.min = Number(parts[minIdx + 1]);
                    if (maxIdx > -1) opt.max = Number(parts[maxIdx + 1]);
                    if (defIdx > -1) opt.default = parts[defIdx + 1];
                    this.options.set(optName.toLowerCase(), opt);
                }
                break;
            }
            case 'bestmove':
                this.emit('bestmove', parts[1], parts[3]); // bestmove <move> [ponder <move>]
                break;
            case 'info':
                this.emit('info', this.parseInfo(parts.slice(1)));
                break;
        }
    }

    parseInfo(parts) {
        const info = {};
        for (let i = 0; i < parts.length; i++) {
            const key = parts[i];
            const value = parts[i + 1];

            if (['depth', 'seldepth', 'time', 'nodes', 'pv', 'multipv', 'score', 'currmove', 'currmovenumber', 'hashfull', 'nps', 'tbhits', 'cpuload', 'string', 'refutation', 'currline', 'wdl'].includes(key)) {
                if (key === 'score') {
                    info.score = { unit: value, value: parts[i + 2] };
                    i += 2;
                    // Optional bound flag: "score cp 35 lowerbound"
                    if (parts[i + 1] === 'lowerbound' || parts[i + 1] === 'upperbound') {
                        info.score.bound = parts[i + 1];
                        i++;
                    }
                } else if (key === 'wdl') {
                    info.wdl = [parts[i + 1], parts[i + 2], parts[i + 3]].map(Number);
                    i += 3;
                } else if (key === 'string') {
                    info.string = parts.slice(i + 1).join(' ');
                    i = parts.length; // "info string" consumes the rest of the line
                } else if (key === 'pv') {
                    info.pv = parts.slice(i + 1).join(' ');
                    i = parts.length; // PV consumes the rest
                } else {
                    info[key] = value;
                    i++;
                }
            }
        }
        return info;
    }

    // High Level API
    isReady(timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (this.ready) return resolve();

            const timer = setTimeout(() => {
                this.removeListener('ready', onReady);
                reject(new Error("Timeout waiting for readyok"));
            }, timeout);

            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };

            this.once('ready', onReady);
            this.send('isready');
        });
    }

    // Unlike isReady(), always round-trips an isready/readyok so it can be used
    // to synchronise after setoption / ucinewgame.
    sync(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.removeListener('ready', onReady);
                reject(new Error("Timeout waiting for readyok"));
            }, timeout);
            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };
            this.once('ready', onReady);
            this.send('isready');
        });
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
        this.send(`setoption name ${name} value ${value}`);
    }

    newGame() {
        this.send('ucinewgame');
    }

    // position: { startFen, moves (UCI) }; go: { wtime, btime, winc, binc, movetime, depth, nodes }
    think(position, go) {
        const base = position.startFen ? `position fen ${position.startFen}` : 'position startpos';
        const moves = position.moves || [];
        this.send(moves.length ? `${base} moves ${moves.join(' ')}` : base);
        this.go(go);
    }

    go(options) {
        // options: { wtime, btime, winc, binc, movestogo, depth, nodes, movetime, infinite }
        let cmd = 'go';
        for (const [key, val] of Object.entries(options)) {
            if (val !== undefined) cmd += ` ${key} ${val}`;
        }
        this.send(cmd);
    }

    stop() {
        this.send('stop');
    }

    quit() {
        this.send('quit');
        if (this.process) {
            if (this.process.pid) {
                try {
                    const kill = require('tree-kill');
                    kill(this.process.pid, 'SIGKILL', (err) => {
                        if (err) console.error(`[${this.name}] Failed to kill process tree:`, err);
                    });
                } catch (e) {
                    console.warn(`[${this.name}] tree-kill failed or not found, falling back to process.kill:`, e.message);
                    try {
                        this.process.kill();
                    } catch (killErr) {
                        console.error(`[${this.name}] process.kill failed:`, killErr.message);
                    }
                }
            } else {
                try {
                    this.process.kill();
                } catch (killErr) {
                    console.error(`[${this.name}] process.kill failed:`, killErr.message);
                }
            }
        }
    }
}

module.exports = UciEngine;
