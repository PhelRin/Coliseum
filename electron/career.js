// Engine career stats and ratings.
//
// Every finished engine-vs-engine game (Quick Match, tournaments, Elo estimation) is recorded
// once here. Ratings are then re-fitted to all recorded results (see ratings.js), so they no
// longer depend on the order games were played in, and every rating comes with an error bar.
// Games involving a human player are not rated.

const { computeRatings } = require('./ratings');

const MAX_RESULTS = 20000; // keep the store small; very old games drop off first
const MAX_HISTORY = 100;

function emptyStats() {
    return {
        wins: 0, losses: 0, draws: 0,
        asWhite: { wins: 0, losses: 0, draws: 0 },
        asBlack: { wins: 0, losses: 0, draws: 0 },
        totalMoves: 0, gameCount: 0,
    };
}

class Career {
    constructor() {
        this.store = null;
    }

    setStore(store) {
        this.store = store;
    }

    getAnchor() {
        return (this.store && this.store.get('ratingAnchor')) || null;
    }

    setAnchor(anchor) {
        if (!this.store) return null;
        if (anchor && anchor.path && Number.isFinite(Number(anchor.rating))) this.store.set('ratingAnchor', { path: anchor.path, rating: Math.round(Number(anchor.rating)) });
        else this.store.delete('ratingAnchor');
        return this.recompute();
    }

    ensureEngine(all, path, name) {
        if (!all[path]) {
            all[path] = {
                name: name || path,
                path,
                rating: 1500,
                baseRating: 1500,
                ratingHistory: [{ timestamp: Date.now(), rating: 1500, opponent: 'Initial Setup', result: 'none' }],
                stats: emptyStats(),
            };
        }
        const e = all[path];
        if (name) e.name = name;
        // engines rated by an older version of Coliseum keep their rating as their starting point
        if (typeof e.baseRating !== 'number') e.baseRating = typeof e.rating === 'number' ? e.rating : 1500;
        if (!e.stats) e.stats = emptyStats();
        if (!e.ratingHistory) e.ratingHistory = [];
        return e;
    }

    /**
     * data: { white: { path, name }, black: { path, name }, winner: 'white'|'black'|'draw', pgn, plies }
     */
    recordGame(data) {
        try {
            if (!this.store || !data || !data.white || !data.black) return null;
            const wPath = data.white.path;
            const bPath = data.black.path;
            if (!wPath || !bPath || wPath === 'manual' || bPath === 'manual') return null;
            if (!['white', 'black', 'draw'].includes(data.winner)) return null;

            const all = this.store.get('engineCareerStats') || {};
            const w = this.ensureEngine(all, wPath, data.white.name);
            const b = this.ensureEngine(all, bPath, data.black.name);

            const sW = data.winner === 'white' ? 1 : data.winner === 'black' ? 0 : 0.5;
            const moves = Math.ceil((data.plies || 0) / 2);
            const tally = (e, side, s) => {
                e.stats.gameCount += 1;
                e.stats.totalMoves += moves;
                const key = s === 1 ? 'wins' : s === 0 ? 'losses' : 'draws';
                e.stats[key] += 1;
                e.stats[side][key] += 1;
            };
            tally(w, 'asWhite', sW);
            tally(b, 'asBlack', 1 - sW);

            const results = this.store.get('gameResults') || [];
            results.push({ w: wPath, b: bPath, s: sW, t: Date.now() });
            if (results.length > MAX_RESULTS) results.splice(0, results.length - MAX_RESULTS);
            this.store.set('gameResults', results);

            const ratings = this.fit(all, results);
            const now = Date.now();
            for (const [e, opp, s] of [[w, b, sW], [b, w, 1 - sW]]) {
                e.ratingHistory.push({
                    timestamp: now,
                    rating: ratings[e.path] ? ratings[e.path].rating : e.rating,
                    opponent: opp.name,
                    result: s === 1 ? 'win' : s === 0 ? 'loss' : 'draw',
                });
                if (e.ratingHistory.length > MAX_HISTORY) e.ratingHistory = [e.ratingHistory[0], ...e.ratingHistory.slice(-(MAX_HISTORY - 1))];
            }
            this.apply(all, ratings);
            this.store.set('engineCareerStats', all);
            return ratings;
        } catch (e) {
            console.error('[Career] Failed to record game:', e);
            return null;
        }
    }

    fit(all, results) {
        const base = {};
        Object.values(all).forEach((e) => (base[e.path] = typeof e.baseRating === 'number' ? e.baseRating : 1500));
        const anchor = this.getAnchor();
        return computeRatings(
            results.map((r) => ({ white: r.w, black: r.b, score: r.s })),
            { base, anchor: anchor && all[anchor.path] ? { id: anchor.path, rating: anchor.rating } : null }
        );
    }

    apply(all, ratings) {
        for (const [p, r] of Object.entries(ratings)) {
            if (!all[p]) continue;
            all[p].rating = r.rating;
            all[p].ratingError = r.error;
        }
    }

    /** Re-fit all ratings (e.g. after the anchor changed). Returns the career stats. */
    recompute() {
        if (!this.store) return {};
        const all = this.store.get('engineCareerStats') || {};
        Object.values(all).forEach((e) => this.ensureEngine(all, e.path, e.name));
        const ratings = this.fit(all, this.store.get('gameResults') || []);
        this.apply(all, ratings);
        this.store.set('engineCareerStats', all);
        return all;
    }

    /** Forget everything (used by "Reset all engine Elos"). */
    resetAll() {
        if (!this.store) return;
        this.store.set('engineCareerStats', {});
        this.store.set('gameResults', []);
    }

    /** Forget one engine's games and stats. */
    resetEngine(path) {
        if (!this.store) return;
        const all = this.store.get('engineCareerStats') || {};
        delete all[path];
        const results = (this.store.get('gameResults') || []).filter((r) => r.w !== path && r.b !== path);
        this.store.set('gameResults', results);
        this.store.set('engineCareerStats', all);
        this.recompute();
    }
}

module.exports = { Career };
