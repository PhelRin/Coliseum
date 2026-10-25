import React from 'react';

export function EvalBar({ score: infoObj, color, turn = 'w', orientation = 'white' }) {
    let finalTurn = turn;
    let finalOrientation = orientation;

    // Support legacy path (like in Arena.jsx which hardcodes color="white")
    if (color) {
        finalOrientation = color;
        finalTurn = 'w';
    }

    // Current Eval from White's perspective
    let score = 0;
    let isMate = false;
    let mateVal = 0;

    if (infoObj) {
        const val = parseInt(infoObj.value) || 0;
        const normalizedVal = finalTurn === 'w' ? val : -val;

        if (infoObj.unit === 'mate') {
            isMate = true;
            mateVal = normalizedVal;
            score = normalizedVal > 0 ? 1000 : -1000;
        } else {
            score = normalizedVal;
        }
    }

    // Clamp
    const clamped = Math.max(-500, Math.min(500, score));
    
    // Adjust fill percentage based on board orientation:
    // If orientation is white: White is at the bottom, so positive score (White better) increases height.
    // If orientation is black: Black is at the bottom, so negative score (Black better) increases height.
    // If color is passed, it represents a player-specific eval bar from their own perspective, so positive is always better.
    const displayScore = color ? clamped : (finalOrientation === 'white' ? clamped : -clamped);
    const percent = 50 + (displayScore / 10); // 0 = 50%.

    // Dynamically flip background colors
    // White at bottom: bar is White (zinc), top is Red.
    // Black at bottom: bar is Red, top is White (zinc).
    const containerBg = finalOrientation === 'white' ? 'bg-red-500' : 'bg-zinc-200';
    const barColor = finalOrientation === 'white' ? 'bg-zinc-200' : 'bg-red-500';

    // Label styling & placement (contrast)
    const isLabelAtBottom = percent > 50;
    let textColorClass = '';
    if (isLabelAtBottom) {
        // Bottom is filled with barColor
        textColorClass = finalOrientation === 'white' ? 'text-black' : 'text-white';
    } else {
        // Top is filled with containerBg
        textColorClass = finalOrientation === 'white' ? 'text-white' : 'text-black';
    }

    // Display string
    let displayString = '0.0';
    if (infoObj) {
        if (isMate) {
            displayString = `M${Math.abs(mateVal)}`;
        } else {
            // Absolute score (relative to White)
            displayString = score > 0 ? `+${(score / 100).toFixed(1)}` : (score / 100).toFixed(1);
        }
    }

    return (
        <div className={`h-full max-h-full w-5 ${containerBg} rounded-full overflow-hidden border border-white/5 relative shadow-inner shrink-0`}>
            {/* The Bar */}
            <div
                className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ease-out ${barColor}`}
                style={{ height: `${percent}%` }}
            />

            {/* Markers */}
            <div className="absolute inset-0 border-t border-b border-black/20 pointer-events-none" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20 z-10" />

            {/* Label */}
            <div className={`absolute left-0 right-0 text-[8px] font-bold text-center z-20 ${isLabelAtBottom ? 'bottom-2' : 'top-2'} ${textColorClass}`}>
                {displayString}
            </div>
        </div>
    );
}
