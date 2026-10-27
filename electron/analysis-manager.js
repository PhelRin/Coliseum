const UciEngine = require('./uci');
const { resolveProtocol } = require('./engine-protocol');

// Live (infinite) analysis for the Analysis Board.
//
// Fixes over the original implementation:
//  * After "stop" we wait for the engine's bestmove before starting the next
//    search, so info lines from the previous position can no longer leak into
//    the new one (previously the eval/arrow could briefly belong to the wrong
//    position).
//  * Every update is tagged with the FEN it belongs to.
//  * MultiPV support: the top N lines are tracked and sent together.
//  * Updates are throttled so a fast engine can't flood the renderer.
class AnalysisManager {
    constructor(mainWindow, configManager) {
        this.mainWindow = mainWindow;
        this.configManager = configManager;
        this.engine = null;
        this.active = false;
        this.currentFen = '';
        this.pendingFen = null;
        this.searching = false;
        this.waitingForStop = false;
        this.stopFallback = null;
        this.lines = new Map();
        this.depth = 0;
        this.multiPV = 3;
        this.flushTimer = null;
        this.lastNps = null;
        this.outstanding = 0; // searches started that haven't answered with bestmove yet
    }

    send(channel, data) {
        try {
            if (this.mainWindow && !this.mainWindow.isDestroyed?.()) this.mainWindow.webContents.send(channel, data);
        } catch (e) { /* window gone */ }
    }

    async start(enginePath, { multiPV = 3 } = {}) {
        if (this.active) await this.stop();

        console.log(`[Analysis] Starting engine: ${enginePath}`);
        if ((await resolveProtocol(enginePath)) === 'xboard') {
            this.send('analysis-error', 'This is a WinBoard engine. Analysis needs a UCI engine.');
            return { multiPV: 1 };
        }
        const engine = new UciEngine(enginePath, 'AnalysisEngine');
        engine.verbose = false;
        this.engine = engine;
        engine.on('error', (err) => console.error('[Analysis] Engine could not run:', err && err.message));

        try {
            engine.start();
            await engine.waitForUciOk(8000);

            if (this.configManager) {
                const options = this.configManager.getSavedOptions(enginePath) || {};
                for (const [name, val] of Object.entries(options)) {
                    if (String(name).toLowerCase() === 'multipv') continue;
                    engine.send(`setoption name ${name} value ${val}`);
                }
            }
            this.multiPV = engine.hasOption('MultiPV') ? Math.max(1, Math.min(5, multiPV)) : 1;
            if (engine.hasOption('MultiPV')) engine.send(`setoption name MultiPV value ${this.multiPV}`);

            await engine.sync(10000);
            this.active = true;

            engine.on('info', (info) => this.onInfo(info));
            engine.on('bestmove', () => this.onBestMove());
            engine.on('error', (err) => {
                console.error('[Analysis] Engine Error:', err);
                this.send('analysis-error', err.message);
            });
            console.log('[Analysis] Engine Ready');
        } catch (e) {
            console.error('[Analysis] Failed to start:', e);
            this.active = false;
        }
        return { multiPV: this.multiPV };
    }

    async stop() {
        clearTimeout(this.flushTimer);
        clearTimeout(this.stopFallback);
        this.flushTimer = null;
        if (this.engine) {
            console.log('[Analysis] Stopping Engine');
            this.engine.removeAllListeners('info');
            this.engine.removeAllListeners('bestmove');
            this.engine.stop();
            this.engine.quit();
            this.engine = null;
        }
        this.active = false;
        this.searching = false;
        this.waitingForStop = false;
        this.pendingFen = null;
        this.outstanding = 0;
    }

    updatePosition(fen) {
        if (!this.active || !this.engine || !fen) return;
        this.pendingFen = fen;
        if (this.searching) {
            if (!this.waitingForStop) {
                this.waitingForStop = true;
                this.engine.stop();
                // Some engines don't answer "stop" with bestmove; don't hang forever.
                clearTimeout(this.stopFallback);
                this.stopFallback = setTimeout(() => {
                    // Engine ignored "stop" - start the new search anyway.
                    this.waitingForStop = false;
                    if (this.pendingFen) this.launch();
                }, 600);
            }
            return;
        }
        this.launch();
    }

    launch() {
        const fen = this.pendingFen;
        this.pendingFen = null;
        if (!fen || !this.engine) return;
        this.currentFen = fen;
        this.lines = new Map();
        this.depth = 0;
        this.searching = true;
        this.waitingForStop = false;
        this.outstanding++;
        this.engine.send(`position fen ${fen}`);
        this.engine.send('go infinite');
    }

    onBestMove() {
        this.outstanding = Math.max(0, this.outstanding - 1);
        if (this.outstanding > 0) return; // a stale bestmove from an earlier search
        clearTimeout(this.stopFallback);
        this.searching = false;
        this.waitingForStop = false;
        if (this.pendingFen) this.launch();
    }

    onInfo(info) {
        if (!this.searching || this.waitingForStop || !info) return;
        if (info.nps) this.lastNps = info.nps;
        if (!info.score) return;
        const k = parseInt(info.multipv || '1', 10) || 1;
        const d = parseInt(info.depth || '0', 10) || 0;
        const prev = this.lines.get(k);
        if (info.score.bound && prev && prev.depth >= d) return;
        this.lines.set(k, { multipv: k, score: info.score, pv: info.pv || (prev ? prev.pv : ''), depth: d, nodes: info.nodes, nps: info.nps });
        if (k === 1 && d > this.depth) this.depth = d;
        this.scheduleFlush();
    }

    scheduleFlush() {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            if (!this.searching || this.waitingForStop) return;
            const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv).slice(0, this.multiPV);
            if (lines.length === 0) return;
            const top = lines[0];
            this.send('analysis-update', {
                fen: this.currentFen,
                depth: String(this.depth || top.depth),
                score: top.score,
                pv: top.pv,
                nps: this.lastNps,
                lines
            });
        }, 120);
    }
}

module.exports = { AnalysisManager };
