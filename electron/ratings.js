// Ratings from game results, with error bars.
//
// Instead of nudging a rating by a fixed amount after every game (which depends on the order
// games were played and swings a lot), ratings are fitted to *all* results at once: the set of
// Elo ratings under which the actual results are most likely (the same idea as BayesElo/Ordo).
// A light prior (two virtual draws against an opponent at the engine's starting rating) keeps
// ratings finite for engines that have won or lost everything, and keeps the overall level
// where it was before.

const LN10 = Math.log(10);
const SCALE = 400 / LN10; // Elo points per logistic unit

const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

/**
 * results: [{ white, black, score }]  score is White's points: 1, 0.5 or 0
 * opts.base: { id: startingRating }   prior centre for each engine (default 1500)
 * opts.anchor: { id, rating }          optional: shift everything so this engine has this rating
 * Returns { id: { rating, error, games, points, wins, draws, losses } }  (error = 95% interval, ±)
 */
function computeRatings(results, opts = {}) {
    const base = opts.base || {};
    const priorGames = opts.priorGames === undefined ? 2 : opts.priorGames;

    // aggregate per pair: games and points of the first engine
    const ids = new Set(Object.keys(base));
    const pair = new Map(); // "a\u0000b" -> { a, b, n, pa }
    const info = {};
    const touch = (id) => {
        ids.add(id);
        if (!info[id]) info[id] = { games: 0, points: 0, wins: 0, draws: 0, losses: 0 };
    };
    for (const r of results) {
        if (!r || !r.white || !r.black || r.white === r.black) continue;
        const s = Number(r.score);
        if (!(s === 0 || s === 0.5 || s === 1)) continue;
        touch(r.white);
        touch(r.black);
        const [a, b, pa] = r.white < r.black ? [r.white, r.black, s] : [r.black, r.white, 1 - s];
        const key = a + '\u0000' + b;
        const p = pair.get(key) || { a, b, n: 0, pa: 0 };
        p.n += 1;
        p.pa += pa;
        pair.set(key, p);
        const w = info[r.white], bl = info[r.black];
        w.games++; bl.games++;
        w.points += s; bl.points += 1 - s;
        if (s === 1) { w.wins++; bl.losses++; } else if (s === 0) { w.losses++; bl.wins++; } else { w.draws++; bl.draws++; }
    }
    ids.forEach(touch);

    const R = {};
    ids.forEach((id) => (R[id] = typeof base[id] === 'number' ? base[id] : 1500));
    const pairs = [...pair.values()];

    for (let iter = 0; iter < 300; iter++) {
        const grad = {}, hess = {};
        ids.forEach((id) => {
            // prior: virtual draws against an engine of the starting rating
            const b0 = typeof base[id] === 'number' ? base[id] : 1500;
            const p = expected(R[id], b0);
            grad[id] = priorGames * (0.5 - p);
            hess[id] = priorGames * p * (1 - p);
        });
        for (const q of pairs) {
            const p = expected(R[q.a], R[q.b]);
            const g = q.pa - q.n * p;
            const h = q.n * p * (1 - p);
            grad[q.a] += g; hess[q.a] += h;
            grad[q.b] -= g; hess[q.b] += h;
        }
        let maxStep = 0;
        ids.forEach((id) => {
            let step = (SCALE * grad[id]) / Math.max(hess[id], 1e-9);
            step = Math.max(-200, Math.min(200, step)) * 0.8; // damped Newton step
            R[id] += step;
            maxStep = Math.max(maxStep, Math.abs(step));
        });
        if (maxStep < 0.01) break;
    }

    // error bars from the curvature at the fitted ratings
    const hess = {};
    ids.forEach((id) => {
        const b0 = typeof base[id] === 'number' ? base[id] : 1500;
        const p = expected(R[id], b0);
        hess[id] = priorGames * p * (1 - p);
    });
    for (const q of pairs) {
        const p = expected(R[q.a], R[q.b]);
        hess[q.a] += q.n * p * (1 - p);
        hess[q.b] += q.n * p * (1 - p);
    }

    let shift = 0;
    if (opts.anchor && opts.anchor.id && R[opts.anchor.id] !== undefined) shift = opts.anchor.rating - R[opts.anchor.id];

    const out = {};
    ids.forEach((id) => {
        out[id] = {
            ...info[id],
            rating: Math.round(R[id] + shift),
            error: Math.round((1.96 * SCALE) / Math.sqrt(Math.max(hess[id], 1e-9))),
        };
    });
    return out;
}

/**
 * Elo difference implied by a match score, with a 95% error margin.
 * Returns { elo, error, score }  (elo is clamped to ±1000 when a side scored 100%)
 */
function eloDiff(wins, draws, losses) {
    const n = wins + draws + losses;
    if (!n) return { elo: 0, error: null, score: null };
    const s = (wins + draws / 2) / n;
    const clamp = Math.min(Math.max(s, 0.5 / n), 1 - 0.5 / n);
    const elo = Math.max(-1000, Math.min(1000, -400 * Math.log10(1 / clamp - 1)));
    const variance = (wins * (1 - s) ** 2 + draws * (0.5 - s) ** 2 + losses * s ** 2) / n;
    const se = Math.sqrt(variance / n);
    const dEdS = 400 / (LN10 * clamp * (1 - clamp));
    // all wins, all losses or all draws: no spread to measure yet, so no margin
    const error = n > 1 && variance > 0 ? Math.round(1.96 * se * dEdS) : null;
    return { elo: Math.round(elo), error, score: s };
}

/** Performance rating: the rating at which a score of `points` from games against `opponents` is expected. */
function performance(opponentRatings, points) {
    const n = opponentRatings.length;
    if (!n) return null;
    let lo = -1000, hi = 5000;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const e = opponentRatings.reduce((acc, r) => acc + expected(mid, r), 0);
        if (e < points) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2);
}

module.exports = { computeRatings, eloDiff, performance, expected };
