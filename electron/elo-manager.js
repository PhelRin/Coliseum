// Elo estimation: plays rated games between the chosen engines, non-stop, until stopped.
//
// Games are always played in pairs (the same opening twice, colours swapped). Engines with the
// fewest games are picked first, against an opponent of similar strength. Several pairs can run
// at once. Every finished game goes into the engines' career record, and the ratings shown are
// fitted to all of those results (see ratings.js), with error bars that shrink as games are added.

const { PolyglotBook } = require('./polyglot');
const { openingFor } = require('./openings');
const { sampleBookLine } = require('./tournament');

const SPEEDS = { fast: 100, standard: 250, slow: 1000 };

class EloManager {
    /**
     * createArbiter(slot) -> Arbiter sending live events on 'elo-game'
     * career: Career (records games, holds ratings)
     */
    constructor(mainWindow, createArbiter, career) {
        this.mainWindow = mainWindow;
        this.createArbiter = createArbiter;
        this.career = career;
        this.active = false;
        this.engines = [];
        this.arbiters = new Map();
        this.session = null;
        this.config = null;
        this.book = null;
        this.openingIndex = 0;
        this.busy = new Map(); // path -> number of games it is playing right now
        this.current = {}; // slot -> { white, black } of the game being played
        this.linked = null; // LinkedEngines, set by main
        this.pins = {}; // linked engine path -> snapshot every game of this run uses
    }

    get store() {
        return this.career ? this.career.store : null;
    }

    async start(config = {}) {
        if (this.active) return;
        const engines = (config.engines || []).filter((e) => e && e.path);
        if (engines.length < 2) {
            this.sendUpdate({ error: 'Pick at least 2 engines to estimate their strength.' });
            return;
        }
        this.engines = engines.map((e) => ({ name: e.name, path: e.path }));
        const movetime = Number(config.movetime) || SPEEDS[config.speed] || SPEEDS.standard;
        this.config = {
            movetime: Math.max(20, Math.min(10000, movetime)),
            concurrency: Math.max(1, Math.min(16, parseInt(config.concurrency, 10) || 1)),
            openings: config.openings && config.openings.mode === 'book' && config.openings.book ? config.openings : { mode: 'builtin' },
        };
        this.book = null;
        if (this.config.openings.mode === 'book') {
            const b = new PolyglotBook();
            if (await b.load(this.config.openings.book)) this.book = b;
        }
        this.session = {
            startedAt: Date.now(),
            games: 0,
            perEngine: {},
            timeline: [this.snapshotRatings()], // ratings after each game, for the chart
            recent: [],
        };
        this.engines.forEach((e) => (this.session.perEngine[e.path] = { wins: 0, draws: 0, losses: 0 }));
        this.openingIndex = Math.floor(Math.random() * 1000);
        this.seed = (Date.now() & 0x7fffffff) || 1;
        if (this.linked) {
            this.linked.release(this.pins);
            this.pins = this.linked.pin(this.engines.map((e) => e.path));
        }
        this.active = true;
        this.log(`Started: ${this.engines.length} engines, ${this.config.movetime} ms per move, ${this.config.concurrency} game${this.config.concurrency > 1 ? 's' : ''} at a time.`);
        this.sendStatus();
        for (let slot = 0; slot < this.config.concurrency; slot++) this.slotLoop(slot);
    }

    stop() {
        if (!this.active) {
            this.sendStatus();
            return;
        }
        this.active = false;
        for (const a of this.arbiters.values()) {
            try {
                a.stopMatch(); // a game cut short is simply not counted
            } catch (e) { /* ignore */ }
        }
        this.arbiters.clear();
        this.busy.clear();
        this.current = {};
        if (this.linked) this.linked.release(this.pins);
        this.pins = {};
        this.log('Stopped. Unfinished games were not counted.');
        this.sendStatus();
    }

    ratings() {
        const all = (this.store && this.store.get('engineCareerStats')) || {};
        const out = {};
        this.engines.forEach((e) => {
            const c = all[e.path];
            out[e.path] = { rating: c && typeof c.rating === 'number' ? c.rating : 1500, error: c && c.ratingError ? c.ratingError : null, games: c && c.stats ? c.stats.gameCount : 0 };
        });
        return out;
    }

    snapshotRatings() {
        const r = this.ratings();
        const point = { game: this.session ? this.session.games : 0 };
        this.engines.forEach((e) => (point[e.path] = r[e.path].rating));
        return point;
    }

    // engines with the fewest games first, then the closest-rated opponent that isn't busy
    pickPair() {
        const r = this.ratings();
        const load = (p) => this.busy.get(p) || 0;
        const byGames = [...this.engines].sort((x, y) => load(x.path) - load(y.path) || r[x.path].games - r[y.path].games || Math.random() - 0.5);
        const pool = byGames.slice(0, Math.max(1, Math.ceil(byGames.length * 0.4)));
        const a = pool[Math.floor(Math.random() * pool.length)];
        const others = this.engines
            .filter((e) => e.path !== a.path)
            .sort((x, y) => load(x.path) - load(y.path) || Math.abs(r[x.path].rating - r[a.path].rating) - Math.abs(r[y.path].rating - r[a.path].rating));
        const near = others.slice(0, Math.min(2, others.length));
        return [a, near[Math.floor(Math.random() * near.length)]];
    }

    nextOpening() {
        if (this.book) return { moves: sampleBookLine(this.book) };
        return { fen: openingFor(this.openingIndex++, this.seed) };
    }

    async slotLoop(slot) {
        while (this.active) {
            const [a, b] = this.pickPair();
            const opening = this.nextOpening();
            for (const p of [a.path, b.path]) this.busy.set(p, (this.busy.get(p) || 0) + 1);
            try {
                for (let i = 0; i < 2 && this.active; i++) {
                    const [w, bl] = i === 0 ? [a, b] : [b, a];
                    await this.playGame(slot, w, bl, opening, i + 1);
                }
            } finally {
                for (const p of [a.path, b.path]) this.busy.set(p, Math.max(0, (this.busy.get(p) || 1) - 1));
            }
            if (this.active) await new Promise((r) => setTimeout(r, 300));
        }
    }

    async playGame(slot, white, black, opening, gameNo) {
        const arbiter = this.createArbiter(slot);
        this.arbiters.set(slot, arbiter);
        this.current[slot] = { white: { name: white.name, path: white.path }, black: { name: black.name, path: black.path } };
        this.sendStatus();
        const r = this.ratings();
        const mt = { movetime: this.config.movetime };
        let result = null;
        try {
            result = await arbiter.startMatch(white.path, black.path, {
                whiteTimeControl: mt,
                blackTimeControl: mt,
                startFen: opening.fen,
                openingMoves: opening.moves && opening.moves.length ? opening.moves : undefined,
                launchPaths: { w: this.pins[white.path], b: this.pins[black.path] },
                moveDelay: 20,
                meta: { event: 'Coliseum Elo Estimation', round: `${this.session.games + 1}`, whiteElo: r[white.path].rating, blackElo: r[black.path].rating },
            });
        } catch (e) {
            this.log(`Game error: ${e.message}`);
        }
        if (this.arbiters.get(slot) === arbiter) this.arbiters.delete(slot);
        if (!this.active || !result) return; // stopped (or the engines could not start): not counted

        // the career record has been updated by the arbiter's 'match-ended' listener by now
        const s = result.winner === 'white' ? 1 : result.winner === 'black' ? 0 : 0.5;
        const tally = (p, x) => {
            const t = this.session.perEngine[p];
            if (!t) return;
            if (x === 1) t.wins++;
            else if (x === 0) t.losses++;
            else t.draws++;
        };
        tally(white.path, s);
        tally(black.path, 1 - s);
        this.session.games++;
        this.session.timeline.push(this.snapshotRatings());
        if (this.session.timeline.length > 400) {
            // keep the chart light: drop every other old point
            this.session.timeline = this.session.timeline.filter((_, i, arr) => i % 2 === 0 || i > arr.length - 100);
        }
        this.session.recent.unshift({ white: white.name, black: black.name, winner: result.winner, reason: result.reason, at: Date.now(), gameNo });
        this.session.recent = this.session.recent.slice(0, 30);
        const res = s === 1 ? '1-0' : s === 0 ? '0-1' : '½-½';
        this.log(`${white.name} – ${black.name}  ${res}  (${result.reason || 'finished'})`);
        this.sendStatus();
    }

    status() {
        const r = this.ratings();
        const all = (this.store && this.store.get('engineCareerStats')) || {};
        const leaderboard = this.engines
            .map((e) => ({
                name: (all[e.path] && all[e.path].name) || e.name,
                path: e.path,
                rating: r[e.path].rating,
                error: r[e.path].error,
                careerGames: r[e.path].games,
                session: this.session ? this.session.perEngine[e.path] : null,
            }))
            .sort((x, y) => y.rating - x.rating);
        return {
            active: this.active,
            config: this.config,
            engines: this.engines,
            leaderboard,
            session: this.session ? { games: this.session.games, startedAt: this.session.startedAt, timeline: this.session.timeline, recent: this.session.recent } : null,
            anchor: this.career ? this.career.getAnchor() : null,
            current: this.active ? this.current : {},
        };
    }

    sendStatus() {
        this.sendUpdate(this.status());
    }

    sendUpdate(data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('elo-update', data);
    }

    log(msg) {
        this.sendUpdate({ logs: [msg] });
    }
}

module.exports = { EloManager, SPEEDS };
