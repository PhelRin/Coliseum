const { Chess } = require('chess.js');
const { createEngine, resolveProtocol } = require('./engine-protocol');
const { PolyglotBook } = require('./polyglot');
const EventEmitter = require('events');

// How far a clock may go below zero before it counts as a time forfeit. The GUI itself adds a
// little delay (passing messages, updating the screen, other games running at the same time),
// and an engine shouldn't lose on time because of that.
const DEFAULT_TIME_MARGIN = 300;

// fixed-depth / fixed-node games have no clock: an engine that thinks longer than this is
// taken as hung and loses the game
const FIXED_LIMIT_TIMEOUT_MS = 10 * 60 * 1000;

const MATE_CP = 100000;

const pgnDate = (d = new Date()) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

// PGN "TimeControl" tag: seconds+increment, "1/seconds" for a fixed time per move, "-" for none
function pgnTimeControl(tc) {
    if (!tc) return '-';
    if (tc.type === 'unlimited') return '-';
    if (tc.movetime) return `1/${+(tc.movetime / 1000).toFixed(3)}`;
    if (tc.depth || tc.nodes) return '-';
    if (typeof tc.initial === 'number' && tc.initial > 0) return `${Math.round(tc.initial / 1000)}+${+((tc.inc || 0) / 1000).toFixed(3)}`;
    return '-';
}

/**
 * Plays one game between two engines (or an engine and a human, in Quick Match).
 *
 * Several arbiters can run at the same time (tournaments and Elo estimation play several games
 * at once). An arbiter with `slot === null` drives the Quick Match screen and sends the classic
 * 'board-update' / 'match-ended' events; an arbiter with a slot number sends its events on
 * `channel` (e.g. 'tournament-game') tagged with that slot, so the screens can show every game.
 */
class Arbiter extends EventEmitter {
    constructor(mainWindow, configManager, opts = {}) {
        super();
        this.mainWindow = mainWindow;
        this.configManager = configManager;
        this.slot = opts.slot === undefined ? null : opts.slot;
        this.channel = opts.channel || null;
        this.engineWhite = null;
        this.engineBlack = null;
        this.books = { w: null, b: null };
        this.game = null;
        this.activeColor = 'w';
        this.timeControl = {};
        this.clocks = { w: 0, b: 0 };
        this.matchId = null;
        this.gameActive = false;
        this.clockInterval = null;
        this.lastTickTime = 0;
        this.pendingResolve = null;
    }

    // ---- events to the screen ------------------------------------------------------------
    ui(kind, data) {
        const wc = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow.webContents : null;
        if (!wc) return;
        if (this.slot === null) wc.send(kind, data);
        else wc.send(this.channel, { slot: this.slot, kind, ...data });
    }

    /**
     * settings: {
     *   whiteTimeControl, blackTimeControl | initial, inc   time controls (ms)
     *   whiteBook, blackBook                                 Polyglot books (optional)
     *   startFen                                             start from this position (optional)
     *   openingMoves                                         UCI moves played first, for both sides (optional)
     *   meta: { event, round, whiteName, blackName }         PGN headers (optional)
     *   timeMargin, moveDelay                                see above / pause between moves for the screen
     *   adjudication: {                                      end decided games early (engine games only)
     *     resign: { enabled, score (cp), moves },            both engines agree a side is lost by >= score for `moves` moves each
     *     draw: { enabled, after (move no.), score, moves }, both engines' scores within +-score for `moves` moves each
     *     maxMoves: { enabled, moves },                      a game longer than this is a draw
     *   }
     * Time controls per side: { initial, inc } (clock, ms) | { movetime } | { depth } | { nodes } | { type: 'unlimited' }
     * }
     * Resolves with { winner, reason, pgn, white, black, openingLine } when the game ends, or
     * null if it was stopped.
     */
    async startMatch(whitePath, blackPath, settings) {
        if (this.gameActive) this.stopMatch();

        this.matchId = Date.now() + Math.random();
        const currentMatchId = this.matchId;
        this.settings = settings || {};
        this.startFen = this.settings.startFen || null;
        this.game = this.startFen ? new Chess(this.startFen) : new Chess();
        this.activeColor = this.game.turn();
        this.gameActive = true;
        this.timeControl = this.settings;
        this.timeMargin = this.settings.timeMargin === undefined ? DEFAULT_TIME_MARGIN : this.settings.timeMargin;
        this.moveDelay = this.settings.moveDelay === undefined ? 100 : this.settings.moveDelay;
        this.forcedMoves = Array.isArray(this.settings.openingMoves) ? [...this.settings.openingMoves] : [];
        this.openingLine = [];
        this.paths = { w: whitePath, b: blackPath };
        this.names = {
            w: whitePath === 'manual' ? 'Human' : (this.settings.meta?.whiteName || baseName(whitePath)),
            b: blackPath === 'manual' ? 'Human' : (this.settings.meta?.blackName || baseName(blackPath)),
        };

        const done = new Promise((resolve) => (this.pendingResolve = resolve));

        // clocks and increments
        const wTC = this.settings.whiteTimeControl;
        const bTC = this.settings.blackTimeControl;
        const wInitial = wTC ? (wTC.type === 'unlimited' ? -1 : wTC.initial) : (this.settings.initial || 60000);
        const wInc = wTC ? (wTC.type === 'unlimited' ? 0 : wTC.inc) : (this.settings.inc || 0);
        const bInitial = bTC ? (bTC.type === 'unlimited' ? -1 : bTC.initial) : (this.settings.initial || 60000);
        const bInc = bTC ? (bTC.type === 'unlimited' ? 0 : bTC.inc) : (this.settings.inc || 0);
        const fixed = (tc) => !!(tc && (tc.movetime || tc.depth || tc.nodes));
        this.clocks = { w: fixed(wTC) ? -1 : wInitial, b: fixed(bTC) ? -1 : bInitial };
        // untimed sides are tracked separately: a running clock can pass through exactly -1 ms inside the time margin
        this.untimed = { w: this.clocks.w === -1, b: this.clocks.b === -1 };
        this.timeIncrements = { w: wInc || 0, b: bInc || 0 };
        this.timeControlConfigs = {
            w: wTC || { initial: this.settings.initial, inc: this.settings.inc },
            b: bTC || { initial: this.settings.initial, inc: this.settings.inc },
        };
        this.adjudication = whitePath === 'manual' || blackPath === 'manual' ? null : this.settings.adjudication || null;
        this.plyScores = []; // white's point of view, one per engine move (null = no score)
        this.searchScore = null;

        // books (only used when no forced opening is given)
        this.books.w = new PolyglotBook();
        this.books.b = new PolyglotBook();
        if (!this.forcedMoves.length) {
            if (this.settings.whiteBook) await this.books.w.load(this.settings.whiteBook);
            if (this.settings.blackBook) await this.books.b.load(this.settings.blackBook);
        }
        if (this.matchId !== currentMatchId) return null;

        // UCI or WinBoard (asks an engine the first time it is used)
        const [protoW, protoB] = await Promise.all([
            whitePath !== 'manual' ? resolveProtocol(whitePath) : null,
            blackPath !== 'manual' ? resolveProtocol(blackPath) : null,
        ]);
        if (this.matchId !== currentMatchId) return null;

        // tournaments and Elo runs pass the snapshot of each linked engine they pinned at start
        const launch = this.settings.launchPaths || {};
        if (whitePath !== 'manual') this.engineWhite = createEngine(whitePath, 'White', launch.w, protoW);
        if (blackPath !== 'manual') this.engineBlack = createEngine(blackPath, 'Black', launch.b, protoB);
        if (this.slot !== null) {
            // tournament games: keep the console quiet, there can be several games at once
            if (this.engineWhite) this.engineWhite.verbose = false;
            if (this.engineBlack) this.engineBlack.verbose = false;
        }

        try {
            // an engine that can't be run (missing file, no permission) fails the start at once,
            // and one that dies mid-game loses it, instead of an unhandled error
            let startupTimerId;
            let failStartup = () => {};
            const startupTimeout = new Promise((_, reject) => {
                failStartup = reject;
                startupTimerId = setTimeout(() => reject(new Error('Engine startup timeout (uciok/readyok)')), protoW === 'xboard' || protoB === 'xboard' ? 20000 : 10000);
            });
            startupTimeout.catch(() => {});
            for (const [eng, color] of [[this.engineWhite, 'w'], [this.engineBlack, 'b']]) {
                if (!eng) continue;
                eng.on('error', (err) => {
                    failStartup(new Error(`${this.names[color]} could not be started: ${err && err.message}`));
                    if (this.gameActive && this.matchId === currentMatchId && this.started) {
                        this.ui('match-log', `${this.names[color]} failed: ${err && err.message}`);
                        this.endMatchWithReason(color === 'w' ? 'black' : 'white', 'Engine crashed');
                    }
                });
            }
            this.started = false;
            if (this.engineWhite) this.engineWhite.start();
            if (this.engineBlack) this.engineBlack.start();

            await Promise.race([
                Promise.all([
                    this.engineWhite ? new Promise((r) => (this.engineWhite.uciOk ? r() : this.engineWhite.once('uciok', r))) : Promise.resolve(),
                    this.engineBlack ? new Promise((r) => (this.engineBlack.uciOk ? r() : this.engineBlack.once('uciok', r))) : Promise.resolve(),
                ]),
                startupTimeout,
            ]);
            // saved engine options (WinBoard engines only list theirs during the handshake)
            if (this.configManager) {
                for (const [eng, p] of [[this.engineWhite, whitePath], [this.engineBlack, blackPath]]) {
                    if (!eng) continue;
                    for (const [name, val] of Object.entries(this.configManager.getSavedOptions(p))) eng.setOption(name, val);
                }
            }
            await Promise.race([
                Promise.all([
                    this.engineWhite ? this.engineWhite.isReady() : Promise.resolve(),
                    this.engineBlack ? this.engineBlack.isReady() : Promise.resolve(),
                ]),
                startupTimeout,
            ]);
            clearTimeout(startupTimerId);
            if (this.matchId !== currentMatchId) return done;

            if (this.engineWhite) this.engineWhite.newGame(this.timeControlConfigs.w);
            if (this.engineBlack) this.engineBlack.newGame(this.timeControlConfigs.b);
            if (this.engineWhite && this.engineWhite.protocol === 'xboard') await this.engineWhite.sync().catch(() => {});
            if (this.engineBlack && this.engineBlack.protocol === 'xboard') await this.engineBlack.sync().catch(() => {});
            if (this.matchId !== currentMatchId) return done;

            // engine names as the engines report them ("id name ..."), unless the caller set them
            if (this.engineWhite && !this.settings.meta?.whiteName && this.engineWhite.name && this.engineWhite.name !== 'White') this.names.w = this.engineWhite.name;
            if (this.engineBlack && !this.settings.meta?.blackName && this.engineBlack.name && this.engineBlack.name !== 'Black') this.names.b = this.engineBlack.name;

            // an engine that crashes mid-game loses the game instead of freezing it
            for (const [eng, color] of [[this.engineWhite, 'w'], [this.engineBlack, 'b']]) {
                if (!eng) continue;
                eng.once('quit', () => {
                    if (this.gameActive && this.matchId === currentMatchId) {
                        this.ui('match-log', `${this.names[color]} stopped responding (crashed).`);
                        this.endMatchWithReason(color === 'w' ? 'black' : 'white', 'Engine crashed');
                    }
                });
                // WinBoard engines can resign, directly or by claiming the opponent won
                const resign = () => {
                    if (this.gameActive && this.matchId === currentMatchId) {
                        this.ui('match-log', `${this.names[color]} resigns.`);
                        this.endMatchWithReason(color === 'w' ? 'black' : 'white', 'Resignation');
                    }
                };
                eng.on('resign', resign);
                eng.on('claim', ({ result }) => {
                    if ((color === 'w' && result === '0-1') || (color === 'b' && result === '1-0')) resign();
                    // other claims (wins, draws) are ignored: Coliseum applies the rules itself
                });
                eng.on('engine-error', (msg) => this.ui('match-log', `${this.names[color]}: ${msg}`));
            }

            this.ui('match-started', {
                white: { name: this.names.w, path: whitePath },
                black: { name: this.names.b, path: blackPath },
                fen: this.game.fen(),
                clocks: this.clocks,
                round: this.settings.meta?.round || null,
            });
            this.started = true;
            this.ui('match-log', 'Both engines ready.');
            this.playNextMove(currentMatchId);
        } catch (err) {
            if (this.matchId !== currentMatchId) return done;
            console.error('Match error:', err);
            this.ui('match-error', err.message);
            this.finish(null);
            this.stopMatch();
        }
        return done;
    }

    finish(result) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        if (resolve) resolve(result);
    }

    stopMatch() {
        this.gameActive = false;
        this.matchId = null; // a startMatch still waiting on something sees it was stopped
        if (this.moveTimeout) {
            clearTimeout(this.moveTimeout);
            this.moveTimeout = null;
        }
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
        if (this.engineWhite) this.engineWhite.quit();
        if (this.engineBlack) this.engineBlack.quit();
        this.engineWhite = null;
        this.engineBlack = null;
        this.books = { w: null, b: null };
        this.finish(null); // a stopped game has no result
    }

    flagged(color) {
        return !this.untimed[color] && this.clocks[color] <= -this.timeMargin;
    }

    applyMove(uci, currentMatchId, label) {
        const from = uci.substring(0, 2);
        const to = uci.substring(2, 4);
        const promotion = uci.substring(4, 5);
        const result = this.game.move({ from, to, promotion: promotion || undefined });
        if (!result) return null;
        this.ui('board-update', {
            fen: this.game.fen(),
            lastMove: uci,
            san: result.san,
            clocks: this.displayClocks(),
        });
        if (label) this.ui('match-log', `${label} (${this.activeColor === 'w' ? 'White' : 'Black'}): ${result.san}`);
        this.activeColor = this.game.turn();
        setTimeout(() => this.playNextMove(currentMatchId), this.moveDelay);
        return result;
    }

    displayClocks() {
        return { w: this.untimed.w ? -1 : Math.max(0, this.clocks.w), b: this.untimed.b ? -1 : Math.max(0, this.clocks.b) };
    }

    async playNextMove(currentMatchId) {
        if (!this.gameActive || this.matchId !== currentMatchId) return;

        if (this.game.isGameOver()) {
            this.endMatch();
            return;
        }

        const adjudicated = this.adjudicate();
        if (adjudicated) {
            this.ui('match-log', `Adjudicated: ${adjudicated.reason}`);
            this.endMatchWithReason(adjudicated.winner, adjudicated.reason);
            return;
        }

        if (this.flagged(this.activeColor)) {
            this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
            return;
        }

        // ---- forced opening moves (same opening for both games of a match) ----
        if (this.forcedMoves.length) {
            const mv = this.forcedMoves.shift();
            try {
                if (this.applyMove(mv, currentMatchId, 'Opening')) {
                    this.openingLine.push(mv);
                    return;
                }
            } catch (e) { /* fall through to the engine */ }
            console.error('[Arbiter] Opening move not legal here, engines take over:', mv);
            this.forcedMoves = [];
        }

        // ---- opening book ----
        const activeBook = this.books[this.activeColor];
        if (activeBook && activeBook.loaded) {
            const bookMove = activeBook.getMove(this.game.fen());
            if (bookMove) {
                try {
                    if (this.applyMove(bookMove, currentMatchId, 'Book Move')) {
                        this.openingLine.push(bookMove);
                        return;
                    }
                } catch (e) {
                    console.error('Book move error (invalid?):', e);
                }
            }
        }

        if (this.moveTimeout) clearTimeout(this.moveTimeout);
        if (this.clockInterval) clearInterval(this.clockInterval);

        const activeEngine = this.activeColor === 'w' ? this.engineWhite : this.engineBlack;
        const activeTC = this.timeControlConfigs[this.activeColor];
        if (activeTC && activeTC.movetime) {
            const limit = activeTC.movetime;
            this.moveTimeout = setTimeout(() => {
                if (this.matchId !== currentMatchId || !this.gameActive) return;
                this.ui('match-log', `Time forfeit by ${this.activeColor === 'w' ? 'White' : 'Black'} (exceeded move time)`);
                this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
            }, limit + 2000 + this.timeMargin);
        } else if (activeTC && (activeTC.depth || activeTC.nodes)) {
            this.moveTimeout = setTimeout(() => {
                if (this.matchId !== currentMatchId || !this.gameActive) return;
                this.ui('match-log', `${this.activeColor === 'w' ? 'White' : 'Black'} did not finish its search in ${FIXED_LIMIT_TIMEOUT_MS / 60000} minutes`);
                this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
            }, FIXED_LIMIT_TIMEOUT_MS);
        } else {
            this.lastTickTime = Date.now();
            this.clockInterval = setInterval(() => {
                if (!this.gameActive || this.matchId !== currentMatchId) {
                    clearInterval(this.clockInterval);
                    return;
                }
                const now = Date.now();
                const delta = now - this.lastTickTime;
                this.lastTickTime = now;
                if (!this.untimed[this.activeColor]) this.clocks[this.activeColor] -= delta;
                if (this.flagged(this.activeColor)) {
                    clearInterval(this.clockInterval);
                    this.ui('match-log', `Time forfeit by ${this.activeColor === 'w' ? 'White' : 'Black'}`);
                    this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
                }
            }, 100);
        }

        if (!activeEngine) {
            this.ui('engine-info', { color: this.activeColor, info: { string: 'Waiting for move...' } });
            return;
        }

        const moves = this.game.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));

        const goOptions = {};
        if (activeTC && activeTC.movetime) {
            goOptions.movetime = activeTC.movetime;
        } else if (activeTC && activeTC.depth) {
            goOptions.depth = activeTC.depth;
        } else if (activeTC && activeTC.nodes) {
            goOptions.nodes = activeTC.nodes;
        } else {
            // never tell an engine it has negative time
            goOptions.wtime = this.untimed.w ? 1800000 : Math.max(1, Math.round(this.clocks.w));
            goOptions.btime = this.untimed.b ? 1800000 : Math.max(1, Math.round(this.clocks.b));
            goOptions.winc = this.timeIncrements.w || 0;
            goOptions.binc = this.timeIncrements.b || 0;
        }

        activeEngine.removeAllListeners('bestmove');
        this.searchScore = null;
        const mover = this.activeColor;
        const onBestMove = (reply) => {
            if (this.matchId !== currentMatchId || !this.gameActive) return;
            activeEngine.removeAllListeners('info'); // anything it says now isn't about this move
            const bestmove = this.toUci(reply);
            this.plyScores.push(whiteCp(this.searchScore, mover));
            if (this.moveTimeout) clearTimeout(this.moveTimeout);
            if (this.clockInterval) clearInterval(this.clockInterval);

            const tc = this.timeControlConfigs[this.activeColor];
            if (tc && !tc.movetime && !tc.depth && !tc.nodes && !this.untimed[this.activeColor]) {
                const now = Date.now();
                this.clocks[this.activeColor] -= now - this.lastTickTime;
                if (this.flagged(this.activeColor)) {
                    this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
                    return;
                }
                // a move made inside the margin keeps the game going, with a clock of zero
                this.clocks[this.activeColor] = Math.max(0, this.clocks[this.activeColor]);
                if (this.timeIncrements[this.activeColor]) this.clocks[this.activeColor] += this.timeIncrements[this.activeColor];
            }

            try {
                if (!bestmove || !this.applyMove(bestmove, currentMatchId)) {
                    console.error('Illegal move:', bestmove);
                    this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Illegal Move');
                }
            } catch (e) {
                console.error('Move error:', e);
                this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Illegal Move');
            }
        };
        activeEngine.once('bestmove', onBestMove);
        activeEngine.removeAllListeners('info');
        const xboard = activeEngine.protocol === 'xboard';
        activeEngine.on('info', (info) => {
            if (info.score && !info.score.bound) this.searchScore = info.score;
            if (xboard && info.pv) info.pv = this.pvToUci(info.pv);
            this.ui('engine-info', { color: this.activeColor, info });
        });
        activeEngine.think({ startFen: this.startFen, moves, side: this.activeColor }, goOptions);
    }

    // An engine's move in coordinate notation. WinBoard engines may answer in SAN ("Nf3",
    // "O-O") or with "=" before a promotion piece.
    toUci(move) {
        if (!move) return move;
        const m = String(move).trim().replace('=', '');
        if (/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(m)) return m.toLowerCase();
        try {
            const tmp = new Chess(this.game.fen());
            const r = tmp.move(m.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'), { strict: false });
            if (r) return r.from + r.to + (r.promotion || '');
        } catch (e) { /* not a move */ }
        return m;
    }

    // WinBoard thinking output usually has the PV in SAN; the board arrows need coordinates
    pvToUci(pv) {
        const tokens = String(pv).split(/\s+/).filter(Boolean);
        if (tokens.every((t) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t))) return pv;
        try {
            const tmp = new Chess(this.game.fen());
            const out = [];
            for (const t of tokens) {
                let r = null;
                try {
                    r = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)
                        ? tmp.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] })
                        : tmp.move(t.replace(/[+#!?]+$/, ''), { strict: false });
                } catch (e) {
                    r = null;
                }
                if (!r) break;
                out.push(r.from + r.to + (r.promotion || ''));
            }
            return out.join(' ');
        } catch (e) {
            return '';
        }
    }

    // ---- adjudication --------------------------------------------------------------------
    // Uses the score each engine reported for its own last moves (cutechess-style: both
    // engines must agree). Returns { winner, reason } or null.
    adjudicate() {
        const a = this.adjudication;
        if (!a) return null;
        const plies = this.game.history().length;
        if (a.maxMoves && a.maxMoves.enabled && a.maxMoves.moves > 0 && plies >= a.maxMoves.moves * 2) {
            return { winner: 'draw', reason: 'Draw (Move limit)' };
        }
        const recent = (n) => {
            if (this.plyScores.length < n) return null;
            const r = this.plyScores.slice(-n);
            return r.every((x) => typeof x === 'number') ? r : null;
        };
        if (a.resign && a.resign.enabled) {
            const n = Math.max(1, a.resign.moves | 0) * 2;
            const r = recent(n);
            const t = Math.max(1, Number(a.resign.score) || 0);
            if (r && r.every((x) => x <= -t)) return { winner: 'black', reason: 'Adjudication (resign)' };
            if (r && r.every((x) => x >= t)) return { winner: 'white', reason: 'Adjudication (resign)' };
        }
        // draws from move number `after` on (the game's own move numbers, so EPD starts count too)
        if (a.draw && a.draw.enabled && this.game.moveNumber() >= (a.draw.after | 0)) {
            const n = Math.max(1, a.draw.moves | 0) * 2;
            const r = recent(n);
            const t = Math.max(0, Number(a.draw.score) || 0);
            if (r && r.every((x) => Math.abs(x) <= t)) return { winner: 'draw', reason: 'Draw (Adjudication)' };
        }
        return null;
    }

    endMatchWithReason(winner, reason) {
        if (!this.gameActive) return;
        this.gameActive = false;
        if (this.moveTimeout) {
            clearTimeout(this.moveTimeout);
            this.moveTimeout = null;
        }
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }

        const meta = this.settings.meta || {};
        const result = winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2';
        const termination =
            /Adjudication|Move limit/.test(reason || '') ? 'adjudication'
            : reason === 'Time Forfeit' ? 'time forfeit'
                : reason === 'Illegal Move' ? 'rules infraction'
                    : reason === 'Engine crashed' ? 'abandoned'
                        : 'normal';
        const tcWhite = pgnTimeControl(this.timeControlConfigs.w);
        const tcBlack = pgnTimeControl(this.timeControlConfigs.b);
        this.game.header(
            'Event', meta.event || 'Coliseum Match',
            'Site', 'Coliseum',
            'Date', pgnDate(),
            'Round', meta.round ? String(meta.round) : '-',
            'White', this.names.w,
            'Black', this.names.b,
            'Result', result,
            'TimeControl', tcWhite === tcBlack ? tcWhite : `${tcWhite} / ${tcBlack}`,
            'Termination', termination,
            'PlyCount', String(this.game.history().length)
        );
        if (meta.whiteElo) this.game.header('WhiteElo', String(meta.whiteElo));
        if (meta.blackElo) this.game.header('BlackElo', String(meta.blackElo));
        if (reason) this.game.setComment(reason);
        const pgn = this.game.pgn();

        const data = {
            winner,
            reason,
            pgn,
            white: { path: this.paths.w, name: this.names.w },
            black: { path: this.paths.b, name: this.names.b },
            openingLine: this.openingLine,
            plies: this.game.history().length,
        };
        this.ui('match-ended', data);
        this.emit('match-ended', data);
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.stopMatch();
        if (resolve) resolve(data);
    }

    endMatch() {
        let reason = '';
        let winner = null;
        if (this.game.isCheckmate()) {
            reason = 'Checkmate';
            winner = this.game.turn() === 'w' ? 'black' : 'white';
        } else if (this.game.isStalemate()) {
            reason = 'Draw (Stalemate)';
            winner = 'draw';
        } else if (this.game.isInsufficientMaterial()) {
            reason = 'Draw (Insufficient Material)';
            winner = 'draw';
        } else if (this.game.isThreefoldRepetition()) {
            reason = 'Draw (Repetition)';
            winner = 'draw';
        } else if (this.game.isDraw()) {
            reason = 'Draw (50-Move Rule)';
            winner = 'draw';
        }
        this.endMatchWithReason(winner, reason);
    }

    async makeManualMove(moveStr) {
        if (!this.gameActive) return;
        const isWhite = this.game.turn() === 'w';
        const engine = isWhite ? this.engineWhite : this.engineBlack;
        if (engine) {
            console.error('Attempted manual move during engine turn');
            return;
        }
        if (this.clockInterval) clearInterval(this.clockInterval);

        const activeTC = this.timeControlConfigs[this.activeColor];
        if (activeTC && !activeTC.movetime && !this.untimed[this.activeColor]) {
            this.clocks[this.activeColor] -= Date.now() - this.lastTickTime;
            if (this.flagged(this.activeColor)) {
                this.endMatchWithReason(this.activeColor === 'w' ? 'black' : 'white', 'Time Forfeit');
                return;
            }
            this.clocks[this.activeColor] = Math.max(0, this.clocks[this.activeColor]);
            if (this.timeIncrements[this.activeColor]) this.clocks[this.activeColor] += this.timeIncrements[this.activeColor];
        }

        try {
            let moveObj;
            if (moveStr.length >= 4 && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveStr)) {
                moveObj = { from: moveStr.substring(0, 2), to: moveStr.substring(2, 4), promotion: moveStr.substring(4, 5) || undefined };
            } else {
                moveObj = moveStr;
            }
            const result = this.game.move(moveObj);
            if (result) {
                const uci = result.from + result.to + (result.promotion || '');
                this.ui('board-update', { fen: this.game.fen(), lastMove: uci, san: result.san, clocks: this.displayClocks() });
                this.activeColor = this.game.turn();
                setTimeout(() => this.playNextMove(this.matchId), this.moveDelay);
            }
        } catch (e) {
            console.error('Manual move error:', e);
        }
    }
}

// an engine score (side to move's point of view) as centipawns from White's point of view
function whiteCp(score, mover) {
    if (!score) return null;
    const v = Number(score.value);
    if (!Number.isFinite(v)) return null;
    let cp;
    if (score.unit === 'mate') cp = v > 0 ? MATE_CP - v : v < 0 ? -MATE_CP - v : -MATE_CP;
    else if (score.unit === 'cp') cp = v;
    else return null;
    return mover === 'w' ? cp : -cp;
}

function baseName(p) {
    if (!p) return 'Unknown';
    return String(p).split(/[\\/]/).pop().replace(/\.exe$/i, '');
}

module.exports = { Arbiter, pgnTimeControl, DEFAULT_TIME_MARGIN, whiteCp };
