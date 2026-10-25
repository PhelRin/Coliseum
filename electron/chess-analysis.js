// Shared chess-analysis helpers used by Game Review and the Puzzle Generator.
// All scores coming from a UCI engine are relative to the side to move.

const { Chess } = require('chess.js');

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function isMateScore(score) {
    return !!score && score.unit === 'mate';
}

// Mate distance in moves (positive = side to move mates, negative = gets mated).
// "mate 0" means the side to move is already checkmated.
function mateValue(score) {
    if (!isMateScore(score)) return null;
    return parseInt(score.value, 10);
}

// Numeric centipawn value for sorting/arithmetic. Mates map to large values
// (shorter mates are "bigger").
function scoreToCp(score) {
    if (!score) return 0;
    if (score.unit === 'mate') {
        const m = parseInt(score.value, 10);
        if (m > 0) return 100000 - m * 100;
        return -100000 - m * 100; // m <= 0
    }
    const v = parseInt(score.value, 10);
    return Number.isFinite(v) ? v : 0;
}

// Lichess win-probability model (0..100) from the point of view of the side the score belongs to.
function winPercent(score) {
    if (!score) return 50;
    if (score.unit === 'mate') {
        const m = parseInt(score.value, 10);
        return m > 0 ? 100 : 0;
    }
    let cp = parseInt(score.value, 10);
    if (!Number.isFinite(cp)) cp = 0;
    cp = Math.max(-1000, Math.min(1000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function negateScore(score) {
    if (!score) return score;
    const v = parseInt(score.value, 10);
    return { ...score, value: String(-v) };
}

// Lichess per-move accuracy from win% before / after (mover's point of view).
function moveAccuracy(winBefore, winAfter) {
    if (winAfter >= winBefore) return 100;
    const diff = winBefore - winAfter;
    const raw = 103.1668 * Math.exp(-0.04354 * diff) - 3.1669 + 1; // +1 uncertainty bonus
    return Math.max(0, Math.min(100, raw));
}

function stdDev(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
    return Math.sqrt(v);
}

// Lichess game-accuracy: volatility-weighted mean blended with a harmonic mean.
// whiteWins: win% from White's point of view for every position (ply 0..N).
// moveAccs:  per ply accuracy (index = ply of the move, i.e. move from position i to i+1).
function gameAccuracy(whiteWins, moveAccs, startColor = 'w') {
    const nMoves = moveAccs.length;
    if (nMoves === 0) return { white: null, black: null };
    const windowSize = Math.max(2, Math.min(8, Math.floor(nMoves / 10)));

    // Build windows over the win% series (first windows padded like lichess)
    const windows = [];
    const firstWindow = whiteWins.slice(0, windowSize);
    for (let i = 0; i < Math.min(windowSize, whiteWins.length) - 2; i++) windows.push(firstWindow);
    for (let i = 0; i + windowSize <= whiteWins.length; i++) windows.push(whiteWins.slice(i, i + windowSize));
    const weights = windows.map(w => Math.max(0.5, Math.min(12, stdDev(w))));

    const result = {};
    for (const color of ['w', 'b']) {
        let wSum = 0, wTot = 0, harmonicDen = 0, count = 0;
        for (let ply = 0; ply < nMoves; ply++) {
            const moverIsWhite = ((ply % 2 === 0) === (startColor === 'w'));
            if ((color === 'w') !== moverIsWhite) continue;
            const acc = moveAccs[ply];
            const weight = weights[Math.min(ply, weights.length - 1)] ?? 1;
            wSum += acc * weight;
            wTot += weight;
            harmonicDen += 1 / Math.max(acc, 1);
            count++;
        }
        if (count === 0) {
            result[color] = null;
            continue;
        }
        const weighted = wSum / wTot;
        const harmonic = count / harmonicDen;
        result[color] = Math.round(((weighted + harmonic) / 2) * 10) / 10;
    }
    return { white: result.w, black: result.b };
}

// ---------------------------------------------------------------------------
// Move helpers
// ---------------------------------------------------------------------------

function uciToMoveInput(uci) {
    return {
        from: uci.substring(0, 2),
        to: uci.substring(2, 4),
        promotion: uci.length > 4 ? uci[4].toLowerCase() : undefined
    };
}

function moveToUci(move) {
    return move.from + move.to + (move.promotion || '');
}

// Apply a UCI move to a chess.js instance. Returns the verbose move or null.
function applyUci(chess, uci) {
    if (!uci || uci === '(none)' || uci === '0000') return null;
    try {
        return chess.move(uciToMoveInput(uci)) || null;
    } catch (e) {
        return null;
    }
}

// Convert a PV (array of uci moves) to SAN, stopping at the first illegal move.
function pvToSan(fen, pv, maxPlies = 12) {
    const chess = new Chess(fen);
    const san = [];
    for (const uci of (pv || []).slice(0, maxPlies)) {
        const m = applyUci(chess, uci);
        if (!m) break;
        san.push(m.san);
    }
    return san;
}

function uciToSan(fen, uci) {
    const chess = new Chess(fen);
    const m = applyUci(chess, uci);
    return m ? m.san : null;
}

// Swap side to move (a "null move"). Returns null if the side to move is in check.
function nullMoveFen(fen) {
    const parts = fen.split(' ');
    const chess = new Chess(fen);
    if (chess.inCheck()) return null;
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    try {
        const next = new Chess(parts.join(' '));
        return next.fen();
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Material / static exchange helpers
// ---------------------------------------------------------------------------

function materialCount(chess, color) {
    let sum = 0;
    for (const row of chess.board()) {
        for (const sq of row) {
            if (sq && sq.color === color) sum += PIECE_VALUES[sq.type];
        }
    }
    return sum;
}

function pieceCount(chess) {
    let n = 0;
    for (const row of chess.board()) {
        for (const sq of row) {
            if (sq && sq.type !== 'p' && sq.type !== 'k') n++;
        }
    }
    return n;
}

function nonPawnMaterial(chess) {
    let sum = 0;
    for (const row of chess.board()) {
        for (const sq of row) {
            if (sq && sq.type !== 'p' && sq.type !== 'k') sum += PIECE_VALUES[sq.type];
        }
    }
    return sum;
}

// Static exchange evaluation: material the side to move can win by starting a
// capture sequence on `square` (always >= 0 because it can decline).
// Uses legal moves, so pins and checks are respected.
function see(chess, square, depth = 0) {
    if (depth > 12) return 0;
    const target = chess.get(square);
    if (!target) return 0;
    let captures;
    try {
        captures = chess.moves({ verbose: true }).filter(m => m.to === square && m.captured);
    } catch (e) {
        return 0;
    }
    if (captures.length === 0) return 0;
    // Least valuable attacker first
    captures.sort((a, b) => PIECE_VALUES[a.piece] - PIECE_VALUES[b.piece]);
    const m = captures[0];
    const gain = target.type === 'k' ? 100 : PIECE_VALUES[target.type];
    const promoBonus = m.promotion ? PIECE_VALUES[m.promotion] - 1 : 0;
    chess.move(m);
    const reply = see(chess, square, depth + 1);
    chess.undo();
    return Math.max(0, gain + promoBonus - reply);
}

// Largest amount of material the side to move could win immediately by a single
// capture sequence against `victimColor`'s pieces.
function maxCaptureGain(chess, victimColor) {
    let best = 0;
    const board = chess.board();
    for (const row of board) {
        for (const sq of row) {
            if (!sq || sq.color !== victimColor || sq.type === 'k') continue;
            const g = see(chess, sq.square);
            if (g > best) best = g;
        }
    }
    return best;
}

// How much material `color` currently has "hanging" (what the opponent could
// win right now if it were their move). Returns 0 if it can't be measured.
function hangingMaterial(fen, color) {
    try {
        const chess = new Chess(fen);
        if (chess.turn() === color) {
            const nf = nullMoveFen(fen);
            if (!nf) return 0;
            return maxCaptureGain(new Chess(nf), color);
        }
        return maxCaptureGain(chess, color);
    } catch (e) {
        return 0;
    }
}

// Did the move from `fenBefore` sacrifice material? Returns the net number of
// pawns offered (>= 2 is a real piece/exchange sacrifice).
function sacrificeAmount(fenBefore, uci) {
    try {
        const chess = new Chess(fenBefore);
        const mover = chess.turn();
        const move = applyUci(chess, uci);
        if (!move) return 0;
        const captured = move.captured ? PIECE_VALUES[move.captured] : 0;
        const promoGain = move.promotion ? PIECE_VALUES[move.promotion] - 1 : 0;
        const threatBefore = hangingMaterial(fenBefore, mover);
        const threatAfter = maxCaptureGain(chess, mover);
        return threatAfter - threatBefore - captured - promoGain;
    } catch (e) {
        return 0;
    }
}

function legalMoveCount(fen) {
    try {
        return new Chess(fen).moves().length;
    } catch (e) {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Puzzle theme detection
// ---------------------------------------------------------------------------

function attackersOf(chess, square, color) {
    try {
        return chess.attackers(square, color) || [];
    } catch (e) {
        return [];
    }
}

function findKing(chess, color) {
    for (const row of chess.board()) {
        for (const sq of row) {
            if (sq && sq.type === 'k' && sq.color === color) return sq.square;
        }
    }
    return null;
}

// After `move` has been played on `chess`, does the moved piece fork two targets?
function isFork(chess, move) {
    const mover = move.color;
    const enemy = mover === 'w' ? 'b' : 'w';
    const pieceType = move.promotion || move.piece;
    if (pieceType === 'k') return false;
    const myValue = PIECE_VALUES[pieceType];
    let targets = 0;
    for (const row of chess.board()) {
        for (const sq of row) {
            if (!sq || sq.color !== enemy) continue;
            const atk = attackersOf(chess, sq.square, mover);
            if (!atk.includes(move.to)) continue;
            if (sq.type === 'k') { targets++; continue; }
            const defended = attackersOf(chess, sq.square, enemy).length > 0;
            if (PIECE_VALUES[sq.type] > myValue || !defended) targets++;
        }
    }
    return targets >= 2;
}

function detectThemes(rootFen, solutionUci, opts = {}) {
    const themes = new Set();
    const chess = new Chess(rootFen);
    const solver = chess.turn();
    const solverMoves = Math.ceil(solutionUci.length / 2);
    const pieces = pieceCount(chess);
    const fullMove = parseInt(rootFen.split(' ')[5], 10) || 1;

    if (pieces <= 6 || nonPawnMaterial(chess) <= 14) themes.add('endgame');
    else if (fullMove <= 12) themes.add('opening');
    else themes.add('middlegame');

    if (solverMoves === 1) themes.add('oneMove');
    else if (solverMoves === 2) themes.add('short');
    else if (solverMoves >= 4) themes.add('veryLong');
    else themes.add('long');

    let lastMove = null;
    for (let i = 0; i < solutionUci.length; i++) {
        const fenBefore = chess.fen();
        const isSolverMove = chess.turn() === solver;
        const preTarget = chess.get(solutionUci[i].substring(2, 4));
        const move = applyUci(chess, solutionUci[i]);
        if (!move) break;
        lastMove = move;
        if (!isSolverMove) continue;

        if (move.promotion) {
            themes.add('promotion');
            if (move.promotion !== 'q') themes.add('underPromotion');
        }
        if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) themes.add('castling');
        if (move.flags && move.flags.includes('e')) themes.add('enPassant');

        if (sacrificeAmount(fenBefore, solutionUci[i]) >= 2) themes.add('sacrifice');
        if (!chess.isCheckmate() && isFork(chess, move)) themes.add('fork');

        if (chess.inCheck()) {
            const kingSq = findKing(chess, chess.turn());
            const checkers = kingSq ? attackersOf(chess, kingSq, solver) : [];
            if (checkers.length >= 2) themes.add('doubleCheck');
            else if (checkers.length === 1 && checkers[0] !== move.to) themes.add('discoveredAttack');
        }

        if (i === 0 && move.captured && preTarget) {
            // First move simply grabs a piece that was undefended
            const before = new Chess(fenBefore);
            const defenders = attackersOf(before, move.to, before.turn() === 'w' ? 'b' : 'w');
            if (defenders.length === 0 && PIECE_VALUES[move.captured] >= 3) themes.add('hangingPiece');
        }
        if (i === 0 && !move.captured && !chess.inCheck() && !move.promotion) themes.add('quietMove');
    }

    if (chess.isCheckmate() && lastMove) {
        themes.add('mate');
        themes.add(`mateIn${solverMoves}`);
        const matedColor = chess.turn();
        const kingSq = findKing(chess, matedColor);
        if (kingSq) {
            const backRank = matedColor === 'w' ? '1' : '8';
            const mp = lastMove.promotion || lastMove.piece;
            if (kingSq[1] === backRank && (mp === 'r' || mp === 'q') && lastMove.to[1] === backRank) {
                themes.add('backRankMate');
            }
            if (mp === 'n') {
                // Smothered: every square around the king is blocked by own pieces
                const files = 'abcdefgh';
                const f = files.indexOf(kingSq[0]);
                const r = parseInt(kingSq[1], 10);
                let smothered = true;
                for (let df = -1; df <= 1 && smothered; df++) {
                    for (let dr = -1; dr <= 1; dr++) {
                        if (!df && !dr) continue;
                        const nf = f + df, nr = r + dr;
                        if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
                        const p = chess.get(files[nf] + nr);
                        if (!p || p.color !== matedColor) { smothered = false; break; }
                    }
                }
                if (smothered) themes.add('smotheredMate');
            }
        }
    } else if (opts.finalWin !== undefined) {
        themes.add(opts.finalWin >= 90 ? 'crushing' : 'advantage');
    }

    return [...themes];
}

// Rough difficulty estimate (puzzle "rating") from the solution features.
function estimateDifficulty(themes, solutionLength) {
    const solverMoves = Math.ceil(solutionLength / 2);
    let rating = 1000 + (solverMoves - 1) * 220;
    if (themes.includes('sacrifice')) rating += 250;
    if (themes.includes('quietMove')) rating += 200;
    if (themes.includes('underPromotion')) rating += 150;
    if (themes.includes('discoveredAttack') || themes.includes('doubleCheck')) rating += 80;
    if (themes.includes('hangingPiece')) rating -= 250;
    if (themes.includes('mateIn1')) rating -= 200;
    if (themes.includes('backRankMate')) rating -= 50;
    rating = Math.max(600, Math.min(2800, Math.round(rating / 10) * 10));
    const label = rating < 1100 ? 'Easy' : rating < 1500 ? 'Medium' : rating < 1900 ? 'Hard' : 'Expert';
    return { rating, label };
}

module.exports = {
    PIECE_VALUES,
    isMateScore,
    mateValue,
    scoreToCp,
    winPercent,
    negateScore,
    moveAccuracy,
    gameAccuracy,
    uciToMoveInput,
    moveToUci,
    applyUci,
    pvToSan,
    uciToSan,
    nullMoveFen,
    materialCount,
    see,
    maxCaptureGain,
    hangingMaterial,
    sacrificeAmount,
    legalMoveCount,
    detectThemes,
    estimateDifficulty,
};
