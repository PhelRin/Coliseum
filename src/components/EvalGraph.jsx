import React, { useMemo, useRef, useState } from 'react';
import { getClassification } from '../utils/classifications';

// Win-probability graph for a reviewed game. Click to jump to a move.
// series: [{ ply, win, cp, mate }] where win is White's win% (0..100) for position `ply`.
// classifications: review classifications (ply = index of the move that led to position ply+1)
export function EvalGraph({ series, classifications = [], currentPly = -1, onSelectPly, height = 90 }) {
    const ref = useRef(null);
    const [hover, setHover] = useState(null);
    const W = 300;
    const H = 100;

    const n = series?.length || 0;
    const x = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
    const y = (win) => H - (Math.max(0, Math.min(100, win)) / 100) * H;

    const { areaPath, linePath } = useMemo(() => {
        if (!n) return { areaPath: '', linePath: '' };
        let line = '';
        series.forEach((p, i) => {
            line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.win).toFixed(2)} `;
        });
        const area = `${line} L${x(n - 1).toFixed(2)},${H} L0,${H} Z`;
        return { areaPath: area, linePath: line };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [series]);

    if (!n) return null;

    const markers = classifications.filter(c => ['brilliant', 'great', 'blunder', 'mistake', 'miss'].includes(c.classification));

    const plyFromEvent = (e) => {
        const rect = ref.current.getBoundingClientRect();
        const rel = (e.clientX - rect.left) / rect.width;
        const pos = Math.round(rel * (n - 1));
        return Math.max(0, Math.min(n - 1, pos));
    };

    const hoverPoint = hover !== null ? series[hover] : null;
    const fmt = (p) => {
        if (!p) return '';
        if (p.mate !== null && p.mate !== undefined) {
            if (p.mate === 0) return p.win >= 50 ? '1-0' : '0-1';
            return `${p.mate > 0 ? '' : '-'}M${Math.abs(p.mate)}`;
        }
        const v = (p.cp || 0) / 100;
        return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
    };

    // Position index shown on board = moveIndex + 1
    const currentPos = currentPly + 1;

    return (
        <div className="relative select-none">
            <svg
                ref={ref}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="w-full rounded-lg cursor-crosshair bg-zinc-800 border border-white/5"
                style={{ height }}
                onMouseMove={(e) => setHover(plyFromEvent(e))}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => onSelectPly && onSelectPly(plyFromEvent(e) - 1)}
            >
                <path d={areaPath} fill="#e4e4e7" />
                <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(120,120,120,0.6)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                <path d={linePath} fill="none" stroke="#a1a1aa" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {markers.map(c => {
                    const meta = getClassification(c.classification);
                    const px = x(c.ply + 1);
                    const py = y(series[c.ply + 1]?.win ?? 50);
                    const color = c.classification === 'blunder' ? '#dc2626' : c.classification === 'mistake' ? '#f97316' : c.classification === 'miss' ? '#f43f5e' : c.classification === 'great' ? '#0ea5e9' : '#14b8a6';
                    return <circle key={c.ply} cx={px} cy={py} r="2.2" fill={color} stroke="#18181b" strokeWidth="0.6" vectorEffect="non-scaling-stroke"><title>{meta?.label}</title></circle>;
                })}
                {currentPos >= 0 && currentPos < n && (
                    <line x1={x(currentPos)} y1="0" x2={x(currentPos)} y2={H} stroke="rgb(74,222,128)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                )}
                {hover !== null && (
                    <line x1={x(hover)} y1="0" x2={x(hover)} y2={H} stroke="rgba(255,255,255,0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                )}
            </svg>
            {hoverPoint && (
                <div className="absolute -top-6 left-0 right-0 flex justify-center pointer-events-none">
                    <span className="text-[10px] font-mono bg-black/80 border border-white/10 rounded px-1.5 py-0.5 text-white">
                        {hover === 0 ? 'Start' : `${Math.ceil(hover / 2)}${hover % 2 === 1 ? '.' : '...'}`} {fmt(hoverPoint)}
                    </span>
                </div>
            )}
        </div>
    );
}
