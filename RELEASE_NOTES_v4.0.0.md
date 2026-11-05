## Coliseum v4.0.0

Coliseum can now tell you how aggressively your engines win. Version 4 builds in the **Engine Aggressiveness Statistics (EAS) Tool V6.0 by Stefan Pohl** ([www.sp-cc.de](https://www.sp-cc.de)), included with his permission.

### New: the Aggressiveness tab
- **The EAS score:** wins with sacrifices count for more (bigger and earlier sacrifices most of all), and so do short wins and few "bad draws". It's worked out from each engine's own wins, so a weaker engine can still score high.
- **Any games:** score the last tournament, any PGN file or your Quick Match archive.
- **Two ways to score:** **Main engine only** (the tool's gauntlet version, for testing one engine against a field) or **Every engine**.
- **Clear results:** each engine's score split into sacrifices, early sacrifices, short wins and bad draws, with sacrifices broken down by size (queen, 5+ pawns, down to 1 pawn). A warning shows when there are too few games for a reliable score.
- **Interesting wins:** the games the tool picks out open straight in Game Review, or save them as a PGN.
- **Reports are kept:** every run is saved, so you can compare engines and versions later. The tool's full report is always there next to Coliseum's summary.

### New: EAS after a tournament
A finished or stopped tournament has a **Run EAS** button on its results page. The scores appear right there, with a link to the full report.

### Good to know
- **Windows only:** the EAS tool is a set of Windows scripts. On Linux, the Aggressiveness tab explains that it needs Windows; everything else works as before.
- **Same conditions:** scores depend on the time control, openings, opponents and whether games are played to mate, so compare engines run under the same conditions.
- **Unusual names:** engine names with characters that break batch scripts (like `&`, `(` or `%`) are handled for you.

### Credits
EAS Tool V6.0 by Stefan Pohl (www.sp-cc.de). It uses pgn-extract by David J. Barnes and PGN tools by Norman Pollock. The tool is included unchanged; Coliseum runs it exactly as you would and reads its report.
