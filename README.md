# Discord Voice Deck

A Stream Deck plugin that drives your **local Discord app** over its IPC/RPC pipe (hand-written client, no Discord libraries):

1. **Servers** – your favorite servers with their icons and a live "people in voice" badge.
2. **Voice channels** – occupied channels first, occupants' avatars clustered on the key, glowing while they talk.
3. **Join** – tap a channel to join; the deck switches to the call.
4. **Call** – one key per participant (avatar, speaking glow, mute/deafen badges, local volume). Long-press = mute for me.
5. **Person** – mute for me, volume −/+, volume meter, reset to 100%. Stream Deck + dials adjust the person above them.

The top row is always controls: Back (long-press = exit), paging, self mute, deafen, leave, exit — fitted to however many columns the device has. Layouts adapt to Stream Deck, Mini, XL, Plus and Neo.

## Setup

1. Create a Discord app at <https://discord.com/developers/applications> → **OAuth2**: copy the Client ID, reset/copy the Client Secret, add redirect `http://localhost`.
2. Add the **Discord Voice** action to any key, open its settings, paste the ID/secret, pick favorite servers.
3. Press the key; approve the **Authorize** popup in Discord the first time.

## Development

```bash
npm install
npm run build        # bundles to com.evanw.discordvoice.sdPlugin/bin (+ copies wasm/fonts, seeds .env creds)
npm test             # unit tests (IPC framing, layout, navigator flows)
npm run spike        # go/no-go check of every Discord RPC call against the running client
npx tsx scripts/preview.ts   # renders every key design to preview.png
node scripts/gen-profiles.mjs   # regenerates the bundled dynamic profiles
npx tsx scripts/gen-icons.ts    # regenerates manifest icons
npx streamdeck link com.evanw.discordvoice.sdPlugin
```

`.env` (gitignored) holds `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`; when present the build seeds them as dev credentials.

Dev deep links (only active with dev credentials), via `scripts/deck.ps1`:

| Command | Effect |
|---|---|
| `deck.ps1 restart` | kill the plugin process (Stream Deck respawns it) |
| `deck.ps1 open` | switch every device to the Discord deck (also works in prod) |
| `deck.ps1 snapshot` | write `logs/deck-0.png` of what each key shows |
| `deck.ps1 press <col> <row> [long]` | simulate a key press, then snapshot |
| `deck.ps1 favorites <id,id>` | set favorite servers |

### Layout

```
src/discord/   ipc.ts (pipe framing), rpc.ts (commands/events), auth.ts (OAuth + refresh)
src/state/     store.ts – single source of truth the UI renders from
src/app.ts     DiscordController – connection lifecycle, subscriptions, polling, actions
src/render/    SVG key art (keys.ts, icons.ts) → PNG via resvg-wasm (raster.ts), image cache
src/ui/        layout.ts (device-agnostic grid), screens.ts, navigator.ts (per-device stack/render/input)
src/plugin.ts  Stream Deck actions: launcher, slot, dial; settings bridge; deep links
```
