# Chess Checker

Mobile-first Chess.com screenshot to FEN tool using the open-source `@scoriiu/fenshot` recogniser.

The GitHub Actions workflow builds the app and copies the Fenshot ONNX model and ONNX Runtime assets from the installed npm packages, so binary assets do not need to be committed manually.

## Deploy

In repository **Settings > Pages**, set **Source** to **GitHub Actions**. Pushes to `main` then deploy automatically.

Expected URL: https://thewibblerr.github.io/chesschecker/

## Intended use

Post-game analysis, puzzles, study positions and bot games where engine assistance is permitted.