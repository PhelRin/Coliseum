// Fetch a player's recent games from Chess.com or Lichess as PGN.
// Both sites have free public APIs that need no login. Only standard chess is kept
// (no Chess960, bughouse or other variants), newest games first.

const USER_AGENT = 'Coliseum chess GUI (https://github.com/PhelRin/Coliseum)';

// Inside Electron use its network stack (it follows the system proxy settings, like a
// browser); plain Node (tests) falls back to the built-in fetch.
function getFetch() {
    try {
        const { net } = require('electron');
        if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
    } catch (e) { /* not running in Electron */ }
    return fetch;
}

class OnlineGamesError extends Error {}

function cleanUsername(name) {
    const u = String(name || '').trim();
    if (!/^[A-Za-z0-9_-]{2,50}$/.test(u)) throw new OnlineGamesError('Enter a valid username (letters, numbers, - and _ only).');
    return u;
}

async function getJson(url) {
    const res = await getFetch()(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.status === 404) return { notFound: true };
    if (res.status === 429) throw new OnlineGamesError('The site is rate-limiting requests. Wait a minute and try again.');
    if (!res.ok) throw new OnlineGamesError(`The site answered with an error (${res.status}). Try again later.`);
    return { data: await res.json() };
}

async function fetchChessCom(username, max) {
    const u = cleanUsername(username).toLowerCase();
    const arch = await getJson(`https://api.chess.com/pub/player/${u}/games/archives`);
    if (arch.notFound) throw new OnlineGamesError(`No Chess.com player called "${username}".`);
    const months = (arch.data.archives || []).slice().reverse(); // newest month first
    const games = [];
    for (const monthUrl of months) {
        if (games.length >= max) break;
        const month = await getJson(monthUrl);
        if (month.notFound) continue;
        const list = (month.data.games || []).filter((g) => g.rules === 'chess' && g.pgn);
        list.sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
        for (const g of list) {
            if (games.length >= max) break;
            games.push({
                pgn: g.pgn.trim(),
                white: g.white?.username || '',
                black: g.black?.username || '',
                timeClass: g.time_class || '',
                endTime: g.end_time ? g.end_time * 1000 : null,
            });
        }
    }
    return { games, username: u };
}

// Lichess streams many games as one PGN text; split it on [Event tags.
function splitPgn(text) {
    return String(text || '')
        .split(/\r?\n\r?\n(?=\[Event )/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function header(pgn, tag) {
    const m = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
    return m ? m[1] : '';
}

async function fetchLichess(username, max) {
    const u = cleanUsername(username);
    // perfType lists only the standard-chess speeds, so variants are left out
    const params = new URLSearchParams({
        max: String(max),
        perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
        moves: 'true', tags: 'true', clocks: 'false', evals: 'false', opening: 'false',
    });
    const res = await getFetch()(`https://lichess.org/api/games/user/${encodeURIComponent(u)}?${params}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/x-chess-pgn' },
    });
    if (res.status === 404) throw new OnlineGamesError(`No Lichess player called "${username}".`);
    if (res.status === 429) throw new OnlineGamesError('Lichess is rate-limiting requests. Wait a minute and try again.');
    if (!res.ok) throw new OnlineGamesError(`Lichess answered with an error (${res.status}). Try again later.`);
    const pgns = splitPgn(await res.text()).filter((p) => !header(p, 'Variant') || header(p, 'Variant') === 'Standard');
    const games = pgns.slice(0, max).map((pgn) => {
        const date = header(pgn, 'UTCDate').replace(/\./g, '-');
        const time = header(pgn, 'UTCTime');
        const t = date ? Date.parse(`${date}T${time || '00:00:00'}Z`) : NaN;
        return { pgn, white: header(pgn, 'White'), black: header(pgn, 'Black'), timeClass: header(pgn, 'Event'), endTime: Number.isFinite(t) ? t : null };
    });
    return { games, username: u };
}

/**
 * platform: 'chesscom' | 'lichess'
 * Returns { pgn, count, asWhite, asBlack, newest, oldest, username, platform }
 */
async function fetchOnlineGames({ platform, username, max = 100 }) {
    const limit = Math.max(1, Math.min(200, parseInt(max, 10) || 100));
    let result;
    try {
        if (platform === 'chesscom') result = await fetchChessCom(username, limit);
        else if (platform === 'lichess') result = await fetchLichess(username, limit);
        else throw new OnlineGamesError('Unknown site.');
    } catch (e) {
        if (e instanceof OnlineGamesError) throw e;
        throw new OnlineGamesError('Could not reach the site. Check your internet connection and try again.');
    }
    const { games } = result;
    if (games.length === 0) throw new OnlineGamesError(`"${username}" has no standard games to import.`);
    const me = result.username.toLowerCase();
    const asWhite = games.filter((g) => g.white.toLowerCase() === me).length;
    const asBlack = games.filter((g) => g.black.toLowerCase() === me).length;
    const times = games.map((g) => g.endTime).filter(Boolean);
    return {
        pgn: games.map((g) => g.pgn).join('\n\n'),
        count: games.length,
        asWhite,
        asBlack,
        newest: times.length ? Math.max(...times) : null,
        oldest: times.length ? Math.min(...times) : null,
        username: result.username,
        platform,
    };
}

module.exports = { fetchOnlineGames, splitPgn, OnlineGamesError };
