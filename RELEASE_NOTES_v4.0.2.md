## Coliseum v4.0.2

### Fixed
- **Engines that take a while to load no longer fail with "Engine startup timeout".** Some engines load a large network before they answer, which can take more than 10 seconds on some PCs. Coliseum now gives an engine 30 seconds to start, and its first check of which protocol an engine speaks waits up to 20 seconds for an engine that is still loading.
- **Clearer start-up errors.** When an engine doesn't start, the message now names it, says what it didn't answer and quotes the last thing it printed. For example: *"Engine startup timeout: Absurd-1.0.exe did not answer "uci" within 30 s (it printed nothing)"*. Before, it only said "Engine startup timeout (uciok/readyok)" without saying which engine.
- **The right engine gets moved.** If one engine was slow, 4.0.1 could also run its opponent from its own folder ("did not start as a copy") even though that opponent had started fine. Only an engine that didn't answer is affected now.
