import { useEffect, useRef, useState } from 'react';

// Size of an element, kept up to date with a ResizeObserver
export function useElementSize() {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        if (!ref.current) return;
        const el = ref.current;
        const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, size];
}

// Current time, refreshed every `ms` (for running clocks)
export function useNow(ms = 250) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

const turnOf = (fen) => (fen && fen.split(' ')[1] === 'b' ? 'b' : 'w');

/**
 * Every game running on `channel` ('tournament-game' or 'elo-game'), by slot.
 * Events arrive very often (engine output from several games), so they are collected in a ref
 * and committed to React state a few times per second.
 */
export function useLiveGames(channel) {
    const games = useRef({});
    const dirty = useRef(false);
    const [snapshot, setSnapshot] = useState({});

    useEffect(() => {
        if (!window.electronAPI || !window.electronAPI.on) return undefined;
        const unsub = window.electronAPI.on(channel, (ev) => {
            if (!ev || ev.slot === undefined) return;
            const g = games.current[ev.slot] || { slot: ev.slot, info: { w: {}, b: {} }, fen: null, status: 'starting' };
            switch (ev.kind) {
                case 'assigned':
                    games.current[ev.slot] = {
                        slot: ev.slot,
                        gameId: ev.gameId,
                        matchId: ev.matchId,
                        round: ev.round,
                        white: ev.white,
                        black: ev.black,
                        info: { w: {}, b: {} },
                        fen: null,
                        status: 'starting',
                        moves: 0,
                    };
                    break;
                case 'match-started':
                    Object.assign(g, {
                        white: { ...(g.white || {}), ...ev.white },
                        black: { ...(g.black || {}), ...ev.black },
                        fen: ev.fen,
                        clocks: ev.clocks,
                        clockAt: Date.now(),
                        status: 'playing',
                        round: ev.round || g.round,
                        result: null,
                        moves: 0,
                        lastMove: null,
                    });
                    games.current[ev.slot] = g;
                    break;
                case 'board-update':
                    Object.assign(g, { fen: ev.fen, lastMove: ev.lastMove, san: ev.san, clocks: ev.clocks, clockAt: Date.now(), moves: (g.moves || 0) + 1 });
                    // joined mid-game (the screen was opened after the game started)
                    if (g.status === 'starting') g.status = 'playing';
                    // the side that just moved stops "thinking"
                    g.info = { ...g.info, [turnOf(ev.fen)]: {} };
                    games.current[ev.slot] = g;
                    break;
                case 'engine-info':
                    if (ev.info && (ev.info.score || ev.info.depth)) {
                        g.info = { ...g.info, [ev.color]: { ...(g.info[ev.color] || {}), ...ev.info } };
                        games.current[ev.slot] = g;
                    }
                    break;
                case 'match-ended':
                    Object.assign(g, { status: 'ended', result: { winner: ev.winner, reason: ev.reason } });
                    games.current[ev.slot] = g;
                    break;
                case 'match-error':
                    Object.assign(g, { status: 'ended', result: { winner: 'error', reason: ev.message || String(ev) } });
                    games.current[ev.slot] = g;
                    break;
                default:
                    return;
            }
            dirty.current = true;
        });
        const id = setInterval(() => {
            if (!dirty.current) return;
            dirty.current = false;
            setSnapshot({ ...games.current });
        }, 200);
        return () => {
            clearInterval(id);
            if (unsub) unsub();
        };
    }, [channel]);

    return snapshot;
}

// Remaining time on a clock that keeps running between updates
export function liveClock(game, color, now) {
    if (!game || !game.clocks) return null;
    const base = game.clocks[color];
    if (base === undefined || base === null) return null;
    if (base === -1) return -1;
    if (game.status !== 'playing') return base;
    const running = turnOf(game.fen) === color;
    return Math.max(0, running ? base - (now - (game.clockAt || now)) : base);
}

export function formatClock(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms === -1) return '∞';
    const total = Math.max(0, ms);
    if (total < 10000) return (total / 1000).toFixed(1);
    const sec = Math.ceil(total / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Engine score from White's point of view, as text
export function formatScore(info, color) {
    if (!info || !info.score) return null;
    const v = parseInt(info.score.value, 10) || 0;
    const white = color === 'w' ? v : -v;
    if (info.score.unit === 'mate') return `${white > 0 ? '' : '-'}M${Math.abs(white)}`;
    const x = white / 100;
    return `${x > 0 ? '+' : ''}${x.toFixed(2)}`;
}

export const engineLabel = (p) => (p && p.name ? p.name : p && p.path ? String(p.path).split(/[\\/]/).pop().replace(/\.exe$/i, '') : '—');
