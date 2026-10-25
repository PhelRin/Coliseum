const EventEmitter = require('events');
const { Chess } = require('chess.js');
const { PolyglotBook } = require('./polyglot');
const { openingFor } = require('./openings');
const { eloDiff, performance } = require('./ratings');

// =============================================================================================
// Tournaments
//
// Every format is built from *matches*. A match is two games between the same two engines from
// the same opening, one with each engine as White, so neither gets the luckier colour or
// opening. A match can grow extra games (knockout tiebreaks).
//
//   gauntlet            one main engine plays every opponent N matches
//   round_robin         every engine plays every other engine N matches
//   swiss               R rounds; each round pairs engines on similar scores, one match each
//   elimination         knockout bracket, each round a match (tiebreaks if level)
//   double_elimination  knockout with a losers' bracket and a grand final (plus reset)
//
// Several games can run at once (settings.concurrency); the screen shows all of them.
// =============================================================================================

const TIEBREAK_PAIRS = 2; // extra 2-game mini-matches when a knockout match is level
const SUDDEN_DEATH = 4; // then single games until someone wins (higher seed goes through after that)
const BOOK_MAX_PLIES = 24; // how deep a sampled book line may go

function getSeededOrder(n) {
    let order = [1];
    while (order.length < n) {
        const next = [];
        const target = order.length * 2 + 1;
        for (const o of order) next.push(o, target - o);
        order = next;
    }
    return order;
}

const ref = (e) => (e ? { name: e.name, path: e.path, elo: e.elo, isBye: !!e.isBye } : null);
const BYE = { name: 'BYE', path: '', isBye: true };
const scoreOf = (winner) => (winner === 'white' ? 1 : winner === 'black' ? 0 : 0.5);

class TournamentManager extends EventEmitter {
    /**
     * createArbiter(slot) -> Arbiter that sends its live events on 'tournament-game'
     */
    constructor(mainWindow, createArbiter, store) {
        super();
        this.mainWindow = mainWindow;
        this.createArbiter = createArbiter;
        this.store = store || null;
        this.active = false;
        this.state = null;
        this.arbiters = new Map(); // slot -> arbiter
        this.book = null;
        this.linked = null; // LinkedEngines, set by main
    }

    send(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(channel, data);
    }

    // ------------------------------------------------------------------ lifecycle
    async startTournament(config) {
        this.stopArbiters();
        const cfg = normaliseConfig(config);
        this.state = {
            config: cfg,
            matches: [],
            games: [],
            nextGameId: 1,
            round: 0, // swiss
            totalRounds: cfg.type === 'swiss' ? cfg.rounds : 0,
            openingCounter: 0,
            seed: (Date.now() & 0x7fffffff) || 1,
            startedAt: Date.now(),
            finished: false,
        };
        const engines = cfg.engines.map((e) => this.enrich(e));
        if (cfg.type === 'gauntlet') this.buildGauntlet(engines);
        else if (cfg.type === 'round_robin') this.buildRoundRobin(engines);
        else if (cfg.type === 'swiss') this.startSwissRound();
        else if (cfg.type === 'double_elimination') this.buildDoubleElimination(engines);
        else this.buildElimination(engines);

        this.active = true;
        await this.loadBook();
        this.pinLinkedEngines();
        this.saveState();
        this.sendUpdate();
        this.pump();
    }

    // Linked engines run from a copy taken now, so their author can rebuild the original
    // while the tournament plays; every game of the tournament uses the same build.
    pinLinkedEngines() {
        if (!this.state) return;
        if (this.linked) {
            this.linked.release(this.state.launchPins);
            this.state.launchPins = this.linked.pin(this.state.config.engines.map((e) => e.path), this.state.launchPins || {});
        } else {
            this.state.launchPins = {};
        }
    }

    releaseLinkedEngines() {
        if (this.linked && this.state) this.linked.release(this.state.launchPins);
    }

    async resumeTournament(saved) {
        this.stopArbiters();
        if (!saved || !Array.isArray(saved.games) || !Array.isArray(saved.matches)) {
            // saved by an older version of Coliseum: can't be resumed
            this.clearState();
            this.send('tournament-finished', { cancelled: true });
            return;
        }
        this.state = saved;
        this.state.config = normaliseConfig(saved.config);
        delete this.state.stoppedAt;
        // games that were running when the app closed are played again
        this.state.games.forEach((g) => {
            if (g.status === 'playing') {
                g.status = 'pending';
                g.slot = null;
            }
        });
        this.active = true;
        await this.loadBook();
        this.pinLinkedEngines();
        this.saveState();
        this.sendUpdate();
        this.pump();
    }

    stopTournament() {
        this.active = false;
        if (this.state) this.state.stoppedAt = Date.now();
        this.stopArbiters();
        this.releaseLinkedEngines();
        this.send('tournament-finished', { cancelled: true, ...this.snapshot() });
        this.emit('ended', this.state);
    }

    finishTournament() {
        if (!this.active) return;
        this.active = false;
        this.state.finished = true;
        this.state.finishedAt = Date.now();
        this.releaseLinkedEngines();
        this.clearState();
        this.sendUpdate();
        this.send('tournament-finished', this.snapshot());
        this.emit('ended', this.state);
    }

    stopArbiters() {
        for (const a of this.arbiters.values()) {
            try {
                a.stopMatch();
            } catch (e) { /* ignore */ }
        }
        this.arbiters.clear();
    }

    saveState() {
        if (!this.store || !this.state) return;
        this.store.set('savedTournament', this.state);
    }

    clearState() {
        if (this.store) this.store.delete('savedTournament');
    }

    enrich(engine) {
        let elo = 1500;
        if (this.store) {
            const stats = this.store.get('engineCareerStats') || {};
            if (stats[engine.path] && typeof stats[engine.path].rating === 'number') elo = stats[engine.path].rating;
        }
        return { name: engine.name, path: engine.path, elo };
    }

    async loadBook() {
        this.book = null;
        const o = this.state.config.openings;
        if (o.mode === 'book' && o.book) {
            const b = new PolyglotBook();
            if (await b.load(o.book)) this.book = b;
        }
    }

    // ------------------------------------------------------------------ building the schedule
    addMatch(m) {
        const match = {
            id: this.state.matches.length,
            label: this.state.matches.length + 1,
            round: '',
            a: null,
            b: null,
            games: [],
            status: 'pending', // pending | playing | done
            points: { a: 0, b: 0 },
            winner: null, // 'a' | 'b' | 'draw' (round robin / swiss / gauntlet can end level)
            tiebreaks: 0,
            suddenDeath: 0,
            ...m,
        };
        this.state.matches.push(match);
        return match;
    }

    // two games, same opening, colours swapped
    addPair(match, tag = '') {
        const opening = { index: this.state.openingCounter++ };
        for (let i = 0; i < 2; i++) {
            this.state.games.push({
                id: this.state.nextGameId++,
                matchId: match.id,
                aIsWhite: i === 0,
                opening,
                pairIndex: i,
                tag,
                status: 'pending',
                result: null,
                slot: null,
            });
        }
        match.games = this.state.games.filter((g) => g.matchId === match.id).map((g) => g.id);
    }

    addSingle(match, aIsWhite, tag) {
        this.state.games.push({
            id: this.state.nextGameId++,
            matchId: match.id,
            aIsWhite,
            opening: { index: this.state.openingCounter++ },
            pairIndex: 0,
            tag,
            status: 'pending',
            result: null,
            slot: null,
        });
        match.games = this.state.games.filter((g) => g.matchId === match.id).map((g) => g.id);
    }

    buildGauntlet(engines) {
        const cfg = this.state.config;
        const hero = engines.find((e) => e.path === cfg.hero) || engines[0];
        const opponents = engines.filter((e) => e.path !== hero.path);
        const n = cfg.matchesPerPairing;
        const push = (opp, r) => {
            const m = this.addMatch({ a: ref(hero), b: ref(opp), round: `Match ${r + 1} vs ${opp.name}`, matchNo: r + 1 });
            this.addPair(m);
        };
        if (cfg.order === 'sequential') opponents.forEach((opp) => { for (let r = 0; r < n; r++) push(opp, r); });
        else for (let r = 0; r < n; r++) opponents.forEach((opp) => push(opp, r));
    }

    buildRoundRobin(engines) {
        const n = this.state.config.matchesPerPairing;
        // circle method: every cycle pairs everyone once per "round"
        const list = engines.length % 2 ? [...engines, null] : [...engines];
        const k = list.length;
        let roundNo = 0;
        for (let cycle = 0; cycle < n; cycle++) {
            const arr = [...list];
            for (let r = 0; r < k - 1; r++) {
                roundNo++;
                for (let i = 0; i < k / 2; i++) {
                    const x = arr[i];
                    const y = arr[k - 1 - i];
                    if (!x || !y) continue;
                    // alternate who is listed first so "a" isn't always the same engine
                    const [a, b] = (r + cycle) % 2 ? [y, x] : [x, y];
                    const m = this.addMatch({ a: ref(a), b: ref(b), round: `Round ${roundNo}` });
                    this.addPair(m);
                }
                arr.splice(1, 0, arr.pop()); // rotate all but the first
            }
        }
    }

    startSwissRound() {
        const st = this.state;
        st.round += 1;
        const engines = st.config.engines.map((e) => this.enrich(e));
        const table = this.swissTable(engines);
        const sorted = [...engines].sort((x, y) => table[y.path].points - table[x.path].points || y.elo - x.elo);

        // bye for the lowest-ranked engine that hasn't had one
        let byeEngine = null;
        if (sorted.length % 2) {
            for (let i = sorted.length - 1; i >= 0; i--) {
                if (!table[sorted[i].path].hadBye) {
                    byeEngine = sorted[i];
                    break;
                }
            }
            if (!byeEngine) byeEngine = sorted[sorted.length - 1];
        }
        const pool = sorted.filter((e) => e !== byeEngine);
        const pairs = pairSwiss(pool, (x, y) => table[x.path].opponents.includes(y.path));
        for (const [x, y] of pairs) {
            const m = this.addMatch({ a: ref(x), b: ref(y), round: `Swiss Round ${st.round}`, swissRound: st.round });
            this.addPair(m);
        }
        if (byeEngine) {
            const m = this.addMatch({ a: ref(byeEngine), b: ref(BYE), round: `Swiss Round ${st.round}`, swissRound: st.round });
            this.resolveBye(m);
        }
    }

    swissTable(engines) {
        const t = {};
        engines.forEach((e) => (t[e.path] = { points: 0, opponents: [], hadBye: false }));
        for (const m of this.state.matches) {
            if (m.status !== 'done') continue;
            if (m.b && m.b.isBye) {
                if (t[m.a.path]) {
                    t[m.a.path].points += m.points.a;
                    t[m.a.path].hadBye = true;
                }
                continue;
            }
            if (t[m.a.path]) {
                t[m.a.path].points += m.points.a;
                t[m.a.path].opponents.push(m.b.path);
            }
            if (t[m.b.path]) {
                t[m.b.path].points += m.points.b;
                t[m.b.path].opponents.push(m.a.path);
            }
        }
        return t;
    }

    buildElimination(engines) {
        const sorted = [...engines].sort((x, y) => y.elo - x.elo).map((e, i) => ({ ...e, seed: i + 1 }));
        const size = Math.pow(2, Math.ceil(Math.log2(Math.max(2, sorted.length))));
        while (sorted.length < size) sorted.push({ ...BYE });
        const seeded = getSeededOrder(size).map((s) => sorted[s - 1]);

        let tier = seeded.map((e) => ({ engine: e }));
        let roundNo = 1;
        const totalRounds = Math.log2(size);
        while (tier.length > 1) {
            const next = [];
            const name = roundName(roundNo, totalRounds);
            for (let i = 0; i < tier.length; i += 2) {
                const m = this.addMatch({
                    a: tier[i].engine ? refSeed(tier[i].engine) : placeholder(tier[i].from, 'winner', this.state.matches),
                    b: tier[i + 1].engine ? refSeed(tier[i + 1].engine) : placeholder(tier[i + 1].from, 'winner', this.state.matches),
                    round: name,
                    bracket: 'W',
                });
                next.push({ from: m.id });
            }
            tier = next;
            roundNo++;
        }
        this.state.matches.forEach((m) => this.prepareKnockoutMatch(m));
    }

    buildDoubleElimination(engines) {
        const sorted = [...engines].sort((x, y) => y.elo - x.elo).map((e, i) => ({ ...e, seed: i + 1 }));
        const N = Math.pow(2, Math.ceil(Math.log2(Math.max(4, sorted.length))));
        while (sorted.length < N) sorted.push({ ...BYE });
        const seeded = getSeededOrder(N).map((s) => sorted[s - 1]);
        const k = Math.log2(N);
        const M = this.state.matches;
        const W = {}, L = {};
        const add = (a, b, round, bracket, extra = {}) => this.addMatch({ a, b, round, bracket, ...extra }).id;

        W[1] = [];
        for (let i = 0; i < N / 2; i++) W[1].push(add(refSeed(seeded[2 * i]), refSeed(seeded[2 * i + 1]), 'Winners Round 1', 'W'));
        L[1] = [];
        for (let i = 0; i < N / 4; i++) L[1].push(add(placeholder(W[1][2 * i], 'loser', M), placeholder(W[1][2 * i + 1], 'loser', M), 'Losers Round 1', 'L'));
        for (let step = 2; step < k; step++) {
            const numW = N / Math.pow(2, step);
            W[step] = [];
            for (let i = 0; i < numW; i++) W[step].push(add(placeholder(W[step - 1][2 * i], 'winner', M), placeholder(W[step - 1][2 * i + 1], 'winner', M), `Winners Round ${step}`, 'W'));
            const lb = 2 * step - 2;
            L[lb] = [];
            for (let i = 0; i < numW; i++) L[lb].push(add(placeholder(L[lb - 1][i], 'winner', M), placeholder(W[step][numW - 1 - i], 'loser', M), `Losers Round ${lb}`, 'L'));
            const la = 2 * step - 1;
            L[la] = [];
            for (let i = 0; i < numW / 2; i++) L[la].push(add(placeholder(L[lb][2 * i], 'winner', M), placeholder(L[lb][2 * i + 1], 'winner', M), `Losers Round ${la}`, 'L'));
        }
        W[k] = [add(placeholder(W[k - 1][0], 'winner', M), placeholder(W[k - 1][1], 'winner', M), 'Winners Final', 'W')];
        const lf = 2 * k - 2;
        L[lf] = [add(placeholder(L[lf - 1][0], 'winner', M), placeholder(W[k][0], 'loser', M), 'Losers Final', 'L')];
        const gf = add(placeholder(W[k][0], 'winner', M), placeholder(L[lf][0], 'winner', M), 'Grand Final', 'GF', { isGrandFinal: true });
        add(placeholder(gf, 'winner', M), placeholder(gf, 'loser', M), 'Grand Final (Reset)', 'GF', { isGrandFinalReset: true });
        this.state.matches.forEach((m) => this.prepareKnockoutMatch(m));
    }

    // knockout matches get their games once both players are known (a bye needs none)
    prepareKnockoutMatch(m) {
        if (m.status !== 'pending' || m.games.length) return;
        if (isPlaceholder(m.a) || isPlaceholder(m.b)) return;
        if (m.isGrandFinalReset && !m.resetNeeded) return;
        if ((m.a && m.a.isBye) || (m.b && m.b.isBye)) {
            this.resolveBye(m);
            return;
        }
        this.addPair(m);
    }

    resolveBye(m) {
        const aBye = m.a && m.a.isBye;
        const bBye = m.b && m.b.isBye;
        m.status = 'done';
        m.bye = true;
        if (this.state.config.type === 'swiss') {
            // a bye counts as a won match
            m.points = aBye ? { a: 0, b: 2 } : { a: 2, b: 0 };
        }
        m.winner = aBye && !bBye ? 'b' : 'a';
        if (this.isKnockout()) this.advanceKnockout(m);
    }

    isKnockout() {
        const t = this.state.config.type;
        return t === 'elimination' || t === 'double_elimination';
    }

    // ------------------------------------------------------------------ running games
    pump() {
        if (!this.active || !this.state) return;
        const limit = this.state.config.concurrency;
        while (this.arbiters.size < limit) {
            const game = this.nextReadyGame();
            if (!game) break;
            this.launch(game);
        }
        if (this.arbiters.size === 0 && !this.nextReadyGame()) this.onIdle();
    }

    nextReadyGame() {
        for (const g of this.state.games) {
            if (g.status !== 'pending') continue;
            const m = this.state.matches[g.matchId];
            if (isPlaceholder(m.a) || isPlaceholder(m.b)) continue;
            return g;
        }
        return null;
    }

    freeSlot() {
        for (let s = 0; ; s++) if (!this.arbiters.has(s)) return s;
    }

    async openingFor(game) {
        const o = this.state.config.openings;
        if (game.opening.fen || game.opening.moves) return game.opening;
        if (o.mode === 'builtin') {
            game.opening.fen = openingFor(game.opening.index, this.state.seed);
        } else if (o.mode === 'book' && this.book) {
            game.opening.moves = sampleBookLine(this.book);
        } else {
            game.opening.moves = [];
        }
        // the paired game shares the very same object after a resume too
        this.state.games.forEach((x) => {
            if (x.opening.index === game.opening.index) x.opening = game.opening;
        });
        return game.opening;
    }

    launchPathsFor(whitePath, blackPath) {
        const pins = (this.state && this.state.launchPins) || {};
        const get = (p) => {
            if (!pins[p]) return undefined;
            // the pinned copy was removed (e.g. user data cleaned): pin the current build
            if (this.linked && !this.linked.stillThere(pins[p])) Object.assign(pins, this.linked.pin([p]));
            return pins[p];
        };
        return { w: get(whitePath), b: get(blackPath) };
    }

    async launch(game) {
        const m = this.state.matches[game.matchId];
        const slot = this.freeSlot();
        const arbiter = this.createArbiter(slot);
        this.arbiters.set(slot, arbiter);
        game.status = 'playing';
        game.slot = slot;
        if (m.status === 'pending') m.status = 'playing';

        const white = game.aIsWhite ? m.a : m.b;
        const black = game.aIsWhite ? m.b : m.a;
        const opening = await this.openingFor(game);
        const tc = this.state.config.settings;
        const cfg = this.state.config;
        const settings = {
            initial: tc.initial,
            inc: tc.inc,
            whiteTimeControl: tc.type === 'unlimited' ? { type: 'unlimited' } : tc.movetime ? { movetime: tc.movetime } : undefined,
            blackTimeControl: tc.type === 'unlimited' ? { type: 'unlimited' } : tc.movetime ? { movetime: tc.movetime } : undefined,
            startFen: opening.fen || undefined,
            openingMoves: opening.moves && opening.moves.length ? opening.moves : undefined,
            launchPaths: this.launchPathsFor(white.path, black.path),
            moveDelay: cfg.concurrency > 1 ? 20 : 80,
            meta: {
                event: `Coliseum ${formatName(cfg.type)}`,
                round: `${m.label}.${m.games.indexOf(game.id) + 1}`,
                whiteElo: white.elo,
                blackElo: black.elo,
            },
        };
        this.send('tournament-game', { slot, kind: 'assigned', gameId: game.id, matchId: m.id, round: m.round, white, black });
        this.saveState();
        this.sendUpdate();

        let result = null;
        try {
            result = await arbiter.startMatch(white.path, black.path, settings);
        } catch (e) {
            console.error('[Tournament] game failed:', e);
        }
        if (this.arbiters.get(slot) === arbiter) this.arbiters.delete(slot);
        if (!this.active) return;

        if (!result) {
            // the engines could not be started: count it as a loss for nobody, retry later? No:
            // score it as a draw so a broken engine can't stall the whole tournament.
            result = { winner: 'draw', reason: 'Engine failed to start', pgn: '' };
        }
        this.onGameEnded(game, result);
    }

    onGameEnded(game, result) {
        const m = this.state.matches[game.matchId];
        game.status = 'done';
        game.slot = null;
        game.result = { winner: result.winner, reason: result.reason, pgn: result.pgn, plies: result.plies || 0 };
        const sWhite = scoreOf(result.winner);
        const sA = game.aIsWhite ? sWhite : 1 - sWhite;
        m.points.a += sA;
        m.points.b += 1 - sA;

        const games = m.games.map((id) => this.state.games.find((g) => g.id === id));
        if (games.every((g) => g.status === 'done')) this.onMatchGamesDone(m);

        this.saveState();
        this.sendUpdate();
        setTimeout(() => this.pump(), 300);
    }

    onMatchGamesDone(m) {
        if (this.isKnockout()) {
            if (m.points.a === m.points.b) {
                // level: tiebreak mini-matches, then sudden death, then the higher seed
                if (m.tiebreaks < TIEBREAK_PAIRS) {
                    m.tiebreaks++;
                    this.addPair(m, `Tiebreak ${m.tiebreaks}`);
                    return;
                }
                if (m.suddenDeath < SUDDEN_DEATH) {
                    m.suddenDeath++;
                    this.addSingle(m, m.suddenDeath % 2 === 1, `Sudden death ${m.suddenDeath}`);
                    return;
                }
                m.winner = seedOf(m.a) <= seedOf(m.b) ? 'a' : 'b';
                m.decidedBySeed = true;
            } else {
                m.winner = m.points.a > m.points.b ? 'a' : 'b';
            }
            m.status = 'done';
            this.advanceKnockout(m);
            return;
        }
        m.status = 'done';
        m.winner = m.points.a > m.points.b ? 'a' : m.points.b > m.points.a ? 'b' : 'draw';
    }

    advanceKnockout(m) {
        const winner = m.winner === 'b' ? m.b : m.a;
        const loser = m.winner === 'b' ? m.a : m.b;
        if (m.isGrandFinal) {
            // the reset is only played if the losers' bracket champion ('b') won the final
            const reset = this.state.matches.find((x) => x.isGrandFinalReset);
            if (reset) {
                if (m.winner === 'b') reset.resetNeeded = true;
                else {
                    reset.status = 'done';
                    reset.skipped = true;
                }
            }
        }
        for (const x of this.state.matches) {
            for (const side of ['a', 'b']) {
                const p = x[side];
                if (p && p.isPlaceholder && p.sourceMatchId === m.id) {
                    x[side] = p.sourceType === 'loser' ? { ...loser } : { ...winner };
                }
            }
        }
        this.state.matches.forEach((x) => this.prepareKnockoutMatch(x));
    }

    onIdle() {
        if (!this.active) return;
        const st = this.state;
        const allDone = st.matches.every((m) => m.status === 'done');
        if (!allDone) return; // waiting on something (shouldn't happen)
        if (st.config.type === 'swiss' && st.round < st.totalRounds) {
            this.startSwissRound();
            this.saveState();
            this.sendUpdate();
            setTimeout(() => this.pump(), 500);
            return;
        }
        setTimeout(() => this.finishTournament(), 500);
    }

    // ------------------------------------------------------------------ reporting
    snapshot() {
        const st = this.state;
        if (!st) return {};
        const games = st.games.map((g) => {
            const m = st.matches[g.matchId];
            return {
                id: g.id,
                matchId: g.matchId,
                white: g.aIsWhite ? m.a : m.b,
                black: g.aIsWhite ? m.b : m.a,
                status: g.status,
                slot: g.slot,
                tag: g.tag,
                result: g.result ? { winner: g.result.winner, reason: g.result.reason, plies: g.result.plies } : null,
            };
        });
        const doneGames = st.games.filter((g) => g.status === 'done').length;
        return {
            config: st.config,
            matches: st.matches,
            games,
            standings: computeStandings(st),
            progress: { games: doneGames, totalGames: estimateTotalGames(st), round: st.round, totalRounds: st.totalRounds },
            finished: !!st.finished,
            startedAt: st.startedAt,
            finishedAt: st.finishedAt || st.stoppedAt || null,
        };
    }

    sendUpdate() {
        this.send('tournament-update', this.snapshot());
    }

    getCombinedPgn() {
        if (!this.state) return '';
        return this.state.games
            .filter((g) => g.result && g.result.pgn)
            .map((g) => g.result.pgn)
            .join('\n\n');
    }
}

// ============================================================================ helpers

function normaliseConfig(config) {
    const c = { ...config };
    c.type = c.type || 'gauntlet';
    c.engines = (c.engines || []).map((e) => ({ name: e.name, path: e.path }));
    c.matchesPerPairing = Math.max(1, Math.min(100, parseInt(c.matchesPerPairing, 10) || 1));
    const n = c.engines.length;
    const defaultRounds = Math.max(1, Math.min(n - 1, Math.ceil(Math.log2(Math.max(2, n))) + 1));
    c.rounds = Math.max(1, Math.min(50, parseInt(c.rounds, 10) || defaultRounds));
    c.order = c.order === 'sequential' ? 'sequential' : 'interleaved';
    c.concurrency = Math.max(1, Math.min(16, parseInt(c.concurrency, 10) || 1));
    c.settings = c.settings || {};
    // openings: 'builtin' (50 balanced positions), 'book' (a Polyglot book), 'startpos'
    const legacyBook = c.settings.commonBook;
    c.openings = c.openings || (legacyBook ? { mode: 'book', book: legacyBook } : { mode: 'builtin' });
    if (c.openings.mode === 'book' && !c.openings.book) c.openings = { mode: 'builtin' };
    if (c.type === 'gauntlet' && !c.engines.some((e) => e.path === c.hero)) c.hero = c.engines[0] && c.engines[0].path;
    return c;
}

function formatName(type) {
    return {
        gauntlet: 'Gauntlet',
        round_robin: 'Round Robin',
        swiss: 'Swiss',
        elimination: 'Knockout',
        double_elimination: 'Double Knockout',
    }[type] || 'Tournament';
}

function roundName(r, total) {
    const left = total - r;
    if (left === 0) return 'Final';
    if (left === 1) return 'Semi-finals';
    if (left === 2) return 'Quarter-finals';
    return `Round ${r}`;
}

function refSeed(e) {
    return e.isBye ? { ...BYE } : { name: e.name, path: e.path, elo: e.elo, seed: e.seed };
}

function placeholder(sourceMatchId, sourceType, matches) {
    const src = matches[sourceMatchId];
    return {
        isPlaceholder: true,
        sourceMatchId,
        sourceType,
        name: `${sourceType === 'loser' ? 'Loser' : 'Winner'} of ${src ? src.round : 'match'} #${src ? src.label : sourceMatchId + 1}`,
    };
}

const isPlaceholder = (x) => !!(x && x.isPlaceholder);
const seedOf = (x) => (x && x.seed) || 999;

// pair engines in order (best first), avoiding rematches where possible
function pairSwiss(pool, played) {
    const best = { pairs: null };
    const used = new Array(pool.length).fill(false);
    const out = [];
    let steps = 0;
    const rec = () => {
        if (best.pairs || steps++ > 20000) return;
        const i = used.indexOf(false);
        if (i === -1) {
            best.pairs = out.slice();
            return;
        }
        used[i] = true;
        for (let j = i + 1; j < pool.length; j++) {
            if (used[j] || played(pool[i], pool[j])) continue;
            used[j] = true;
            out.push([pool[i], pool[j]]);
            rec();
            out.pop();
            used[j] = false;
            if (best.pairs) break;
        }
        used[i] = false;
    };
    rec();
    if (best.pairs) return best.pairs;
    // everyone has met everyone nearby: allow rematches, best against next best
    const pairs = [];
    for (let i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
    return pairs;
}

// a random line from the book, the same for both games of a match
function sampleBookLine(book) {
    const g = new Chess();
    const moves = [];
    for (let i = 0; i < BOOK_MAX_PLIES; i++) {
        const mv = book.getMove(g.fen());
        if (!mv) break;
        try {
            const r = g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] || undefined });
            if (!r) break;
            moves.push(mv);
        } catch (e) {
            break;
        }
        if (g.isGameOver()) break;
    }
    return moves;
}

function estimateTotalGames(st) {
    const real = st.games.length;
    if (st.config.type === 'swiss') {
        const n = st.config.engines.length;
        return Math.floor(n / 2) * 2 * st.totalRounds;
    }
    if (st.config.type === 'elimination' || st.config.type === 'double_elimination') {
        // matches still waiting for their players will add at least two games each
        const waiting = st.matches.filter((m) => m.status === 'pending' && !m.games.length && !m.skipped && !(m.isGrandFinalReset && !m.resetNeeded)).length;
        return real + waiting * 2;
    }
    return real;
}

function computeStandings(st) {
    const cfg = st.config;
    const rows = {};
    cfg.engines.forEach((e) => {
        rows[e.path] = { name: e.name, path: e.path, played: 0, wins: 0, draws: 0, losses: 0, points: 0, matchWins: 0, matchDraws: 0, matchLosses: 0, opponents: [], vs: {} };
    });
    const doneMatches = st.matches.filter((m) => m.status === 'done' && !m.skipped);
    for (const g of st.games) {
        if (g.status !== 'done' || !g.result) continue;
        const m = st.matches[g.matchId];
        const white = g.aIsWhite ? m.a : m.b;
        const black = g.aIsWhite ? m.b : m.a;
        const sW = scoreOf(g.result.winner);
        for (const [p, opp, s] of [[white, black, sW], [black, white, 1 - sW]]) {
            const r = rows[p.path];
            if (!r) continue;
            r.played++;
            r.points += s;
            if (s === 1) r.wins++;
            else if (s === 0) r.losses++;
            else r.draws++;
            const v = (r.vs[opp.path] = r.vs[opp.path] || { name: opp.name, wins: 0, draws: 0, losses: 0, points: 0, games: 0, matches: [] });
            v.games++;
            v.points += s;
            if (s === 1) v.wins++;
            else if (s === 0) v.losses++;
            else v.draws++;
        }
    }
    for (const m of doneMatches) {
        if (!m.a || !m.b) continue;
        if (m.bye) {
            const r = rows[m.a.isBye ? m.b.path : m.a.path];
            if (r && cfg.type === 'swiss') r.points += 2;
            continue;
        }
        for (const [side, other] of [['a', 'b'], ['b', 'a']]) {
            const r = rows[m[side].path];
            if (!r) continue;
            r.opponents.push(m[other].path);
            const mine = m.points[side], theirs = m.points[other];
            if (mine > theirs) r.matchWins++;
            else if (mine < theirs) r.matchLosses++;
            else r.matchDraws++;
            const v = r.vs[m[other].path];
            if (v) v.matches.push(`${fmtPts(mine)}–${fmtPts(theirs)}`);
        }
    }
    // tiebreaks: Buchholz (opponents' points) and Sonneborn-Berger (points weighted by the opponent's points)
    Object.values(rows).forEach((r) => {
        r.buchholz = r.opponents.reduce((acc, p) => acc + (rows[p] ? rows[p].points : 0), 0);
        r.sonnebornBerger = Object.entries(r.vs).reduce((acc, [p, v]) => acc + v.points * (rows[p] ? rows[p].points : 0), 0);
        r.scorePct = r.played ? (r.points / r.played) * 100 : 0;
    });
    const list = Object.values(rows).sort(
        (x, y) => y.points - x.points || y.buchholz - x.buchholz || y.sonnebornBerger - x.sonnebornBerger || y.wins - x.wins
    );

    const out = { rows: list.map(({ opponents, ...r }) => ({ ...r, vs: Object.entries(r.vs).map(([path, v]) => ({ path, ...v, ...eloDiff(v.wins, v.draws, v.losses) })) })) };

    if (cfg.type === 'gauntlet') {
        const hero = rows[cfg.hero];
        if (hero) {
            const oppRatings = [];
            const vs = cfg.engines
                .filter((e) => e.path !== cfg.hero)
                .map((e) => {
                    const v = hero.vs[e.path] || { wins: 0, draws: 0, losses: 0, points: 0, games: 0, matches: [] };
                    const opp = st.matches.find((m) => m.b && m.b.path === e.path);
                    const elo = opp && typeof opp.b.elo === 'number' ? opp.b.elo : null;
                    for (let i = 0; i < v.games; i++) if (elo !== null) oppRatings.push(elo);
                    return { path: e.path, name: e.name, rating: elo, ...v, ...eloDiff(v.wins, v.draws, v.losses) };
                });
            out.gauntlet = {
                hero: { name: hero.name, path: hero.path, wins: hero.wins, draws: hero.draws, losses: hero.losses, points: hero.points, played: hero.played, ...eloDiff(hero.wins, hero.draws, hero.losses) },
                opponents: vs,
                performance: oppRatings.length ? performance(oppRatings, hero.points) : null,
            };
        }
    }
    if (cfg.type === 'elimination' || cfg.type === 'double_elimination') {
        let final = st.matches[st.matches.length - 1];
        if (cfg.type === 'double_elimination') {
            const reset = st.matches.find((m) => m.isGrandFinalReset);
            final = reset && reset.status === 'done' && !reset.skipped ? reset : st.matches.find((m) => m.isGrandFinal);
        }
        if (final && final.status === 'done' && final.winner) out.champion = final.winner === 'b' ? final.b : final.a;
    }
    return out;
}

const fmtPts = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

module.exports = { TournamentManager, normaliseConfig, computeStandings, pairSwiss, sampleBookLine };
