// GATE RUSH: the rules (core.ts), the page's schemas (engine.ts) and the BUILT verifier, as Studio receives it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { packageGame } from '../scripts/package-game.js';
import { scoringConfiguration, type Configuration } from '../src/shell/config.js';
import { WALL_PANELS } from '../src/generated/wall.js';
import {
  KINDS, LANES, LINE, RULES, checkState, createEngine, inputSchema, isCrasher, parseInput, stateSchema,
  type GrState, type Kind, type Person,
} from '../src/games/gate-rush/engine.js';
import { mulberry32 } from '../src/common/det.js';
import { Coordinator, loadBuiltVerifier } from './helpers/coordinator.js';

const CONFIG = scoringConfiguration('gate-rush');
const engine = createEngine(WALL_PANELS);
const OPEN = RULES.countdownTicks;
const started = (seed: number): GrState => engine.applyInput(engine.createRun(seed, CONFIG), { action: 'start' }, 0);
/** A run at the opening of the gates with exactly these people on the lanes and no more arrivals. */
function scene(people: Partial<Person>[], seed = 1): GrState {
  const s = engine.advance(started(seed), OPEN);
  return { ...s, play: { ...s.play, nextSpawn: 1_000_000, nextId: 100, people: people.map((p, i) => ({
    id: i + 1, panel: 1, kind: 'guest' as Kind, lane: 0, y: 0, v: 100, sw: -1, wait: -1, bumped: false, ...p })) } };
}
const slam = (s: GrState, lane: number, tick = s.tick): GrState => engine.applyInput(s, { action: 'slam', lane }, tick);
const whats = (s: GrState): string[] => s.play.events.map((e) => e.what);

test('the scoring config: 3 s of countdown + 90 s of rush, with room to start', () => {
  assert.deepEqual(CONFIG, { game: 'gate-rush', maxTicks: 2160, roundTicks: 1860 });
  assert.equal(CONFIG.roundTicks, RULES.countdownTicks + RULES.playTicks);
  assert.equal(RULES.playTicks / RULES.waveTicks, RULES.weights.length);
  for (const w of RULES.weights) assert.equal(w.reduce((a, b) => a + b, 0), 100);
  assert.ok(RULES.speedEnd > 2 * RULES.speedStart && RULES.intervalEnd < RULES.intervalStart);
});

test('createRun validates its seed and config; same seed and inputs, same rush', () => {
  assert.throws(() => engine.createRun(-1, CONFIG)); assert.throws(() => engine.createRun(2 ** 32, CONFIG)); assert.throws(() => engine.createRun('1', CONFIG));
  assert.throws(() => engine.createRun(1, { ...CONFIG, game: 'full-row' })); assert.throws(() => engine.createRun(1, { ...CONFIG, maxTicks: 5 }));
  assert.throws(() => engine.createRun(1, { ...CONFIG, roundTicks: RULES.countdownTicks }));
  const a = engine.advance(started(42), 400), b = engine.advance(started(42), 400), c = engine.advance(started(43), 400);
  assert.deepEqual(a, b); assert.notDeepEqual(a.play.people, c.play.people);
  assert.ok(a.play.people.length > 0 || a.play.events.length > 0, 'people arrive');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'the state round-trips through JSON');
  let stepped = started(42); for (let t = 1; t <= 400; t += 7) stepped = engine.advance(stepped, t);
  assert.deepEqual(engine.advance(stepped, 400), a, 'many small advances = one big advance');
});

test('arrivals: nobody before the gates open; every kind appears, in its wave; lanes never crowd at the entry', () => {
  const s = started(5);
  assert.equal(engine.advance(s, OPEN).play.people.length, 0, 'the countdown is empty');
  const seen = new Map<Kind, number>(), firstWave = new Map<Kind, number>();
  for (let seed = 1; seed <= 40; seed++) {
    let run = started(seed);
    // keep every turnstile shut: nobody gets in, crashers are caught, guests and VIPs cost hearts; refill hearts to watch the whole run
    for (let t = OPEN; t < CONFIG.roundTicks - 40; t += 10) {
      run = engine.advance(run, t);
      if (run.gameOver) break;
      run = { ...run, play: { ...run.play, hearts: RULES.hearts } };
      for (const p of run.play.people) {
        seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
        const w = engine.waveAt(run, t);
        if (!firstWave.has(p.kind) || (firstWave.get(p.kind) as number) > w) firstWave.set(p.kind, w);
        assert.ok(p.y >= 0 && p.y < LINE);
      }
      for (let lane = 0; lane < LANES; lane++) {
        const ys = run.play.people.filter((p) => p.lane === lane).map((p) => p.y).sort((x, y) => y - x);
        for (let i = 1; i < ys.length; i++) assert.ok((ys[i - 1] as number) - (ys[i] as number) >= RULES.gap || ys[i] === 0, `gap in lane ${lane}`);
      }
    }
  }
  for (const k of KINDS) assert.ok((seen.get(k) ?? 0) > 0, `${k} appears`);
  assert.equal(firstWave.get('vip'), 1); assert.equal(firstWave.get('runner'), 2);
  assert.equal(firstWave.get('jumper'), 3); assert.equal(firstWave.get('fake'), 4);
});

test('the rush speeds up evenly: speed and arrival rate move a small step at a time, from the first second to the last', () => {
  const s = started(1), open = engine.openTickOf(s);
  assert.equal(engine.speedAt(s, open), RULES.speedStart); assert.equal(engine.speedAt(s, open - 30), RULES.speedStart);
  assert.equal(engine.speedAt(s, open + RULES.playTicks), RULES.speedEnd); assert.equal(engine.speedAt(s, open + RULES.playTicks + 99), RULES.speedEnd);
  assert.equal(engine.intervalAt(s, open), RULES.intervalStart); assert.equal(engine.intervalAt(s, open + RULES.playTicks), RULES.intervalEnd);
  let changes = 0;
  for (let t = open + 1; t <= open + RULES.playTicks; t++) {
    const before = engine.speedAt(s, t - 1), now = engine.speedAt(s, t);
    assert.ok(now - before === 0 || now - before === 1, 'never a jump: one unit (under 1%) at most per tick');
    if (now !== before) changes++;
  }
  assert.equal(changes, RULES.speedEnd - RULES.speedStart, 'a step every few ticks all along');
  // seen in a real run: people arriving late walk faster than people arriving early
  let run = started(12), early = 0, late = 0;
  for (let t = open; t < open + RULES.playTicks; t += 5) {
    run = engine.advance({ ...run, play: { ...run.play, hearts: RULES.hearts } }, t);
    if (run.gameOver) break;
    for (const p of run.play.people) if (p.kind === 'guest') { if (t < open + 300) early = Math.max(early, p.v); else if (t > open + 1500) late = Math.max(late, p.v); }
  }
  assert.ok(early > 0 && late > 2 * early - RULES.speedStart, `early ${early}, late ${late}`);
});

test('an open turnstile lets everyone in: guests and VIPs score with the combo, a crasher costs a heart', () => {
  let s = scene([{ kind: 'guest', y: 9950 }, { kind: 'vip', lane: 1, y: 9950 }, { kind: 'crasher', lane: 2, y: 9950 }]);
  s = engine.advance(s, OPEN + 1);
  assert.deepEqual(whats(s).sort(), ['crash', 'in', 'vip']);
  assert.equal(s.play.passed, 2); assert.equal(s.play.vips, 1); assert.equal(s.play.crashed, 1); assert.equal(s.play.hearts, RULES.hearts - 1);
  assert.equal(s.play.people.length, 0);
  assert.equal(s.play.combo, 0, 'the crasher (lane 2, after lanes 0 and 1) reset the combo');
  assert.equal(s.play.score, RULES.guest + RULES.vip * 1);
  assert.deepEqual(s.play.inList.length, 2);
});

test('a slammed turnstile catches crashers of every kind, and stays shut for one second only', () => {
  for (const kind of ['crasher', 'runner', 'jumper', 'fake'] as const) {
    let s = scene([{ kind, y: 9800, v: 300 }]);
    s = slam(s, 0, OPEN);
    s = engine.advance(s, OPEN + 1);
    assert.deepEqual(whats(s), ['caught'], kind); assert.equal(s.play.caught, 1); assert.equal(s.play.score, RULES.caught);
  }
  // a crasher arriving after the second is over gets in
  let late = scene([{ kind: 'crasher', y: LINE - 100 * (RULES.shutTicks + 2) }]);
  late = slam(late, 0, OPEN);
  late = engine.advance(late, OPEN + RULES.shutTicks + 5);
  assert.deepEqual(whats(late), ['crash']);
  // a slam only shuts its own lane
  let other = scene([{ kind: 'crasher', lane: 2, y: 9900 }]);
  other = engine.advance(slam(other, 0, OPEN), OPEN + 1);
  assert.deepEqual(whats(other), ['crash']);
});

test('latency: a slam a few ticks late still catches a crasher who is waiting behind a stopped guest, never one already in', () => {
  // the crasher reaches the line at OPEN+2; a slam at OPEN+3 is too late
  let s = scene([{ kind: 'crasher', y: 9800 }]);
  s = engine.advance(s, OPEN + 2);
  s = slam(s, 0, OPEN + 3);
  assert.deepEqual(whats(s), ['crash']);
  // slamming early (up to a second before) is always safe: the crasher stops at the shut turnstile
  let early = scene([{ kind: 'crasher', y: LINE - 100 * (RULES.shutTicks - 3) }]);
  early = engine.advance(slam(early, 0, OPEN), OPEN + RULES.shutTicks);
  assert.deepEqual(whats(early), ['caught']);
});

test('a guest at a shut turnstile waits (combo reset, fewer points), then gets in; too long and they storm off (a heart)', () => {
  let s = scene([{ kind: 'guest', y: 9950 }, { kind: 'guest', y: 9950 - RULES.gap - 300 }]);
  s = { ...s, play: { ...s.play, combo: 4, bestCombo: 4 } };
  s = slam(s, 0, OPEN);
  s = engine.advance(s, OPEN + 3);
  assert.deepEqual(whats(s), ['bump']); assert.equal(s.play.combo, 0);
  assert.equal(s.play.people[0]?.y, LINE - 1, 'waiting at the line'); assert.ok((s.play.people[1]?.y as number) <= LINE - 1 - RULES.gap, 'the next one queues');
  s = engine.advance(s, OPEN + RULES.shutTicks + 1);
  assert.deepEqual(whats(s), ['bump', 'in']); assert.equal(s.play.score, RULES.bumpedGuest);
  // kept shut by slam after slam: the guest storms off after `patience` ticks
  let kept = scene([{ kind: 'guest', y: 9950 }]);
  for (let t = OPEN; t < OPEN + RULES.patience + 10; t += RULES.shutTicks - 2) kept = slam(kept, 0, t);
  kept = engine.advance(kept, OPEN + RULES.patience + 10);
  assert.ok(whats(kept).includes('angry')); assert.equal(kept.play.hearts, RULES.hearts - 1); assert.equal(kept.play.angry, 1);
});

test('a VIP at a shut turnstile takes offence: a heart', () => {
  let s = scene([{ kind: 'vip', y: 9950 }]);
  s = engine.advance(slam(s, 0, OPEN), OPEN + 1);
  assert.deepEqual(whats(s), ['snub']); assert.equal(s.play.hearts, RULES.hearts - 1); assert.equal(s.play.people.length, 0);
});

test('a lane jumper changes lane halfway: the slam must be on the lane they end up in', () => {
  let s = scene([{ kind: 'jumper', lane: 0, sw: 1, y: RULES.jumpAt - 50, v: 200 }]);
  s = engine.advance(s, OPEN + 1);
  assert.equal(s.play.people[0]?.lane, 0, 'not yet past the jump point');
  s = engine.advance(s, OPEN + 2);
  assert.equal(s.play.people[0]?.lane, 1); assert.equal(s.play.people[0]?.sw, -1);
  s = slam(slam(s, 0, OPEN + 3), 1, OPEN + 20);
  s = engine.advance(s, OPEN + 40);
  assert.deepEqual(whats(s), ['caught']);
});

test('three hearts lost end the run (no bonus); surviving 90 s pays 1000 + 500 per heart', () => {
  const idle = engine.advance(started(9), CONFIG.roundTicks);
  assert.equal(idle.gameOver, true); assert.equal(idle.play.end, 'shut'); assert.equal(idle.play.hearts, 0); assert.equal(idle.play.bonus, 0);
  assert.ok(idle.tick < CONFIG.roundTicks, 'an idle gate lets three crashers in long before the end');
  assert.equal(idle.play.people.length, 0);
  const bot = playBot(engine, 77);
  assert.equal(bot.play.end, 'time', `the bot survives (${bot.play.hearts} hearts)`);
  assert.equal(bot.play.bonus, RULES.survival + RULES.perHeart * bot.play.hearts);
  assert.ok(bot.play.caught > 10 && bot.play.passed > 30, `caught ${bot.play.caught}, passed ${bot.play.passed}`);
  console.log(`  gate-rush bot (seed 77): score ${bot.play.score}, passed ${bot.play.passed}, caught ${bot.play.caught}, hearts ${bot.play.hearts}, best combo ${bot.play.bestCombo}`);
  assert.ok(JSON.stringify(bot).length < 8192);
  const after = engine.applyInput(bot, { action: 'slam', lane: 0 }, bot.tick + 1);
  assert.deepEqual(after, bot, 'a finished run never changes');
});

test('start: slams before the start or during the countdown are no-ops; a second start does not move the clock', () => {
  const fresh = engine.createRun(3, CONFIG);
  assert.deepEqual(engine.applyInput(fresh, { action: 'slam', lane: 1 }, 2).play, fresh.play);
  const s = started(3);
  assert.deepEqual(slam(s, 1, OPEN - 1).play.shut, [0, 0, 0]);
  assert.equal(engine.applyInput(s, { action: 'start' }, 30).startTick, 0);
  assert.deepEqual(slam(s, 1, OPEN).play.shut, [0, OPEN + RULES.shutTicks, 0]);
});

test('forged inputs never score or shut anything', () => {
  const s = scene([{ kind: 'crasher', y: 9950 }]);
  const forged: unknown[] = [
    { action: 'slam', lane: 3 }, { action: 'slam', lane: -1 }, { action: 'slam', lane: 0.5 }, { action: 'slam', lane: '0' },
    { action: 'slam', lane: 0, score: 999 }, { action: 'slam' }, { action: 'door', guest: 1, door: 'out' }, { action: 'start', x: 1 },
    { action: 'catch', id: 1 }, null, 7, 'slam', [], { score: 1e9 },
  ];
  for (const input of forged) {
    const after = engine.advance(engine.applyInput(s, input, OPEN), OPEN + 1);
    assert.deepEqual(whats(after), ['crash'], JSON.stringify(input));
    assert.equal(parseInput(input), null);
    assert.equal(inputSchema.safeParse(input).success, false, 'the page refuses what the verifier refuses');
  }
  assert.ok(inputSchema.safeParse({ action: 'slam', lane: 2 }).success);
});

test('checkState and the page schema refuse incoherent or tampered states (and agree)', () => {
  const s = engine.advance(started(4), 300);
  assert.ok(s.play.people.length > 0);
  assert.deepEqual(checkState(s), s); assert.equal(stateSchema.safeParse(s).success, true);
  const mutate = (f: (x: any) => void): unknown => { const c = structuredClone(s) as any; f(c); return c; };
  const bad = [
    mutate((x) => { x.extra = 1; }), mutate((x) => { x.play.extra = 1; }), mutate((x) => { x.play.score = -1; }), mutate((x) => { x.play.hearts = 4; }),
    mutate((x) => { x.play.hearts = 0; }), mutate((x) => { x.play.shut = [0, 0]; }), mutate((x) => { x.play.people[0].y = LINE; }),
    mutate((x) => { x.play.people[0].kind = 'king'; }), mutate((x) => { x.play.people[0].lane = 3; }), mutate((x) => { x.play.people[0].extra = 1; }),
    mutate((x) => { x.play.people[0].sw = x.play.people[0].lane; }), mutate((x) => { x.play.people.push({ ...x.play.people[0] }); }),
    mutate((x) => { x.play.people[0].id = x.play.nextId; }), mutate((x) => { x.play.people = Array(31).fill(x.play.people[0]); }),
    mutate((x) => { x.play.end = 'time'; }), mutate((x) => { x.play.combo = x.play.bestCombo + 1; }), mutate((x) => { x.started = false; }),
    mutate((x) => { x.tick = x.rules.maxTicks + 1; }), mutate((x) => { x.rules.game = 'full-row'; }), mutate((x) => { x.seed = -1; }),
    mutate((x) => { x.play.inList = Array(17).fill(1); }),
  ];
  for (const state of bad) {
    assert.throws(() => checkState(state), Error);
    assert.equal(stateSchema.safeParse(state).success, false);
  }
});

/** A fair bot: slams a lane when its front person is a crasher about to arrive, never when a guest or VIP is in front. */
function botSlams(state: GrState): number[] {
  const lanes: number[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    const front = state.play.people.filter((p) => p.lane === lane).sort((a, b) => b.y - a.y)[0];
    if (!front || !isCrasher(front.kind) || (front.kind === 'jumper' && front.sw >= 0)) continue;
    if (engine.shutAt(state.play, lane, state.tick + 2)) continue;
    if (LINE - front.y <= front.v * 6) lanes.push(lane);
  }
  return lanes;
}
function playBot(e: typeof engine, seed: number): GrState {
  let s = started(seed);
  for (let t = 1; !s.gameOver && t <= CONFIG.maxTicks; t++) {
    s = e.advance(s, t);
    const lanes = botSlams(s);
    if (lanes.length) s = e.applyInput(s, { action: 'slam', lane: lanes[0] }, t);
  }
  return s;
}

/* ------------------------------ the BUILT verifier ------------------------------ */
const ARCHIVE: Configuration = {
  appId: '00000000-0000-4000-8000-00000000a001', groupId: '60faaf46-ba4b-460c-a82a-adb852371a94', studioUrl: 'https://studio.superrare.com',
  apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com', appOrigin: 'https://gate-rush-test.srstudio.dev',
  display: 'embed', game: 'gate-rush', hubUrl: 'https://6972mvu4.srstudio.dev/',
};
async function built() {
  const files = unzipSync(zipSync(await packageGame(ARCHIVE)));
  const verifier = await loadBuiltVerifier(files['server-verifier.js'] as Uint8Array);
  return { files, verifier, config: JSON.parse(strFromU8(files['scoring-config.json'] as Uint8Array)) as Record<string, unknown> };
}

test('gate-rush: the archive has Studio\'s root layout, the credit line, a zod-free verifier under 256 KB', async () => {
  const { files, config } = await built();
  for (const required of ['index.html', 'config.json', 'server-verifier.js', 'scoring-config.json']) assert.ok(files[required], `missing ${required}`);
  assert.deepEqual(config, CONFIG);
  const verifier = files['server-verifier.js'] as Uint8Array;
  assert.ok(verifier.byteLength < 256_000, `${verifier.byteLength} B`);
  assert.ok(!/ZodError|\$ZodType/.test(strFromU8(verifier)), 'zod-free verifier');
  const html = strFromU8(files['index.html'] as Uint8Array);
  assert.ok(html.includes('<title>GATE RUSH · THE WALL ARCADE</title>'));
  assert.ok(/remix the wall experiment/i.test(html) && html.includes('https://onthewall.nfcsummit.com'), 'the credit line, linked');
  const publicConfig = strFromU8(files['config.json'] as Uint8Array);
  assert.ok(!/secret|token|private|treasury|0x[0-9a-fA-F]{40}/i.test(publicConfig));
  assert.equal(JSON.parse(publicConfig).groupId, '60faaf46-ba4b-460c-a82a-adb852371a94');
});

test('gate-rush: the BUILT verifier answers the conformance probe and rejects everything else', async () => {
  const { verifier, config } = await built();
  const probe = new Coordinator(verifier, config, 0);
  const state = await probe.create() as GrState;
  assert.equal(state.rules.game, 'gate-rush');
  assert.equal(await probe.score(), 0); assert.equal(await probe.isFinished(), false); assert.deepEqual(await probe.view(), state);
  const post = (payload: unknown) => verifier.fetch(new Request('https://verifier.invalid/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
  assert.equal((await post({ version: 1, op: 'score', state: { ...state, bogus: 9 } })).status, 400);
  assert.equal((await post({ version: 1, op: 'submitScore', score: 999999 })).status, 400);
  assert.equal((await post({ version: 1, op: 'advance', state, serverTick: -1 })).status, 400);
  assert.equal((await post({ version: 1, op: 'createRun', seed: 1, config: { ...config, game: 'full-row' } })).status, 400);
  assert.equal((await verifier.fetch(new Request('https://verifier.invalid/v1', { method: 'GET' }))).status, 404);
});

test('gate-rush: whole runs through the BUILT verifier, called every tick like the platform, equal the engine and replay exactly', async () => {
  const { verifier: raw, config } = await built();
  // per-call time of the verifier itself (the max of one call is GC noise of this test process: the p99 is the budget check)
  const times: number[] = [];
  const verifier = { fetch: async (request: Request): Promise<Response> => { const t0 = performance.now(); const r = await raw.fetch(request); times.push(performance.now() - t0); return r; } };
  for (const seed of [123456, 0, 0xfeedface]) {
    const run = new Coordinator<GrState>(verifier, config, seed);
    let local = engine.createRun(seed, config);
    await run.create();
    const sent: { input: unknown; tick: number }[] = [];
    const send = async (input: unknown, tick: number): Promise<void> => { await run.input(input, tick); sent.push({ input, tick: run.tick }); local = engine.applyInput(local, input, run.tick); };
    await send({ action: 'start' }, 2);
    const rnd = mulberry32(seed ^ 0x99);
    while (!run.state.gameOver && run.tick < (config.maxTicks as number)) {
      await run.advanceTo(run.tick + 1); local = engine.advance(local, run.tick);
      const lanes = botSlams(run.state);
      // a fallible player: misses one crasher in ten, and slams a random lane now and then
      if (lanes.length && rnd() < 0.9) await send({ action: 'slam', lane: lanes[0] }, run.tick + 1 + Math.floor(rnd() * 3));
      else if (rnd() < 0.01) await send({ action: 'slam', lane: Math.floor(rnd() * LANES) }, run.tick + 1);
    }
    await run.advanceTo(config.maxTicks as number); local = engine.advance(local, run.tick);
    assert.equal(run.state.gameOver, true);
    assert.deepEqual(run.state, local, 'bundled verifier state equals the engine in-process');
    assert.equal(await run.isFinished(), true); assert.equal(await run.score(), run.state.play.score);
    const again = new Coordinator<GrState>(verifier, config, seed);
    await again.create();
    for (const { input, tick } of sent) await again.input(input, tick);
    await again.advanceTo(run.tick);
    assert.deepEqual(again.state, run.state, 'same seed, same inputs at the same ticks: same run');
    console.log(`  gate-rush built verifier (seed ${seed}): ${run.calls} calls, end ${run.state.play.end}, score ${run.state.play.score}, passed ${run.state.play.passed}, caught ${run.state.play.caught}, largest state ${run.largestState} B`);
    assert.ok(run.largestState < 8192);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)] as number, p99 = times[Math.floor(times.length * 0.99)] as number;
  console.log(`  gate-rush built verifier: ${times.length} calls, median ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${(times.at(-1) as number).toFixed(2)} ms`);
  assert.ok(p99 < 3, `p99 ${p99} ms`);
});

test('gate-rush: the worst single call (an idle run advanced in one go) stays far under 10 ms', async () => {
  const { verifier, config } = await built();
  let worst = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const run = new Coordinator<GrState>(verifier, config, seed);
    await run.create(); await run.input({ action: 'start' }, 1);
    await run.advanceTo(config.maxTicks as number);
    worst = Math.max(worst, run.worstMs);
  }
  console.log(`  gate-rush built verifier: worst call ${worst.toFixed(2)} ms`);
  assert.ok(worst < 10);
});
