# GATE RUSH

A game of [THE WALL ARCADE](https://6972mvu4.srstudio.dev/), the arcade played on the names of a real wall in Lisbon
(ON THE WALL by NFC Summit). By osaykancuno (K4NCUN0 on the wall).

The people of the wall rush the gate of NFC Summit 2027 down three lanes. **Tap a lane to slam its turnstile shut for
one second.** Who is who is drawn, not written:

| Who | Sign | What to do |
| --- | --- | --- |
| Guest | blue wristband | let them in |
| VIP | gold crown | let them in, never stop them |
| Gatecrasher | sunglasses | slam the gate: caught |
| Runner (wave 3+) | sunglasses, speed lines | slam earlier |
| Lane jumper (wave 4+) | sunglasses, arrow | slam the lane they land in |
| Fake band (wave 5+) | red wristband | slam the gate |

- 3 s countdown, then 90 s. The rush speeds up evenly from the first second to the last: walking speed ×2.3 and twice
  as many arrivals by the end (SPEED under the timer).
- Guest in +50, VIP +150, crasher caught +100, × a multiplier (one step every 10 in a row, ×5 at most). A guest stopped
  at a shut turnstile waits (+10 when they get in) and storms off after 2 s.
- Three hearts: lost when a crasher gets in, a VIP is stopped or a guest storms off. Hold the gate 90 s: +1000 and +500
  per heart left.
- The end card gives you a gatekeeper title and shows who got in; POST ON X tags them.

Players sign in with SuperRare Connect and spend 1 credit per run; the score is computed by SuperRare's server from the
game's own rules (`src/games/gate-rush/core.ts`, the very module the verifier runs). Practice is free, local and
unrecorded.

> A Remix The Wall experiment · NFC Summit 2027 · Lisbon — https://onthewall.nfcsummit.com

## Publish (Windows)

Double-click `PUBBLICA.cmd`. The first time it installs what is missing, logs in to SuperRare Studio, creates the app
once (`deploy/gate-rush.config.json`), then builds and publishes; every later run updates the same app. Details in
[docs/gate-rush.md](docs/gate-rush.md) (Italian).

Elsewhere (Node.js 22+, `npm install --global @rareprotocol/rare-profile@0.1.0`, `rare-profile login`):

```sh
npm ci
npx tsx --test tests/gate-rush.test.ts
npm run build -- --config deploy/gate-rush.config.json --output dist/gate-rush.zip --force
rare-profile app update <app-id> --zip dist/gate-rush.zip --max-attempts 10000 --json
```

## Where things are

| Part | Files |
| --- | --- |
| Rules (deterministic engine, shared by the page and the verifier) | `src/games/gate-rush/core.ts` |
| Page schemas (the verifier's own checks) | `src/games/gate-rush/engine.ts` |
| Client: lanes, turnstiles, dance floor, end card | `src/games/gate-rush/client.ts` |
| Server verifier (`POST /v1`, no schema library) | `src/verifiers/gate-rush.ts` |
| Tests: rules, latency, forged inputs, tampered states, the built verifier | `tests/gate-rush.test.ts` |
| Publishing | `PUBBLICA.cmd`, `PUBBLICA.ps1`, `scripts/gate-rush-config.ts` |

The rest (sign-in, credits, paid start, weekly leaderboard, Practice, the people of the wall's sprites) is
[THE WALL ARCADE's code](https://github.com/hs7j4yk4sz-boop/wall-arcade-connect), itself built on SuperRare's
[studio-games-example](https://github.com/superrare/studio-games-example): see `LICENSE` and `NOTICE` (MIT). The
arcade's other games (UNBREAKABLE, FULL ROW, TAP THE NAME) stay in `src/` because the shared page and its tests use
them; this repository builds and publishes GATE RUSH only.

Perfectly legal automated inputs are accepted by these rules: the game is not bot-proof.
