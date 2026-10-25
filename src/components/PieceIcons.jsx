import React from 'react';

const SvgWrapper = ({ children, className, ...props }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" className={className} {...props}>
        {children}
    </svg>
);

// Stroke width 1.5 is standard, we can make it thicker (2) for cartoon look
const STROKE_WIDTH = 2;

export const PieceIcon = ({ type, color, className }) => {
    // Determine fill color based on piece color ('w' or 'b')
    // White = #ffffff, Black = #ef4444 (Red)
    const fillColor = color === 'w' ? '#ffffff' : '#ef4444';
    const strokeColor = '#000000';

    const commonProps = {
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: STROKE_WIDTH,
        strokeLinecap: "round",
        strokeLinejoin: "round"
    };

    switch (type) {
        case 'p': // Pawn
            return (
                <SvgWrapper className={className}>
                    <path {...commonProps} d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
                </SvgWrapper>
            );
        case 'n': // Knight
            return (
                <SvgWrapper className={className}>
                    <g {...commonProps} fill="none">
                        {/* We need to apply fill to the paths that were white */}
                        <path fill={fillColor} d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
                        <path fill={fillColor} d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
                        {/* Eye and nostrils usually black */}
                        <path fill={strokeColor} stroke="none" d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0zm5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5z" />
                    </g>
                </SvgWrapper>
            );
        case 'b': // Bishop
            return (
                <SvgWrapper className={className}>
                    <g {...commonProps}>
                        <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z" />
                        <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
                        <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" />
                        {/* Internal detail lines */}
                        <path fill="none" d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" />
                    </g>
                </SvgWrapper>
            );
        case 'r': // Rook
            return (
                <SvgWrapper className={className}>
                    <g {...commonProps}>
                        <path strokeLinecap="butt" d="M9 39h27v-3H9v3zm3-3v-4h21v4H12zm-1-22V9h4v2h5V9h5v2h5V9h4v5" />
                        <path d="m34 14-3 3H14l-3-3" />
                        <path strokeLinecap="butt" strokeLinejoin="miter" d="M31 17v12.5H14V17" />
                        <path d="m31 29.5 1.5 2.5h-20l1.5-2.5" />
                        <path fill="none" strokeLinejoin="miter" d="M11 14h23" />
                    </g>
                </SvgWrapper>
            );
        case 'q': // Queen
            return (
                <SvgWrapper className={className}>
                    <g {...commonProps}>
                        <path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zm16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0z" />
                        <path strokeLinecap="butt" d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14l2 12z" />
                        <path strokeLinecap="butt" d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
                        <path fill="none" d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" />
                    </g>
                </SvgWrapper>
            );
        case 'k': // King
            return (
                <SvgWrapper className={className}>
                    <g {...commonProps} fill="none">
                        <path strokeLinejoin="miter" d="M22.5 11.63V6M20 8h5" />
                        <path fill={fillColor} strokeLinecap="butt" strokeLinejoin="miter" d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
                        <path fill={fillColor} d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" />
                        <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" />
                    </g>
                </SvgWrapper>
            );
        default:
            return null;
    }
}
