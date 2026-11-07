# Stream Deck Plugins

A monorepo of custom [Elgato Stream Deck](https://www.elgato.com/stream-deck) plugins, built with the Stream Deck SDK (Node.js / TypeScript).

| Plugin | Description |
|---|---|
| [Discord Voice Deck](plugins/discord-voice) | Browse favorite servers, join voice channels, and control everyone in the call (local mute, per-user volume, speaking glow) via the local Discord app. |

## Layout

```
plugins/
  <plugin-name>/                 one npm workspace per plugin
    <uuid>.sdPlugin/             what Stream Deck loads (manifest, imgs, ui, profiles; bin/ is built)
    src/  scripts/  test/
    package.json                 build / test / link / pack scripts
```

## Getting started

Requires Node.js 24+ and Stream Deck 7.1+.

```bash
npm install          # installs every plugin's dependencies (npm workspaces)
npm run build        # builds all plugins
npm test             # tests all plugins
```

Work on one plugin:

```bash
npm run build -w plugins/discord-voice
npm run link -w plugins/discord-voice      # symlink into Stream Deck (once)
```

## Adding a plugin

1. Create `plugins/<name>/` with its own `package.json` (name it `@streamdeck-plugins/<name>`), `src/`, and `<uuid>.sdPlugin/`.
2. Give it `build`, `test`, `typecheck` and `validate` scripts so the root scripts and CI pick it up.
3. Add a row to the table above.
