// SPRT (sequential probability ratio test) for engine testing, as used by Fishtest,
// OpenBench and cutechess: play game pairs (same opening, colours swapped) until the result is
// clear enough to accept one of two hypotheses:
//   H0: the new engine is at most elo0 stronger than the base
//   H1: it is at least elo1 stronger
// alpha = chance of accepting H1 when H0 is true (a false gain), beta = the reverse.
//
// Game pairs are counted as a pentanomial (pair score 0, 0.5, 1, 1.5, 2 points), which takes
// out most of the noise of unbalanced openings. The log-likelihood ratio is the generalised
// SPRT for the logistic Elo model as used by Fishtest (Michel Van den Bergh): the observed
// pair-score distribution is tilted (maximum likelihood) to have the mean score each hypothesis
// predicts, and LLR = sum over outcomes of count * log(p_H1 / p_H0).

const expected = (elo) => 1 / (1 + Math.pow(10, -elo / 400));
const eloOf = (score) => {
    const s = Math.min(1 - 1e-9, Math.max(1e-9, score));
    return -400 * Math.log10(1 / s - 1);
};

function bounds(alpha, beta) {
    return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/**
 * penta: counts of pairs scoring [0, 0.5, 1, 1.5, 2] points for the new engine.
 * Returns { llr, lower, upper, pairs, elo, eloLow, eloHigh, los, result: 'H1'|'H0'|null }
 */
function sprt(penta, { elo0 = 0, elo1 = 5, alpha = 0.05, beta = 0.05 } = {}) {
    const N = penta.reduce((a, b) => a + b, 0);
    const { lower, upper } = bounds(alpha, beta);
    const out = { llr: 0, lower, upper, pairs: N, elo: null, eloLow: null, eloHigh: null, los: null, result: null };
    if (N === 0) return out;

    // regularise: empty cells get a tiny weight so every outcome stays possible
    const reg = penta.map((c) => (c === 0 ? 1e-3 : c));
    const total = reg.reduce((a, b) => a + b, 0);
    const scores = [0, 0.25, 0.5, 0.75, 1];
    const pdf = reg.map((c) => c / total);
    const mean = pdf.reduce((a, p, i) => a + p * scores[i], 0);
    const variance = pdf.reduce((a, p, i) => a + p * (scores[i] - mean) ** 2, 0);

    const p0 = tilted(scores, pdf, expected(elo0));
    const p1 = tilted(scores, pdf, expected(elo1));
    out.llr = reg.reduce((a, c, i) => a + c * Math.log(p1[i] / p0[i]), 0);
    if (out.llr >= upper) out.result = 'H1';
    else if (out.llr <= lower) out.result = 'H0';

    // Elo estimate with a 95% range, and the likelihood of superiority
    // (from the regularised counts, so a perfect score early on isn't an infinite Elo)
    const sd = Math.sqrt(variance / N);
    out.elo = eloOf(mean);
    out.eloLow = eloOf(mean - 1.959964 * sd);
    out.eloHigh = eloOf(mean + 1.959964 * sd);
    out.los = sd > 0 ? 0.5 * (1 + erf((mean - 0.5) / (sd * Math.SQRT2))) : null;
    return out;
}

// The distribution closest to `pdf` (maximum likelihood) whose mean score is `s`:
// p_i / (1 + t * (x_i - s)), with t found by bisection.
function tilted(xs, pdf, s) {
    const d = xs.map((x) => x - s);
    const maxD = Math.max(...d);
    const minD = Math.min(...d);
    let lo = -1 / maxD;
    let hi = -1 / minD;
    const f = (t) => d.reduce((a, di, i) => a + (pdf[i] * di) / (1 + t * di), 0);
    for (let k = 0; k < 200; k++) {
        const mid = (lo + hi) / 2;
        if (mid === lo || mid === hi) break;
        if (f(mid) > 0) lo = mid;
        else hi = mid;
    }
    const t = (lo + hi) / 2;
    return pdf.map((p, i) => p / (1 + t * d[i]));
}

// Abramowitz-Stegun 7.1.26
function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return sign * y;
}

function normaliseSprt(cfg = {}) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    let elo0 = num(cfg.elo0, 0);
    let elo1 = num(cfg.elo1, 5);
    if (elo1 <= elo0) elo1 = elo0 + 1;
    const clampP = (p) => Math.min(0.5, Math.max(0.001, p));
    return {
        elo0,
        elo1,
        alpha: clampP(num(cfg.alpha, 0.05)),
        beta: clampP(num(cfg.beta, 0.05)),
        maxGames: Math.max(2, Math.min(100000, Math.round(num(cfg.maxGames, 20000) / 2) * 2)),
    };
}

module.exports = { sprt, bounds, expected, eloOf, normaliseSprt };
