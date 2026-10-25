## Coliseum v3.6.0

A big update to tournaments, ratings and the layout.

### New: Gauntlet tournaments
One main engine plays every opponent as many times as you choose. It's ideal for testing a new version of your engine against a field. You get its score, its Elo difference against each opponent with an error margin, and a performance rating.

### Fairer tournaments
- **Matches:** every match is now two games from the same opening, one with each engine as White, so no engine gets the luckier colour or opening.
- **Openings:** start games from a built-in set of 50 balanced openings, your own Polyglot opening book, or the normal starting position.
- **New format:** Round Robin is now available.
- **Swiss:** the rounds setting now works, and ties are split by Buchholz, then Sonneborn-Berger.
- **Knockouts:** a drawn match no longer goes to White. A level match gets up to two more 2-game tiebreaks, then sudden-death games.

### Several games at once
Run more than one game at the same time. Coliseum suggests a safe number for your CPU, and you can watch every game live and click any one to follow it on the big board.

### Elo Estimation, redesigned
- **Ratings:** each engine's rating comes from every game it has played, with a ± range that narrows as more games come in.
- **Easier to read:** a leaderboard with confidence labels and a chart of how ratings changed over the session.
- **Rating anchor:** optionally fix one engine's rating, and the others are measured against it.
- **Stopping:** games cut short are no longer counted as draws.

### Fixes and improvements
- **Engine names:** the real names reported by the engines now show on every board.
- **PGN export:** files now have full headers (event, round, players, ratings, time control, how the game ended).
- **Time losses:** engines are no longer flagged for being a few milliseconds over.
- **Crashes:** a crashed engine now loses the game instead of freezing the tournament.
- **Resuming:** leaving the Tournament tab mid-game no longer loses the live boards, and stopped tournaments can be resumed from the lobby.

### New layout
The whole app has been reworked so it no longer gets squished on smaller windows. The sidebar collapses on narrow screens, and the boards in Quick Match, Game Analysis and Board Editor resize to fit.

### Before you update
- An unfinished tournament saved by v3.5 can't be resumed in v3.6. You'll be offered the option to discard it.
- Engine ratings are recalculated from game history, so they may shift a little the first time you open v3.6.
