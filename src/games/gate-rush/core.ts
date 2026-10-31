// GATE RUSH: the deterministic rules, shared by the browser (prediction, practice) and the server verifier (zod-free).
//
// The people of the wall rush the gate of NFC Summit 2027 down three lanes, each closed by a turnstile. Turnstiles are
// open; a tap SLAMS one shut for one second. Whoever reaches a shut turnstile stops there: a gatecrasher is caught, a guest
// with a wristband waits (and storms off if made to wait too long), a VIP takes offence. Whoever reaches an open
// turnstile goes in: guests and VIPs score, a gatecrasher costs a heart. Three hearts; 90 s. The rush speeds up evenly
// from the first second to the last (walking speed and arrival rate both ramp, a little every few ticks); six waves bring
// VIPs, runners, lane jumpers and fake wristbands. Surviving the 90 s pays a big bonus.
//
// Integer arithmetic only, a seeded generator (src/common/det.ts), a state that round-trips through JSON exactly, no
// clock, no network. Arrival number n of a run is a pure function of (seed, n, wave, tick). Positions are integer units
// along a lane: 0 where people appear, LINE at the turnstile (fine enough for the speed to grow by about 1% at a time).
import { fnv1a, mulberry32 } from '../../common/det.js';

/* ================================ RULES ==================================== */
export const LANES = 3;
export const LINE = 10_000;                   // the turnstile
export const RULES = {
  countdownTicks: 60,                         // 3 s between the start and the gates opening
  playTicks: 1800,                            // 90 s
  waveTicks: 300,                             // six waves of 15 s
  shutTicks: 20,                              // a slam keeps a turnstile shut for 1 s (a new slam restarts it)
  gap: 1700,                                  // people in one lane keep this distance
  patience: 40,                               // a guest waits 2 s at a shut turnstile, then storms off
  jumpAt: 4500,                               // where a lane jumper changes lane
  maxPeople: 30,
  lastSpawnBeforeEnd: 20,                     // no new arrival in the last second
  hearts: 3,
  guest: 50, bumpedGuest: 10, vip: 150, caught: 100,
  comboEvery: 10, multCap: 5,
  survival: 1000, perHeart: 500,
  inListMax: 16, eventsMax: 8,
  /** The ramp, even from the opening of the gates to the end: walking speed (units per tick, a runner ×1.7) grows from
   *  speedStart to speedEnd, the ticks between arrivals (plus up to half again at random) shrink from intervalStart to
   *  intervalEnd, a step every few ticks. */
  speedStart: 120, speedEnd: 280,
  intervalStart: 22, intervalEnd: 9,
  /** Draw weight (out of 100) of each kind, per wave, in KINDS order. */
  weights: [
    [75, 0, 25, 0, 0, 0],
    [62, 10, 28, 0, 0, 0],
    [55, 10, 20, 15, 0, 0],
    [50, 10, 15, 10, 15, 0],
    [45, 10, 10, 10, 10, 15],
    [42, 10, 10, 12, 12, 14],
  ] as readonly (readonly number[])[],
};
export const WAVES = RULES.weights.length;
/** guest: blue wristband, let in · vip: gold crown, let in, never stop · crasher: no wristband · runner: a crasher who
 *  sprints · jumper: a crasher who changes lane halfway · fake: a crasher with a red (fake) wristband. */
export const KINDS = ['guest', 'vip', 'crasher', 'runner', 'jumper', 'fake'] as const;
export type Kind = (typeof KINDS)[number];
export const isCrasher = (kind: Kind): boolean => kind !== 'guest' && kind !== 'vip';
/** in: a guest got in · vip: a VIP got in · caught: a crasher stopped · crash: a crasher got in (heart) · snub: a VIP
 *  stopped (heart) · angry: a guest waited too long (heart) · bump: a guest stopped at a shut turnstile (combo reset). */
export const WHATS = ['in', 'vip', 'caught', 'crash', 'snub', 'angry', 'bump'] as const;
export type What = (typeof WHATS)[number];
export const HEART_LOSS: readonly What[] = ['crash', 'snub', 'angry'];

/* ============================ TYPES & VALIDATION ============================= */
export type NamedPanel = { p: number; n: string };
export type GrConfig = { game: 'gate-rush'; maxTicks: number; roundTicks: number };
export type Person = {
  id: number; panel: number; kind: Kind; lane: number; y: number; v: number;
  /** A lane jumper's next lane, -1 once jumped or for anyone else. */
  sw: number;
  /** Tick this guest started waiting at a shut turnstile, -1 when walking. */
  wait: number;
  bumped: boolean;
};
export type GrEvent = { seq: number; tick: number; lane: number; kind: Kind; panel: number; what: What; gain: number };
export type End = 'none' | 'time' | 'shut' | 'horizon';
export type Play = {
  score: number; combo: number; bestCombo: number; hearts: number;
  passed: number; vips: number; caught: number; crashed: number; snubbed: number; angry: number;
  bonus: number; end: End;
  /** Tick until which each turnstile stays shut (exclusive). */
  shut: number[];
  people: Person[];
  nextSpawn: number; spawned: number; nextId: number; eventSeq: number;
  events: GrEvent[];
  /** Panels of the last people who got in (oldest first), display and sharing only. */
  inList: number[];
};
export type GrState = { tick: number; gameOver: boolean; started: boolean; startTick: number | null; seed: number; rules: GrConfig; play: Play };
export type GrInput = { action: 'start' } | { action: 'slam'; lane: number };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const MAX_INT = Number.MAX_SAFE_INTEGER;
const MAX_ID = 1_000_000;
function exactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const fail = (what: string): never => { throw new Error(`Invalid GATE RUSH ${what}`); };

export function parseSeed(seed: unknown): number { return isInt(seed, 0, 0xffffffff) ? seed : fail('seed'); }
/** The scoring config (extra keys are dropped, like a non-strict object schema). */
export function parseConfig(value: unknown): GrConfig {
  if (!isObject(value) || value.game !== 'gate-rush' || !isInt(value.maxTicks, 1, 100_000) || !isInt(value.roundTicks, RULES.countdownTicks + 1, 100_000)
    || value.maxTicks < value.roundTicks) return fail('config');
  return { game: 'gate-rush', maxTicks: value.maxTicks, roundTicks: value.roundTicks };
}
/** An input, or null when it is not one (unknown action, extra field, a lane out of range). */
export function parseInput(value: unknown): GrInput | null {
  if (!isObject(value)) return null;
  if (value.action === 'start') return exactKeys(value, ['action']) ? { action: 'start' } : null;
  if (value.action === 'slam' && exactKeys(value, ['action', 'lane']) && isInt(value.lane, 0, LANES - 1)) return { action: 'slam', lane: value.lane };
  return null;
}
const PERSON_KEYS = ['id', 'panel', 'kind', 'lane', 'y', 'v', 'sw', 'wait', 'bumped'] as const;
const EVENT_KEYS = ['seq', 'tick', 'lane', 'kind', 'panel', 'what', 'gain'] as const;
const PLAY_KEYS = ['score', 'combo', 'bestCombo', 'hearts', 'passed', 'vips', 'caught', 'crashed', 'snubbed', 'angry', 'bonus', 'end',
  'shut', 'people', 'nextSpawn', 'spawned', 'nextId', 'eventSeq', 'events', 'inList'] as const;
const STATE_KEYS = ['tick', 'gameOver', 'started', 'startTick', 'seed', 'rules', 'play'] as const;
function checkPerson(p: unknown): Person {
  if (!isObject(p) || !exactKeys(p, PERSON_KEYS)) return fail('person');
  if (!isInt(p.id, 1, MAX_ID) || !isInt(p.panel, 1, 550) || !oneOf(p.kind, KINDS) || !isInt(p.lane, 0, LANES - 1) || !isInt(p.y, 0, LINE - 1)
    || !isInt(p.v, 1, 1000) || !isInt(p.sw, -1, LANES - 1) || p.sw === p.lane || !isInt(p.wait, -1, MAX_INT) || typeof p.bumped !== 'boolean') return fail('person');
  return { id: p.id, panel: p.panel, kind: p.kind, lane: p.lane, y: p.y, v: p.v, sw: p.sw, wait: p.wait, bumped: p.bumped };
}
function checkEvent(e: unknown): GrEvent {
  if (!isObject(e) || !exactKeys(e, EVENT_KEYS)) return fail('event');
  if (!isInt(e.seq, 1, MAX_INT) || !isInt(e.tick, 0, MAX_INT) || !isInt(e.lane, 0, LANES - 1) || !oneOf(e.kind, KINDS) || !isInt(e.panel, 1, 550)
    || !oneOf(e.what, WHATS) || !isInt(e.gain, 0, 1_000_000)) return fail('event');
  return { seq: e.seq, tick: e.tick, lane: e.lane, kind: e.kind, panel: e.panel, what: e.what, gain: e.gain };
}
/** A run state as the coordinator hands it back: strict shape, bounded numbers, a coherent timeline. Throws otherwise. */
export function checkState(value: unknown): GrState {
  if (!isObject(value) || !exactKeys(value, STATE_KEYS)) return fail('state');
  const p = value.play;
  if (!isObject(p) || !exactKeys(p, PLAY_KEYS)) return fail('state');
  for (const k of ['score', 'combo', 'bestCombo', 'passed', 'vips', 'caught', 'crashed', 'snubbed', 'angry', 'bonus', 'nextSpawn', 'eventSeq'] as const) {
    if (!isInt(p[k], 0, MAX_INT)) return fail('state');
  }
  if (!isInt(p.hearts, 0, RULES.hearts) || !oneOf(p.end, ['none', 'time', 'shut', 'horizon'] as const) || !isInt(p.spawned, 0, MAX_ID)
    || !isInt(p.nextId, 1, MAX_ID + 1)) return fail('state');
  const { shut, people, events, inList } = p;
  if (!Array.isArray(shut) || shut.length !== LANES || !shut.every((t) => isInt(t, 0, MAX_INT))) return fail('state');
  if (!Array.isArray(people) || people.length > RULES.maxPeople) return fail('state');
  if (!Array.isArray(events) || events.length > RULES.eventsMax) return fail('state');
  if (!Array.isArray(inList) || inList.length > RULES.inListMax || !inList.every((x) => isInt(x, 1, 550))) return fail('state');
  const crowd = people.map(checkPerson), log = events.map(checkEvent);
  const { tick, gameOver, started, startTick, seed } = value;
  if (!isInt(tick, 0, MAX_INT) || typeof gameOver !== 'boolean' || typeof started !== 'boolean'
    || (startTick !== null && !isInt(startTick, 0, MAX_INT)) || !isInt(seed, 0, 0xffffffff)) return fail('state');
  const rules = parseConfig(value.rules);
  if (started !== (startTick !== null) || (startTick !== null && startTick > tick) || tick > rules.maxTicks
    || (p.end !== 'none') !== gameOver || (p.hearts === 0 && !gameOver) || (p.combo as number) > (p.bestCombo as number)
    || (!started && crowd.length > 0) || new Set(crowd.map((x) => x.id)).size !== crowd.length || crowd.some((x) => x.id >= (p.nextId as number))
    || log.some((e) => e.seq > (p.eventSeq as number))) return fail('timeline');
  return {
    tick, gameOver, started, startTick, seed, rules,
    play: {
      score: p.score as number, combo: p.combo as number, bestCombo: p.bestCombo as number, hearts: p.hearts,
      passed: p.passed as number, vips: p.vips as number, caught: p.caught as number, crashed: p.crashed as number,
      snubbed: p.snubbed as number, angry: p.angry as number, bonus: p.bonus as number, end: p.end,
      shut: shut.slice() as number[], people: crowd, nextSpawn: p.nextSpawn as number, spawned: p.spawned, nextId: p.nextId,
      eventSeq: p.eventSeq as number, events: log, inList: inList.slice() as number[],
    },
  };
}

/* ================================ ENGINE ==================================== */
export const display = (name: string): string => name.trim().toUpperCase();

export function createEngine(panels: readonly NamedPanel[]) {
  const pool = panels.filter((panel) => /^[\x20-\x7E]{1,32}$/.test(display(panel.n))).map((panel) => ({ p: panel.p, n: display(panel.n) }));
  if (pool.length < 8) throw new Error('GATE RUSH needs at least 8 named panels');

  const openTickOf = (state: GrState): number => (state.startTick ?? 0) + RULES.countdownTicks;
  function endTickOf(state: GrState): number {
    return state.startTick === null ? state.rules.maxTicks : Math.min(state.rules.maxTicks, state.startTick + state.rules.roundTicks);
  }
  function waveAt(state: GrState, tick: number): number {
    const t = tick - openTickOf(state);
    return t <= 0 ? 0 : Math.min(WAVES - 1, Math.floor(t / RULES.waveTicks));
  }
  /** How far into the 90 s a tick is, from 0 to playTicks. */
  const elapsed = (state: GrState, tick: number): number => Math.max(0, Math.min(RULES.playTicks, tick - openTickOf(state)));
  /** Walking speed of someone arriving at this tick (before the runner's ×1.7). */
  const speedAt = (state: GrState, tick: number): number =>
    RULES.speedStart + Math.floor((RULES.speedEnd - RULES.speedStart) * elapsed(state, tick) / RULES.playTicks);
  const intervalAt = (state: GrState, tick: number): number =>
    RULES.intervalStart - Math.floor((RULES.intervalStart - RULES.intervalEnd) * elapsed(state, tick) / RULES.playTicks);
  const multOf = (combo: number): number => 1 + Math.min(RULES.multCap - 1, Math.floor(combo / RULES.comboEvery));
  const shutAt = (play: Play, lane: number, tick: number): boolean => tick < (play.shut[lane] as number);

  function event(state: GrState, person: Person, what: What, gain: number): void {
    const play = state.play;
    play.eventSeq++;
    play.events.push({ seq: play.eventSeq, tick: state.tick, lane: person.lane, kind: person.kind, panel: person.panel, what, gain });
    if (play.events.length > RULES.eventsMax) play.events.shift();
  }
  function good(state: GrState, person: Person, what: What, base: number): void {
    const play = state.play;
    const gain = base * multOf(play.combo);
    play.score += gain; play.combo++;
    if (play.combo > play.bestCombo) play.bestCombo = play.combo;
    event(state, person, what, gain);
  }
  function bad(state: GrState, person: Person, what: What): void {
    const play = state.play;
    play.combo = 0;
    if ((HEART_LOSS as readonly string[]).includes(what)) play.hearts--;
    event(state, person, what, 0);
  }
  function getsIn(state: GrState, person: Person): void {
    const play = state.play;
    play.inList.push(person.panel);
    if (play.inList.length > RULES.inListMax) play.inList.shift();
  }

  /** Arrival number n: lane, kind, speed and name are a pure function of (seed, n, wave, tick). Null if every lane's
   *  entry is crowded (it is retried the next tick). */
  function arrival(state: GrState, n: number, wave: number): Person | null {
    const rnd = mulberry32(fnv1a(`rush:${state.seed}:${n}`));
    const first = Math.floor(rnd() * LANES);
    let lane = -1;
    for (let k = 0; k < LANES && lane < 0; k++) {
      const l = (first + k) % LANES;
      if (state.play.people.every((p) => p.lane !== l || p.y >= RULES.gap)) lane = l;
    }
    // a name not already on the lanes (the next one in the pool otherwise)
    let at = Math.floor(rnd() * pool.length);
    for (let k = 0; k < pool.length && state.play.people.some((p) => p.panel === (pool[at] as NamedPanel).p); k++) at = (at + 1) % pool.length;
    const who = pool[at] as NamedPanel;
    const weights = RULES.weights[wave] as readonly number[];
    let r = Math.floor(rnd() * 100), k = 0;
    while (k < KINDS.length - 1 && r >= (weights[k] as number)) { r -= weights[k] as number; k++; }
    const kind = KINDS[k] as Kind;
    const base = speedAt(state, state.tick);
    const v = kind === 'runner' ? Math.floor(base * 17 / 10) : base;
    const side = rnd() < 0.5 ? -1 : 1;
    if (lane < 0) return null;
    const sw = kind !== 'jumper' ? -1 : lane === 0 ? 1 : lane === LANES - 1 ? LANES - 2 : lane + side;
    return { id: state.play.nextId, panel: who.p, kind, lane, y: 0, v, sw, wait: -1, bumped: false };
  }
  function spawn(state: GrState): void {
    const play = state.play, tick = state.tick;
    if (tick < play.nextSpawn || tick >= endTickOf(state) - RULES.lastSpawnBeforeEnd || play.people.length >= RULES.maxPeople) return;
    const wave = waveAt(state, tick);
    const person = arrival(state, play.spawned, wave);
    if (!person) return;
    const rnd = mulberry32(fnv1a(`gap:${state.seed}:${play.spawned}`));
    const interval = intervalAt(state, tick);
    play.people.push(person);
    play.spawned++; play.nextId++;
    play.nextSpawn = tick + interval + Math.floor(rnd() * (Math.floor(interval / 2) + 1));
  }

  /** One server tick: arrivals, lane jumps, then every lane moves front to back. */
  function step(state: GrState): void {
    const play = state.play, tick = state.tick;
    spawn(state);
    // a lane jumper jumps once past jumpAt, as soon as the other lane has room beside them
    for (const p of play.people) {
      if (p.sw < 0 || p.y < RULES.jumpAt) continue;
      if (play.people.every((q) => q.lane !== p.sw || Math.abs(q.y - p.y) >= RULES.gap)) { p.lane = p.sw; p.sw = -1; }
    }
    const gone = new Set<number>();
    for (let lane = 0; lane < LANES; lane++) {
      const line = play.people.filter((p) => p.lane === lane).sort((a, b) => b.y - a.y || a.id - b.id);
      let ahead: number | null = null;                         // the y of the person in front, after their move
      for (const p of line) {
        let target = p.y + p.v;
        if (ahead !== null) target = Math.min(target, ahead - RULES.gap);
        if (target < p.y) target = p.y;
        if (target >= LINE) {
          if (shutAt(play, lane, tick)) {
            if (isCrasher(p.kind)) { play.caught++; good(state, p, 'caught', RULES.caught); gone.add(p.id); continue; }
            if (p.kind === 'vip') { play.snubbed++; bad(state, p, 'snub'); gone.add(p.id); if (play.hearts <= 0) return; continue; }
            // a guest waits at the shut turnstile; too long, and they storm off
            if (p.wait < 0) { p.wait = tick; if (!p.bumped) { p.bumped = true; bad(state, p, 'bump'); } }
            if (tick - p.wait >= RULES.patience) { play.angry++; bad(state, p, 'angry'); gone.add(p.id); if (play.hearts <= 0) return; continue; }
            p.y = LINE - 1; ahead = p.y; continue;
          }
          gone.add(p.id);
          if (isCrasher(p.kind)) { play.crashed++; bad(state, p, 'crash'); if (play.hearts <= 0) return; continue; }
          play.passed++; getsIn(state, p);
          if (p.kind === 'vip') { play.vips++; good(state, p, 'vip', RULES.vip); }
          else if (p.bumped) { play.score += RULES.bumpedGuest; event(state, p, 'in', RULES.bumpedGuest); }
          else good(state, p, 'in', RULES.guest);
          continue;
        }
        p.wait = -1; p.y = target; ahead = p.y;
      }
    }
    if (gone.size) play.people = play.people.filter((p) => !gone.has(p.id));
  }

  function finish(state: GrState, end: End): void {
    const play = state.play;
    state.gameOver = true; play.end = end; play.people = [];
    if (end === 'time') { play.bonus = RULES.survival + RULES.perHeart * play.hearts; play.score += play.bonus; }
  }
  /** Mutating advance, one server tick at a time from the opening of the gates. */
  function advanceInPlace(state: GrState, serverTick: number): GrState {
    if (!Number.isSafeInteger(serverTick) || serverTick < state.tick) {
      throw new Error('serverTick must be a nonnegative safe integer and must not move backwards');
    }
    if (state.gameOver) return state;
    const end = endTickOf(state);
    const target = Math.min(serverTick, end);
    if (state.started) {
      const open = openTickOf(state);
      if (state.tick < open) state.tick = Math.min(open, target);
      while (state.tick < target) {
        state.tick++;
        step(state);
        if (state.play.hearts <= 0) { finish(state, 'shut'); return state; }
      }
    }
    state.tick = Math.max(state.tick, target);
    if (state.tick >= end) finish(state, state.started ? 'time' : 'horizon');
    return state;
  }
  const clone = (state: GrState): GrState => structuredClone(state);

  function createRun(seed: unknown, config: unknown): GrState {
    const validSeed = parseSeed(seed);
    const rules = parseConfig(config);
    return {
      tick: 0, gameOver: false, started: false, startTick: null, seed: validSeed, rules,
      play: {
        score: 0, combo: 0, bestCombo: 0, hearts: RULES.hearts, passed: 0, vips: 0, caught: 0, crashed: 0, snubbed: 0, angry: 0,
        bonus: 0, end: 'none', shut: [0, 0, 0], people: [], nextSpawn: 0, spawned: 0, nextId: 1, eventSeq: 0, events: [], inList: [],
      },
    };
  }
  function advance(state: GrState, serverTick: number): GrState {
    if (!Number.isSafeInteger(serverTick) || serverTick < state.tick) {
      throw new Error('serverTick must be a nonnegative safe integer and must not move backwards');
    }
    if (state.gameOver || serverTick === state.tick) return state;
    return advanceInPlace(clone(state), serverTick);
  }
  function applyInputInPlace(state: GrState, input: unknown, serverTick: number): GrState {
    advanceInPlace(state, serverTick);
    if (state.gameOver) return state;
    const action = parseInput(input);
    if (!action) return state;
    if (action.action === 'start') {
      if (!state.started) { state.started = true; state.startTick = state.tick; state.play.nextSpawn = openTickOf(state); }
      return state;
    }
    if (!state.started || state.tick < openTickOf(state)) return state;
    // the turnstile is shut from this tick for shutTicks (a slam on a shut turnstile restarts its second)
    state.play.shut[action.lane] = state.tick + RULES.shutTicks;
    return state;
  }
  function applyInput(state: GrState, input: unknown, serverTick: number): GrState {
    return applyInputInPlace(clone(state), input, serverTick);
  }
  const view = (state: GrState): GrState => state;
  const isFinished = (state: GrState): boolean => state.gameOver;
  const score = (state: GrState): number => state.play.score;

  return {
    createRun, advance, applyInput, view, isFinished, score,
    advanceInPlace, applyInputInPlace, clone, endTickOf, openTickOf, waveAt, speedAt, intervalAt, multOf, shutAt, pool,
  };
}
export type GateRushEngine = ReturnType<typeof createEngine>;
