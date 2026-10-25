const EventEmitter = require('events');
const { Chess } = require('chess.js');
const { EngineEvaluator } = require('./engine-evaluator');
const { replayGame, terminalEval } = require('./game-review');
const A = require('./chess-analysis');

// How the generator works
// -----------------------
// 1. Every position of every game is evaluated ONCE (MultiPV 2) at the scan speed.
// 2. From that eval sequence we find candidate puzzle positions:
//      mate        - the side to move has a forced mate (in the selected range)
//      blunder     - the opponent's last move threw away >= 20% winning chances;
//                    the solver must punish it (classic tactics-trainer puzzle)
//      better_move - the side to move had a winning shot but played something else
// 3. Each candidate is verified with a deeper search and a solution line is built:
//      * every solver move must be the ONLY good move (MultiPV gap check), so the
//        puzzle has one clear answer
//      * the opponent always plays the engine's best defence
//      * the line stops as soon as the solver's move is no longer unique
//      * mate puzzles must actually end in checkmate
// 4. Puzzles get theme tags (fork, sacrifice, back-rank mate ...) and a rough
//    difficulty rating. Overlapping puzzles from the same sequence are skipped.

// Sensitivity presets (all values are win% for the solver, 0..100; 50 = equal,
// ~60 = +1.2, ~75 = +3, ~90 = +6).
//   strict   - only clear, decisive tactics (Lichess-style)
//   balanced - also smaller but clean tactics, plus "only move" defensive puzzles
//   relaxed  - many more puzzles, including modest advantages
const PRESETS = {
    strict:   { blunderLoss: 20, missedLoss: 12, winStart: 75, keep: 70, defendMin: null, gap: 18, onlyMoveGap: null },
    balanced: { blunderLoss: 12, missedLoss: 10, winStart: 60, keep: 57, defendMin: 40, gap: 15, onlyMoveGap: null },
    relaxed:  { blunderLoss: 8,  missedLoss: 7,  winStart: 55, keep: 52, defendMin: 33, gap: 12, onlyMoveGap: 15 }
};

function isUnique(best, second, gap = 18) {
    if (!best) return false;
    if (!second) return true; // only one legal move / engine without MultiPV
    const bestMate = A.mateValue(best.score);
    const secondMate = A.mateValue(second.score);
    if (bestMate !== null && bestMate > 0) {
        if (secondMate !== null && secondMate > 0) return false;
        return A.winPercent(second.score) < 90;
    }
    const wB = A.winPercent(best.score);
    const wS = A.winPercent(second.score);
    return (wB - wS >= gap) || (wS <= 55 && wB - wS >= Math.min(10, gap));
}

function fenKey(fen) {
    return fen.split(' ').slice(0, 4).join(' ');
}

class PuzzleGenerator extends EventEmitter {
    constructor(mainWindow, configManager) {
        super();
        this.mainWindow = mainWindow;
        this.configManager = configManager;
        this.evaluator = null;
        this.isScanning = false;
        this.shouldStop = false;
    }

    send(channel, data) {
        try {
            if (this.mainWindow && !this.mainWindow.isDestroyed?.()) this.mainWindow.webContents.send(channel, data);
        } catch (e) { /* window gone */ }
    }

    async start(enginePath, pgnText, settings = {}) {
        if (this.isScanning) await this.stop();
        this.isScanning = true;
        this.shouldStop = false;

        const scanSpeed = Math.max(50, parseInt(settings.scanSpeed, 10) || 300);
        const verifyTime = Math.min(3000, Math.max(400, scanSpeed * 3));
        const enabledTypes = settings.types || { mate: true, blunder: true, better_move: true };
        const mateRange = settings.mateRange || { m1: true, m2: true, m3: true, mx: true };
        const targetSide = settings.targetSide || 'both';
        const maxPlies = Math.max(1, parseInt(settings.maxPlies, 10) || 10);
        const startPly = 8;
        const P = PRESETS[settings.sensitivity] || PRESETS.balanced;

        console.log(`[PuzzleGen] Scan: ${scanSpeed}ms sweep / ${verifyTime}ms verify, sensitivity ${settings.sensitivity || 'balanced'}, engine ${enginePath}`);

        let puzzlesFound = 0;
        try {
            const gamesPgn = this.splitPgnGames(pgnText);
            if (gamesPgn.length === 0) throw new Error('No games found in the provided PGN.');

            this.evaluator = new EngineEvaluator('PuzzleEngine', this.configManager);
            await this.evaluator.init(enginePath, { multiPV: 2 });
            if (!this.evaluator.supportsMultiPV) {
                console.warn('[PuzzleGen] Engine has no MultiPV option - uniqueness checks are disabled.');
            }

            const seen = new Set();
            const totalGames = gamesPgn.length;

            for (let g = 0; g < totalGames; g++) {
                if (this.shouldStop) break;
                let game;
                try {
                    game = replayGame(gamesPgn[g]);
                } catch (e) {
                    console.warn(`[PuzzleGen] Skipping game ${g + 1}: ${e.message}`);
                    continue;
                }
                const { headers, moves, positions } = game;
                if (moves.length <= startPly) continue;

                const gameDetails = {
                    white: headers.White || 'White Player',
                    black: headers.Black || 'Black Player',
                    event: headers.Event || 'Casual Game',
                    date: headers.Date || 'Unknown Date',
                    result: headers.Result || '*',
                    gameIndex: g + 1
                };

                await this.evaluator.newGame();
                this.send('puzzle-gen-progress', {
                    percent: Math.round((g / totalGames) * 100), gameIndex: g + 1, totalGames,
                    plyIndex: 0, totalPlies: positions.length, puzzlesFound, phase: 'scanning',
                    gameLabel: `${gameDetails.white} vs ${gameDetails.black}`
                });

                const onlyMates = enabledTypes.mate && !enabledTypes.blunder && !enabledTypes.better_move;
                const evals = new Array(positions.length).fill(null);

                // win% for the side to move at each position
                const winAt = (i) => {
                    const top = evals[i]?.lines?.[0];
                    return top && top.score ? A.winPercent(top.score) : null;
                };
                // win% lost by the move played from position i (mover's view)
                const lossAt = (i) => {
                    if (i < 0 || i >= moves.length) return null;
                    const before = evals[i];
                    const wB = winAt(i);
                    if (wB === null) return null;
                    const played = A.moveToUci(moves[i]);
                    if (before.bestMove === played) return 0;
                    const pl = before.lines.find(l => l.pv[0] === played && l.score);
                    let wA;
                    if (pl) wA = A.winPercent(pl.score);
                    else {
                        const w = winAt(i + 1);
                        if (w === null) return null;
                        wA = 100 - w;
                    }
                    return Math.max(0, wB - wA);
                };

                const blockedUntil = { w: -1, b: -1 };
                const mateStreak = { w: false, b: false };

                // Decide whether position j is a puzzle and, if so, verify & emit it.
                const processCandidate = async (j) => {
                    const ev = evals[j];
                    if (!ev || !ev.lines || ev.lines.length === 0 || !ev.lines[0].score) return;
                    const solver = positions[j].fen.split(' ')[1];
                    const top = ev.lines[0];
                    const mateIn = A.mateValue(top.score);
                    const hasMate = mateIn !== null && mateIn > 0;
                    if (!hasMate) mateStreak[solver] = false;

                    if (targetSide === 'white' && solver !== 'w') return;
                    if (targetSide === 'black' && solver !== 'b') return;
                    if (j <= blockedUntil[solver]) return;
                    if (seen.has(fenKey(positions[j].fen))) return;

                    let kind = null;
                    let defensive = false;
                    const prevMove = j >= 1 ? moves[j - 1] : null;
                    if (enabledTypes.mate && hasMate && !mateStreak[solver]) {
                        const inRange = (mateIn === 1 && mateRange.m1) || (mateIn === 2 && mateRange.m2) ||
                            (mateIn === 3 && mateRange.m3) || (mateIn > 3 && mateRange.mx);
                        if (inRange) kind = 'mate';
                    }
                    if (!kind && !hasMate) {
                        const winNow = winAt(j);
                        const oppLoss = j >= 1 ? lossAt(j - 1) : null;
                        const myLoss = lossAt(j);
                        const unique = isUnique(top, ev.lines[1], P.gap);
                        const bestUci = top.pv?.[0] || ev.bestMove || '';
                        const isRecapture = !!(prevMove && prevMove.captured && bestUci.substring(2, 4) === prevMove.to);
                        const second = ev.lines[1];
                        const gapWin = second && second.score ? winNow - A.winPercent(second.score) : 0;
                        if (enabledTypes.blunder && oppLoss !== null && oppLoss >= P.blunderLoss && winNow >= P.winStart) {
                            kind = 'blunder';
                        } else if (enabledTypes.blunder && oppLoss !== null && oppLoss >= P.blunderLoss && P.defendMin !== null &&
                            winNow >= P.defendMin + 10 && unique && !isRecapture) {
                            // The opponent's mistake can only be exploited by one precise move
                            kind = 'blunder';
                            defensive = true;
                        } else if (enabledTypes.better_move && myLoss !== null && myLoss >= P.missedLoss && unique) {
                            if (winNow >= P.winStart) kind = 'better_move';
                            else if (P.defendMin !== null && winNow >= P.defendMin) {
                                kind = 'better_move';
                                defensive = true;
                            }
                        } else if (enabledTypes.better_move && P.onlyMoveGap && unique && winNow >= P.defendMin &&
                            gapWin >= P.onlyMoveGap && positions[j].legalCount > 3 && !isRecapture) {
                            // Critical position: only one move holds (even if the game found it)
                            kind = 'better_move';
                            defensive = winNow < P.winStart;
                        }
                    }
                    if (!kind) return;

                    this.send('puzzle-gen-progress', {
                        percent: Math.round(((g + j / positions.length) / totalGames) * 100),
                        gameIndex: g + 1, totalGames, plyIndex: j + 1, totalPlies: positions.length,
                        puzzlesFound, phase: 'verifying'
                    });

                    const built = await this.buildSolution(positions[j].fen, kind, {
                        verifyTime,
                        maxPlies: kind === 'mate' ? Math.min(19, Math.max(maxPlies, mateIn * 2 - 1 + 2)) : maxPlies,
                        minStart: defensive ? P.defendMin : P.winStart,
                        keep: defensive ? P.defendMin : P.keep,
                        gap: P.gap
                    });
                    if (this.shouldStop || !built) return;

                    // Skip trivial "just recapture" one-movers
                    if (kind !== 'mate' && built.solution.length === 1 && prevMove && prevMove.captured &&
                        built.solution[0].substring(2, 4) === prevMove.to) {
                        return;
                    }

                    const puzzle = this.createPuzzle({
                        kind,
                        defensive,
                        rootFen: positions[j].fen,
                        built,
                        prevFen: j >= 1 ? positions[j - 1].fen : null,
                        prevMove,
                        gameMove: moves[j],
                        gameDetails
                    });
                    if (!puzzle) return;

                    seen.add(fenKey(positions[j].fen));
                    blockedUntil[solver] = j + built.solution.length;
                    if (kind === 'mate') mateStreak[solver] = true;
                    puzzlesFound++;
                    this.send('puzzle-gen-detected', puzzle);
                };

                // Evaluate positions one by one; as soon as position i is known, position i-1
                // has everything it needs, so puzzles appear while the game is being scanned.
                for (let i = Math.max(0, startPly - 1); i < positions.length; i++) {
                    if (this.shouldStop) break;
                    const stm = positions[i].fen.split(' ')[1];
                    const skip = onlyMates && targetSide !== 'both' && stm !== targetSide[0];

                    if (!skip) {
                        this.send('puzzle-gen-progress', {
                            percent: Math.round(((g + i / positions.length) / totalGames) * 100),
                            gameIndex: g + 1, totalGames, plyIndex: i + 1, totalPlies: positions.length,
                            puzzlesFound, phase: 'scanning'
                        });
                        const terminal = terminalEval(positions[i]);
                        evals[i] = terminal || await this.evaluator.evaluate(positions[i].fen, { movetime: scanSpeed, multiPV: 2 });
                    }
                    if (this.shouldStop) break;
                    if (i - 1 >= startPly) await processCandidate(i - 1);
                }
                if (this.shouldStop) break;
            }

            console.log(`[PuzzleGen] Scan finished. Found ${puzzlesFound} puzzles.`);
            this.send('puzzle-gen-finished', { puzzlesFound });
        } catch (error) {
            console.error('[PuzzleGen] Error during scan:', error);
            this.send('puzzle-gen-error', error.message);
        } finally {
            await this.stop();
        }
    }

    // Build (and verify) a solution line from rootFen for the side to move.
    async buildSolution(rootFen, kind, { verifyTime, maxPlies, minStart = 75, keep = 70, gap = 18 }) {
        const chess = new Chess(rootFen);
        const solver = chess.turn();
        const line = [];
        let finalWin = null;
        let firstMate = null;

        while (line.length < maxPlies && !chess.isGameOver()) {
            if (this.shouldStop) return null;
            const ev = await this.evaluator.evaluate(chess.fen(), { movetime: verifyTime, multiPV: 2 });
            if (!ev || !ev.bestMove || ev.lines.length === 0) break;
            const best = ev.lines[0];
            const second = ev.lines[1];

            if (chess.turn() === solver) {
                const mate = A.mateValue(best.score);
                if (kind === 'mate') {
                    if (!(mate !== null && mate > 0)) {
                        if (line.length === 0) return null;
                        break;
                    }
                    if (firstMate === null) firstMate = mate;
                } else {
                    const wB = A.winPercent(best.score);
                    if (line.length === 0) {
                        if (wB < minStart || !isUnique(best, second, gap)) return null;
                    } else if (!isUnique(best, second, gap) || wB < keep) {
                        break;
                    }
                    finalWin = wB;
                }
                if (!A.applyUci(chess, ev.bestMove)) break;
                line.push(ev.bestMove);
            } else {
                if (!A.applyUci(chess, ev.bestMove)) break;
                line.push(ev.bestMove);
            }
        }

        // A puzzle always ends with the solver's move
        if (line.length % 2 === 0) line.pop();
        if (line.length === 0) return null;

        // Re-play to validate and collect SAN
        const check = new Chess(rootFen);
        const san = [];
        for (const uci of line) {
            const m = A.applyUci(check, uci);
            if (!m) return null;
            san.push(m.san);
        }
        if (kind === 'mate' && !check.isCheckmate()) return null;

        return { solution: line, solutionSan: san, finalWin, mateIn: kind === 'mate' ? Math.ceil(line.length / 2) : null, endsInMate: check.isCheckmate() };
    }

    createPuzzle({ kind, defensive = false, rootFen, built, prevFen, prevMove, gameMove, gameDetails }) {
        const turn = rootFen.split(' ')[1];
        const moveNumber = parseInt(rootFen.split(' ')[5], 10) || 1;
        const themes = A.detectThemes(rootFen, built.solution, { finalWin: built.finalWin ?? undefined });
        if (defensive) {
            // Holding the position, not winning it
            const i = themes.indexOf('advantage');
            if (i >= 0) themes.splice(i, 1);
            themes.push('defensiveMove');
        }
        const difficulty = A.estimateDifficulty(themes, built.solution.length);
        const gameMoveUci = gameMove ? A.moveToUci(gameMove) : null;
        const foundInGame = gameMoveUci === built.solution[0];

        let title, description, playedBlunder = null;
        if (kind === 'mate') {
            title = `Mate in ${built.mateIn}`;
            description = `Find the forced checkmate in ${built.mateIn} move${built.mateIn > 1 ? 's' : ''}.`;
            if (!foundInGame && gameMove) {
                description += ` In the game, ${gameMove.san} was played instead.`;
                playedBlunder = gameMove.san;
            }
        } else if (kind === 'blunder' && defensive) {
            title = 'Punish the Mistake';
            playedBlunder = prevMove ? prevMove.san : null;
            description = `${playedBlunder ? playedBlunder + ' was a mistake. ' : ''}Only one move takes advantage of it — find it!`;
            if (!foundInGame && gameMove) description += ` (The game continued ${gameMove.san}.)`;
        } else if (kind === 'blunder') {
            title = 'Punish the Blunder';
            playedBlunder = prevMove ? prevMove.san : null;
            description = `${playedBlunder ? playedBlunder + ' was a blunder. ' : ''}Find the winning continuation!`;
            if (!foundInGame && gameMove) description += ` (The game continued ${gameMove.san}.)`;
        } else if (defensive) {
            title = 'Find the Only Move';
            if (foundInGame) {
                description = 'Only one move holds the position here. Find it!';
            } else {
                playedBlunder = gameMove ? gameMove.san : null;
                description = `Only one move holds the position here — ${playedBlunder || 'the game move'} lost ground. Find the defence!`;
            }
        } else {
            title = foundInGame ? 'Find the Only Move' : 'Find the Winning Move';
            if (foundInGame) {
                description = 'Only one move keeps the advantage here. Find it!';
            } else {
                playedBlunder = gameMove ? gameMove.san : null;
                description = `There was a winning tactic here, but ${playedBlunder || 'another move'} was played. Find it!`;
            }
        }

        const tags = [...new Set([kind, ...themes])];
        return {
            id: `puzzle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: kind,
            title,
            fen: rootFen,
            turn,
            solution: built.solution,
            solutionSan: built.solutionSan,
            description,
            playedBlunder,
            gameMove: gameMove ? gameMove.san : null,
            foundInGame,
            preFen: prevFen,
            setupMove: prevMove ? A.moveToUci(prevMove) : null,
            setupSan: prevMove ? prevMove.san : null,
            themes,
            tags,
            difficulty,
            gameDetails: { ...gameDetails, moveNumber },
            createdAt: Date.now(),
            version: 2
        };
    }

    splitPgnGames(pgnText) {
        const games = [];
        const lines = pgnText.split(/\r?\n/);
        let current = [];
        let sawMoves = false;
        for (const line of lines) {
            const t = line.trim();
            const isHeader = t.startsWith('[');
            if (isHeader && sawMoves && current.length > 0) {
                games.push(current.join('\n'));
                current = [];
                sawMoves = false;
            }
            if (!isHeader && t.length > 0) sawMoves = true;
            current.push(line);
        }
        if (current.length > 0) games.push(current.join('\n'));
        return games.filter(g => g.trim().length > 0);
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

module.exports = { PuzzleGenerator, isUnique };
