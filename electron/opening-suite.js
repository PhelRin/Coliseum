// Opening suites from files, as used for engine testing:
//   .epd  one position per line ("<board> <side> <castling> <ep> [ops...]"); plain FEN lines too
//   .pgn  one opening per game: its moves (from its [FEN] tag, if it has one), optionally
//         cut to the first N moves
// Large files (hundreds of thousands of lines) are fine: games are only split up when loading,
// and a game's moves are turned into coordinates when that opening is actually played.

const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const MAX_FILE_BYTES = 200 * 1024 * 1024;

class OpeningSuiteError extends Error {}

function formatOf(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.epd' || ext === '.fen') return 'epd';
    if (ext === '.pgn') return 'pgn';
    return null;
}

// ---------------------------------------------------------------------------- EPD
function epdToFen(line) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return null;
    const [board, side, castling, ep] = parts;
    if (!/^[pnbrqkPNBRQK1-8/]+$/.test(board) || board.split('/').length !== 8 || !/^[wb]$/.test(side)) return null;
    // a full FEN: keep its move counters
    if (/^\d+$/.test(parts[4] || '') && /^\d+$/.test(parts[5] || '')) return `${board} ${side} ${castling} ${ep} ${parts[4]} ${parts[5]}`;
    // EPD opcodes "hmvc N;" / "fmvn N;"
    const rest = parts.slice(4).join(' ');
    const hm = rest.match(/\bhmvc\s+(\d+)/);
    const fm = rest.match(/\bfmvn\s+(\d+)/);
    return `${board} ${side} ${castling} ${ep} ${hm ? hm[1] : 0} ${fm ? fm[1] : 1}`;
}

function parseEpd(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        const fen = epdToFen(line);
        if (fen) out.push({ fen });
    }
    return out;
}

// ---------------------------------------------------------------------------- PGN
function splitGames(text) {
    // a new game starts at a tag pair line that follows movetext (or the file start)
    const games = [];
    let cur = { tags: {}, moves: [] };
    let inMoves = false;
    const push = () => {
        if (cur.moves.length || Object.keys(cur.tags).length) games.push(cur);
        cur = { tags: {}, moves: [] };
        inMoves = false;
    };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const tag = line.match(/^\[(\w+)\s+"(.*)"\]\s*$/);
        if (tag) {
            if (inMoves) push();
            cur.tags[tag[1]] = tag[2];
            continue;
        }
        if (line.startsWith('%')) continue; // escape line
        inMoves = true;
        cur.moves.push(line);
    }
    push();
    return games;
}

// movetext -> SAN tokens (main line only)
function sanTokens(movetext) {
    let t = movetext.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
    // drop variations, nested ones too
    let prev;
    do {
        prev = t;
        t = t.replace(/\([^()]*\)/g, ' ');
    } while (t !== prev);
    return t
        .replace(/\$\d+/g, ' ')
        .replace(/\d+\.(\.\.)?/g, ' ')
        .split(/\s+/)
        .map((x) => x.replace(/[!?]+$/, ''))
        .filter((x) => x && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x) && !/^\.+$/.test(x));
}

const SAN_RE = /^(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[NBRQnbrq])?|O-O(?:-O)?|0-0(?:-0)?)[+#]?$/;

function parsePgn(text) {
    return splitGames(text)
        .map((g) => ({ fen: g.tags.FEN || null, san: sanTokens(g.moves.join(' ')) }))
        // a line must at least start with something that looks like a move (or set up a position)
        .filter((g) => (g.san.length && SAN_RE.test(g.san[0])) || (g.fen && !g.san.length));
}

// ---------------------------------------------------------------------------- suite
class OpeningSuite {
    /**
     * opts: { order: 'sequential' | 'random', plies: 0 (all) | max plies from each PGN line, seed }
     */
    constructor(file, opts = {}) {
        this.file = file;
        this.name = path.basename(file);
        this.format = formatOf(file);
        if (!this.format) throw new OpeningSuiteError('Choose an .epd or .pgn file.');
        let st;
        try {
            st = fs.statSync(file);
        } catch (e) {
            throw new OpeningSuiteError('The opening file was not found.');
        }
        if (st.size > MAX_FILE_BYTES) throw new OpeningSuiteError('The opening file is too large (over 200 MB).');
        const text = fs.readFileSync(file, 'utf8');
        this.entries = this.format === 'epd' ? parseEpd(text) : parsePgn(text);
        if (!this.entries.length) throw new OpeningSuiteError(`No openings found in ${this.name}.`);
        this.plies = Math.max(0, parseInt(opts.plies, 10) || 0);
        this.order = opts.order === 'random' ? 'random' : 'sequential';
        this.seed = (opts.seed >>> 0) || 1;
        this.perm = this.order === 'random' ? shuffled(this.entries.length, this.seed) : null;
    }

    get count() {
        return this.entries.length;
    }

    /** Opening number `index` as { fen, moves (UCI) }; broken entries are skipped. */
    get(index) {
        const n = this.entries.length;
        for (let k = 0; k < Math.min(n, 50); k++) {
            const i = (index + k) % n;
            const e = this.entries[this.perm ? this.perm[i] : i];
            const opening = this.resolve(e);
            if (opening) return opening;
        }
        return { fen: null, moves: [] };
    }

    resolve(e) {
        let game;
        try {
            game = e.fen ? new Chess(e.fen) : new Chess();
        } catch (err) {
            return null;
        }
        if (game.isGameOver()) return null;
        if (this.format === 'epd') return { fen: game.fen(), moves: [] };
        const moves = [];
        const limit = this.plies || 60; // "all" still stops at 30 moves: a whole game is never forced on the engines
        for (const san of e.san) {
            if (moves.length >= limit) break;
            let r = null;
            try {
                r = game.move(san, { strict: false });
            } catch (err) {
                r = null;
            }
            if (!r) break;
            moves.push(r.from + r.to + (r.promotion || ''));
            if (game.isGameOver()) {
                moves.pop(); // leave the engines something to play
                break;
            }
        }
        return { fen: e.fen ? new Chess(e.fen).fen() : null, moves };
    }
}

// a quick look at a file for the setup screen
function inspect(file, opts = {}) {
    try {
        const s = new OpeningSuite(file, opts);
        const sample = s.get(0);
        return { ok: true, format: s.format, count: s.count, name: s.name, sample };
    } catch (e) {
        return { ok: false, error: e instanceof OpeningSuiteError ? e.message : `Could not read the file: ${e.message}` };
    }
}

function shuffled(n, seed) {
    // Fisher-Yates with a small 32-bit generator (mulberry32), so every seed gives a different order
    const a = Array.from({ length: n }, (_, i) => i);
    let s = seed >>> 0 || 1;
    const next = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

module.exports = { OpeningSuite, OpeningSuiteError, inspect, parseEpd, parsePgn, epdToFen, sanTokens };
