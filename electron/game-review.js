const EventEmitter = require('events');
const { Chess } = require('chess.js');
const { EngineEvaluator } = require('./engine-evaluator');
const { OpeningBookSet } = require('./opening-book');
const A = require('./chess-analysis');

// Move classification thresholds, expressed as loss of win% (expected points x100)
// for the player who moved. These mirror the bands popularised by Chess.com.
const THRESHOLDS = {
    excellent: 2,
    good: 5,
    inaccuracy: 10,
    mistake: 20
};

const CATEGORIES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

function emptyStats() {
    const s = {};
    for (const c of CATEGORIES) s[c] = 0;
    return s;
}

// Replay a PGN and collect everything we need about each position.
function replayGame(pgnText) {
    const chess = new Chess();
    try {
        chess.loadPgn(pgnText);
    } catch (e) {
        throw new Error('Failed to load PGN: ' + e.message);
    }
    const headers = chess.header();
    const moves = chess.history({ verbose: true });

    const replay = new Chess();
    if (headers.FEN) {
        try { replay.load(headers.FEN); } catch (e) { /* keep start position */ }
    }
    const startColor = replay.turn();

    const describe = () => ({
        fen: replay.fen(),
        terminal: replay.isCheckmate() ? 'checkmate' : (replay.isDraw() || replay.isStalemate()) ? 'draw' : null,
        legalCount: replay.moves().length,
        inCheck: replay.inCheck()
    });

    const positions = [describe()];
    for (const move of moves) {
        replay.move(move);
        positions.push(describe());
    }
    return { headers, moves, positions, startColor };
}

function terminalEval(position) {
    if (position.terminal === 'checkmate') {
        return { lines: [{ score: { unit: 'mate', value: '0' }, pv: [] }], bestMove: null, depth: 0, terminal: true };
    }
    if (position.terminal === 'draw') {
        return { lines: [{ score: { unit: 'cp', value: '0' }, pv: [] }], bestMove: null, depth: 0, terminal: true };
    }
    return null;
}

// Pure classification step (no engine access) so it can be tested in isolation.
function classifyMoves({ moves, positions, evals, books = null }) {
    const classifications = [];
    const stats = { white: emptyStats(), black: emptyStats() };
    const moveAccs = [];
    const cpLoss = { w: [], b: [] };
    let inBook = !!(books && books.loaded);
    const useBookFallback = !(books && books.loaded);

    for (let j = 0; j < moves.length; j++) {
        const move = moves[j];
        const mover = move.color;
        const before = evals[j];
        const after = evals[j + 1];
        const pos = positions[j];
        const played = A.moveToUci(move);

        const bestLine = before?.lines?.[0] || null;
        const secondLine = before?.lines?.[1] || null;
        const bestMove = before?.bestMove || bestLine?.pv?.[0] || null;
        const isBest = !!bestMove && bestMove === played;

        const winBefore = bestLine ? A.winPercent(bestLine.score) : 50;
        const afterTop = after?.lines?.[0] || null;
        const winAfterSearch = afterTop ? 100 - A.winPercent(afterTop.score) : winBefore;

        // Prefer the score the engine gave the played move in the *same* search
        // (MultiPV) – it is directly comparable with the best line.
        const playedLine = before?.lines?.find(l => l.pv[0] === played) || null;
        let winAfter;
        if (isBest) winAfter = Math.max(winBefore, Math.min(winAfterSearch, 100));
        else if (playedLine) winAfter = A.winPercent(playedLine.score);
        else winAfter = winAfterSearch;
        if (isBest) winAfter = Math.max(winAfter, winBefore);

        const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);

        // Classic centipawn loss (capped) for ACPL
        const cpBefore = Math.max(-1000, Math.min(1000, A.scoreToCp(bestLine?.score)));
        const cpAfterRaw = playedLine ? A.scoreToCp(playedLine.score) : -A.scoreToCp(afterTop?.score);
        const cpAfter = Math.max(-1000, Math.min(1000, cpAfterRaw));
        const centipawnLoss = isBest ? 0 : Math.max(0, Math.round(cpBefore - cpAfter));

        // --- Base classification by win% loss
        let cls;
        if (isBest) cls = 'best';
        else if (loss < THRESHOLDS.excellent) cls = 'excellent';
        else if (loss < THRESHOLDS.good) cls = 'good';
        else if (loss < THRESHOLDS.inaccuracy) cls = 'inaccuracy';
        else if (loss < THRESHOLDS.mistake) cls = 'mistake';
        else cls = 'blunder';

        // --- Book moves (contiguous from the start of the game)
        let isBook = false;
        if (inBook) {
            if (books.isBookMove(pos.fen, played)) isBook = true;
            else inBook = false;
        } else if (useBookFallback && j < 8 && loss < 1.5) {
            isBook = true;
        }

        const prev = classifications[j - 1];
        const fenBefore = pos.fen;
        const bestMate = A.mateValue(bestLine?.score);

        if (isBook) {
            cls = 'book';
        } else if (pos.legalCount === 1) {
            cls = 'forced';
        } else {
            // Brilliant: a sound piece/exchange sacrifice that is (near) best
            // (not awarded when already totally winning, unless the sacrifice forces mate)
            const crushing = winBefore > 97 && !(bestMate !== null && bestMate > 0 && isBest);
            if ((isBest || loss < 1) && !pos.inCheck && !crushing && winAfter >= 50) {
                const sac = A.sacrificeAmount(fenBefore, played);
                if (sac >= 2) cls = 'brilliant';
            }

            // Great: the only good move (big gap to the second best line)
            if (cls === 'best' && secondLine) {
                const gap = A.winPercent(bestLine.score) - A.winPercent(secondLine.score);
                const isRecapture = prev && move.captured && moves[j - 1].captured && moves[j - 1].to === move.to;
                let freeMaterial = false;
                if (move.captured) {
                    try {
                        freeMaterial = A.see(new Chess(fenBefore), move.to) >= 2;
                    } catch (e) { /* ignore */ }
                }
                const deliversMate = move.san.includes('#');
                if (gap >= 15 && !isRecapture && !freeMaterial && !deliversMate) cls = 'great';
            }

            // Miss: failing to punish the opponent's error / missing a short mate
            if (cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy') {
                const oppErred = prev && prev.winLoss >= 10;
                const moverBeforeOppError = prev ? 100 - prev.winBefore : 50;
                if (oppErred && winBefore >= 60 && (cls !== 'inaccuracy') && winAfter >= moverBeforeOppError - 5) {
                    cls = 'miss';
                }
            }
            if (bestMate !== null && bestMate > 0 && bestMate <= 3 && !isBest) {
                const keptMate = playedLine
                    ? A.mateValue(playedLine.score) > 0
                    : (A.mateValue(afterTop?.score) !== null && A.mateValue(afterTop.score) < 0);
                if (!keptMate && winAfter >= 50 && cls !== 'blunder') cls = 'miss';
            }
        }

        let accuracy;
        if (cls === 'book' || cls === 'forced') accuracy = 100;
        else accuracy = A.moveAccuracy(winBefore, isBest ? winBefore : winAfter);
        accuracy = Math.round(accuracy * 10) / 10;
        moveAccs.push(accuracy);
        if (cls !== 'book' && cls !== 'forced') cpLoss[mover].push(Math.min(centipawnLoss, 1000));

        const bestLineSan = bestLine ? A.pvToSan(fenBefore, bestLine.pv, 8) : [];
        classifications.push({
            ply: j,
            san: move.san,
            uci: played,
            color: mover,
            classification: cls,
            accuracy,
            centipawnLoss,
            winBefore: Math.round(winBefore * 10) / 10,
            winAfter: Math.round(winAfter * 10) / 10,
            winLoss: Math.round(loss * 10) / 10,
            bestMove: bestMove,
            bestMoveSan: bestMove ? A.uciToSan(fenBefore, bestMove) : null,
            bestLineSan,
            engineEval: bestLine?.score || null,
            mateMissed: cls === 'miss' && bestMate !== null && bestMate > 0 ? bestMate : null
        });
        stats[mover === 'w' ? 'white' : 'black'][cls]++;
    }

    // Eval curve (White's point of view) for the graph
    const evalSeries = positions.map((p, i) => {
        const ev = evals[i];
        const top = ev?.lines?.[0];
        const stmWhite = p.fen.split(' ')[1] === 'w';
        let cp = null, mate = null, win = 50;
        if (top?.score) {
            const s = stmWhite ? top.score : A.negateScore(top.score);
            if (s.unit === 'mate') mate = parseInt(s.value, 10);
            else cp = parseInt(s.value, 10);
            win = A.winPercent(s);
            // "mate 0" = the side to move is checkmated
            if (top.score.unit === 'mate' && parseInt(top.score.value, 10) === 0) {
                win = stmWhite ? 0 : 100;
                mate = 0;
            }
        }
        return { ply: i, cp, mate, win: Math.round(win * 10) / 10 };
    });

    return { classifications, stats, moveAccs, evalSeries, cpLoss };
}

function summarise(result, startColor) {
    const acc = A.gameAccuracy(result.evalSeries.map(e => e.win), result.moveAccs, startColor);
    const acpl = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    return {
        whiteAccuracy: acc.white ?? 100,
        blackAccuracy: acc.black ?? 100,
        whiteAcpl: acpl(result.cpLoss.w),
        blackAcpl: acpl(result.cpLoss.b)
    };
}

class GameReviewer extends EventEmitter {
    constructor(mainWindow, configManager, getBooksDir = null) {
        super();
        this.mainWindow = mainWindow;
        this.configManager = configManager;
        this.getBooksDir = getBooksDir;
        this.evaluator = null;
        this.isScanning = false;
        this.shouldStop = false;
        this.books = new OpeningBookSet();
        this.booksDir = null;
    }

    send(channel, data) {
        try {
            if (this.mainWindow && !this.mainWindow.isDestroyed?.()) this.mainWindow.webContents.send(channel, data);
        } catch (e) { /* window gone */ }
    }

    loadBooks() {
        try {
            const dir = this.getBooksDir ? this.getBooksDir() : null;
            if (dir && dir !== this.booksDir) {
                const n = this.books.loadDirectory(dir);
                this.booksDir = dir;
                console.log(`[GameReview] Loaded ${n} opening book(s) from ${dir}`);
            }
        } catch (e) {
            console.warn('[GameReview] Could not load opening books:', e.message);
        }
    }

    async start(enginePath, pgnText, scanSpeed = 300) {
        if (this.isScanning) await this.stop();
        this.isScanning = true;
        this.shouldStop = false;
        const movetime = Math.max(50, parseInt(scanSpeed, 10) || 300);
        console.log(`[GameReview] Starting review with engine: ${enginePath} (${movetime}ms/position)`);

        try {
            const { moves, positions, startColor } = replayGame(pgnText);
            if (moves.length === 0) throw new Error('The game has no moves to review.');
            this.loadBooks();

            this.evaluator = new EngineEvaluator('ReviewEngine', this.configManager);
            await this.evaluator.init(enginePath, { multiPV: 2 });
            await this.evaluator.newGame();

            const evals = [];
            for (let i = 0; i < positions.length; i++) {
                if (this.shouldStop) return;
                this.send('game-review-progress', {
                    percent: Math.round((i / positions.length) * 100),
                    currentIndex: i + 1,
                    totalPositions: positions.length
                });
                const terminal = terminalEval(positions[i]);
                if (terminal) {
                    evals.push(terminal);
                    continue;
                }
                const ev = await this.evaluator.evaluate(positions[i].fen, { movetime, multiPV: 2 });
                if (this.shouldStop) return;
                evals.push(ev || { lines: [], bestMove: null });
            }

            const result = classifyMoves({ moves, positions, evals, books: this.books });
            const summary = summarise(result, startColor);
            console.log(`[GameReview] Done. White ${summary.whiteAccuracy}% / Black ${summary.blackAccuracy}%`);

            this.send('game-review-finished', {
                classifications: result.classifications,
                stats: result.stats,
                evalSeries: result.evalSeries,
                historySan: moves.map(m => m.san),
                usedBooks: this.books.loaded,
                ...summary
            });
        } catch (error) {
            console.error('[GameReview] Error during review:', error);
            this.send('game-review-error', error.message);
        } finally {
            await this.stop();
        }
    }

    async stop() {
        this.shouldStop = true;
        if (this.evaluator) {
            this.evaluator.stop();
            this.evaluator = null;
        }
        this.isScanning = false;
    }
}

module.exports = { GameReviewer, classifyMoves, replayGame, summarise, terminalEval };
