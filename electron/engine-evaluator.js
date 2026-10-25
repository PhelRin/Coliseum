// A small wrapper around UciEngine for "evaluate this position and give me the
// top N lines" style requests. Used by Game Review, the Puzzle Generator and
// the Tactics Trainer's move checker.

const UciEngine = require('./uci');
const { resolveProtocol } = require('./engine-protocol');

class EngineEvaluator {
    constructor(label = 'Evaluator', configManager = null) {
        this.label = label;
        this.configManager = configManager;
        this.engine = null;
        this.enginePath = null;
        this.multiPV = 1;
        this.supportsMultiPV = false;
        this.maxMultiPV = 1;
        this.active = null; // { resolve } of the in-flight evaluation
        this.stopped = false;
        this.queue = Promise.resolve();
    }

    async init(enginePath, { multiPV = 1 } = {}) {
        this.enginePath = enginePath;
        this.stopped = false;
        if ((await resolveProtocol(enginePath)) === 'xboard') {
            throw new Error('This is a WinBoard engine. WinBoard engines can play games and tournaments, but analysis needs a UCI engine.');
        }
        const engine = new UciEngine(enginePath, this.label);
        engine.verbose = false;
        this.engine = engine;
        engine.on('error', (err) => console.error(`[${this.label}] engine error:`, err && err.message));
        engine.start();
        await engine.waitForUciOk(8000);

        if (this.configManager) {
            const options = this.configManager.getSavedOptions(enginePath) || {};
            for (const [name, val] of Object.entries(options)) {
                if (String(name).toLowerCase() === 'multipv') continue; // we manage MultiPV ourselves
                engine.send(`setoption name ${name} value ${val}`);
            }
        }

        const mpv = engine.options.get('multipv');
        this.supportsMultiPV = !!mpv;
        this.maxMultiPV = mpv && Number.isFinite(mpv.max) ? mpv.max : (mpv ? 256 : 1);
        this.multiPV = 1;
        if (multiPV > 1) await this.setMultiPV(multiPV);
        await engine.sync(10000);
        return this;
    }

    async setMultiPV(n) {
        if (!this.engine) return;
        const target = this.supportsMultiPV ? Math.max(1, Math.min(n, this.maxMultiPV)) : 1;
        if (target === this.multiPV) return;
        this.engine.send(`setoption name MultiPV value ${target}`);
        this.multiPV = target;
        await this.engine.sync(10000);
    }

    async newGame() {
        if (!this.engine) return;
        this.engine.send('ucinewgame');
        try {
            await this.engine.sync(10000);
        } catch (e) { /* ignore */ }
    }

    async restart() {
        const path = this.enginePath;
        const mpv = this.multiPV;
        this.kill();
        await this.init(path, { multiPV: mpv });
    }

    // Serialise calls so that two callers never interleave on one engine.
    evaluate(fen, opts = {}) {
        const run = () => this._evaluate(fen, opts);
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => {});
        return p;
    }

    async _evaluate(fen, { movetime = 300, depth, nodes, multiPV } = {}) {
        if (!this.engine || this.stopped) return null;
        if (multiPV && multiPV !== this.multiPV) await this.setMultiPV(multiPV);

        const result = await this._search(fen, { movetime, depth, nodes });
        if (result && result.timedOut && !this.stopped) {
            console.warn(`[${this.label}] search timed out, restarting engine`);
            try {
                await this.restart();
            } catch (e) {
                console.error(`[${this.label}] restart failed:`, e.message);
            }
        }
        return result;
    }

    _search(fen, { movetime, depth, nodes }) {
        const engine = this.engine;
        return new Promise((resolve) => {
            const lines = new Map(); // multipv -> { score, pv, depth }
            let maxDepth = 0;
            let done = false;

            const finish = (bestMove, timedOut = false) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                clearTimeout(stopTimer);
                engine.removeListener('info', onInfo);
                engine.removeListener('bestmove', onBest);
                this.active = null;

                const sorted = [...lines.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([, l]) => l);
                if (bestMove && bestMove !== '(none)' && bestMove !== '0000') {
                    // Line 1 without a PV: it's the engine's chosen move
                    if (sorted.length > 0 && sorted[0].pv.length === 0) sorted[0].pv = [bestMove];
                    // Make sure line 1 starts with the engine's chosen move
                    if (sorted.length === 0 || sorted[0].pv[0] !== bestMove) {
                        const idx = sorted.findIndex(l => l.pv[0] === bestMove);
                        if (idx > 0) {
                            const [l] = sorted.splice(idx, 1);
                            sorted.unshift(l);
                        } else if (idx < 0) {
                            sorted.unshift({ score: sorted[0]?.score || null, pv: [bestMove], depth: maxDepth });
                        }
                    }
                }
                resolve({
                    bestMove: bestMove && bestMove !== '(none)' && bestMove !== '0000' ? bestMove : null,
                    lines: sorted,
                    score: sorted[0]?.score || null,
                    pv: sorted[0]?.pv || [],
                    depth: maxDepth,
                    timedOut
                });
            };

            const onInfo = (info) => {
                // Some engines send the score without a "pv" (or on a separate line) - keep the score anyway
                if (!info || !info.score) return;
                const k = parseInt(info.multipv || '1', 10) || 1;
                const d = parseInt(info.depth || '0', 10) || 0;
                const prev = lines.get(k);
                // Prefer exact scores; accept a bound only if we have nothing at this depth
                if (info.score.bound && prev && prev.depth >= d && !prev.score.bound) return;
                const pv = info.pv ? info.pv.split(/\s+/).filter(Boolean) : (prev && prev.depth === d ? prev.pv : []);
                lines.set(k, {
                    score: { unit: info.score.unit, value: info.score.value, bound: info.score.bound },
                    pv,
                    depth: d
                });
                if (d > maxDepth) maxDepth = d;
            };

            const onBest = (bestMove) => finish(bestMove, false);

            this.active = { resolve: () => finish(null, false) };
            engine.on('info', onInfo);
            engine.once('bestmove', onBest);

            const budget = movetime ? movetime + 4000 : 60000;
            let stopTimer = null;
            const timer = setTimeout(() => {
                // Ask nicely first, then give up
                engine.stop();
                stopTimer = setTimeout(() => finish(null, true), 1500);
            }, budget);

            engine.send(`position fen ${fen}`);
            const go = ['go'];
            if (depth) go.push('depth', depth);
            if (nodes) go.push('nodes', nodes);
            if (movetime || (!depth && !nodes)) go.push('movetime', movetime || 300);
            engine.send(go.join(' '));
        });
    }

    // Abort the in-flight search (if any) without killing the engine.
    abort() {
        if (this.engine) this.engine.stop();
    }

    kill() {
        if (this.active) {
            try { this.active.resolve(); } catch (e) { /* ignore */ }
        }
        if (this.engine) {
            try {
                this.engine.stop();
                this.engine.quit();
            } catch (e) { /* ignore */ }
        }
        this.engine = null;
        this.queue = Promise.resolve();
    }

    stop() {
        this.stopped = true;
        this.kill();
    }
}

module.exports = { EngineEvaluator };
