## Coliseum v4.0.3

### Fixed
- **Engines no longer crash or hang at start-up after their settings were saved** (Houdini 6, Deep Shredder 13, S13-NNUE and others). Saving an engine's settings stored every option the engine has, and all of them were sent to it each time it started. On Windows, options whose default Coliseum could not read were sent with no real value: a number as "null" or "NaN", a file name as "undefined", and on/off options as "off". Stockfish ignores that. Houdini crashed on it (`std::invalid_argument: stoi`), S13-NNUE looked for a network called "undefined", and Shredder stopped answering.
- **Only the settings you change are sent to an engine.** An engine you never configured is started exactly as it is by hand, with no settings sent at all. A setting that is the engine's own default, has no value, or isn't valid for its type is never sent, and neither are buttons such as "Clear Hash".
- **The settings window shows the engine's real defaults on Windows.** On/off options that are on by default (an engine's own book, for example) were shown as off, and saved that way.
- **An engine that crashes while starting is reported at once**, with what it printed, instead of after 30 seconds. If it had been sent saved settings, the message lists them.

### New
- **"Reset to defaults" in an engine's settings window**, and a "changed" mark next to each setting that differs from the engine's default.

### Settings saved with earlier versions
They are cleaned up the first time 4.0.3 starts. Your own choices (Hash, Threads, paths, anything you switched on) are kept. On Windows, on/off settings that were saved as "off" go back to the engine's own default, because earlier versions saved them as off without being asked and there is no way to tell those from ones you switched off yourself. If you turned something off on purpose, such as an engine's own opening book, open its settings and switch it off again. The old file is kept as `engine_options.before-4.0.3.json` in Coliseum's data folder.
