// GATE RUSH: the browser side. The page draws the gate of NFC Summit 2027 with the platform's authoritative state (the
// player's own queued slams applied by the very module the verifier runs, then brought to "now" by that same module) and
// turns a tap or a key into ONE ordered input: { action: 'slam', lane }. It never sends a score, a time or a state: who
// got in, who was caught and what it is worth is decided by the rules on SuperRare's server.
//
// The people are the people of the wall: their walking sprite (people.json) when they made one, a pixel stand-in
// otherwise. Badges, sprites, sounds, the dance floor and the end card are display only.
import type { EndStats, GameAdapter, Stage, StageIO } from '../../shell/adapter.js';
import { createSavedRoundParser } from '../../shell/saved-round.js';
import { scoringConfiguration } from '../../shell/config.js';
import { HitFeed } from '../../shell/hits.js';
import { infoOf } from '../../shell/wall-data.js';
import { loadPeople, onPeople, sheetOfName } from '../../shell/people.js';
import { DIR, drawSprite, stepAt, type SpriteSheet } from '../../share/sprite.js';
import { fitTweet, intentHref, tag } from '../../share/post.js';
import { rankOf } from '../../share/end-screen.js';
import { WALL_PANELS } from '../../generated/wall.js';
import { fnv1a } from '../../common/det.js';
import {
  LANES, LINE, RULES, engine, inputSchema, isCrasher, snapshotSchema, stateSchema,
  type GrEvent, type GrState, type Kind, type Person, type What,
} from './engine.js';

const W = 420, H = 800, TICK_MS = 50;
const INK = '#0B0B0B', CHALK = '#F2F0EB', CONCRETE = '#DEDBD3', BLUE = '#2E7FD6', LABEL = '#6B685F', FAINT = '#CFCBC1';
const GOLD = '#D9A62E', RED = '#D64532', FLOOR = '#16151A';
const F_ANTON = 'Anton, Impact, "Arial Narrow", sans-serif', F_MONO = '"IBM Plex Mono", ui-monospace, monospace';
const HUD_H = 96, LANE_W = W / LANES;
const FY0 = 132, FYL = 560;                               // feet at y = 0 and at the turnstile
const GATE_Y = 566, FLOOR_Y = 600;                        // the turnstiles, the dance floor
const SIZE = 48;                                          // a person on the lanes
const LANE_KEYS: Record<string, number> = { ArrowLeft: 0, KeyA: 0, Digit1: 0, ArrowDown: 1, ArrowUp: 1, KeyS: 1, KeyW: 1, Digit2: 1, ArrowRight: 2, KeyD: 2, Digit3: 2 };
const SNAPSHOT_NAME = new Map(WALL_PANELS.map((p) => [p.p, p]));
const nameOfPanel = (panel: number): string => SNAPSHOT_NAME.get(panel)?.n.toUpperCase() ?? '';
const handleOf = (panel: number): string => infoOf(panel).handle || SNAPSHOT_NAME.get(panel)?.h || '';
const fmtScore = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const laneX = (lane: number): number => LANE_W * lane + LANE_W / 2;
const feetY = (y: number): number => FY0 + (y / LINE) * (FYL - FY0);
const pick = <T,>(list: readonly T[], key: string): T => list[fnv1a(key) % list.length] as T;

/** What a person says, by what happened to them (display only, picked from the event number). */
const SAYS: Record<What, readonly string[]> = {
  in: ['GM!', "LET'S GOOO", 'WAGMI', 'HI MOM!'],
  vip: ['DARLING!', 'OBVIOUSLY.', 'CHAMPAGNE?'],
  caught: ['BUSTED!', 'WORTH A TRY', 'NGMI', 'MY COUSIN HAS ONE!'],
  crash: ['LOL THANKS', 'EZ', 'SUCKER!', 'TOO SLOW!'],
  snub: ['DO YOU KNOW WHO I AM?', 'CALL MY AGENT', 'TELLING THE DJ'],
  angry: ["I'M LEAVING!", 'REFUND!!', 'UNBELIEVABLE'],
  bump: ['OUCH!', 'HEY!', 'I HAVE A BAND!'],
};
const WAVE_BANNERS = ['GATES OPEN!', 'VIPS ARRIVING', 'RUNNERS!', 'LANE JUMPERS!', 'FAKE WRISTBANDS!', 'LAST CALL!'];
const COMBO_BANNERS = ['', '×2 NICE', '×3 ON FIRE', '×4 UNSTOPPABLE', '×5 LEGENDARY'];

type Mode = 'idle' | 'play' | 'end';
type Pop = { seq: number; what: What; lane: number; kind: Kind; panel: number; gain: number; t0: number };
type Dancer = { panel: number; x: number; t0: number; vip: boolean };
type Bit = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number };

/** The end card's title: what kind of gatekeeper this run made you (display only). */
export function gatekeeperTitle(play: GrState['play']): { title: string; line: string; good: boolean } {
  if (play.end === 'time') {
    if (play.crashed === 0 && play.hearts === RULES.hearts) return { title: 'IRON GATE', line: 'Not a single gatecrasher got in.', good: true };
    if (play.bestCombo >= 40) return { title: 'LEGEND OF THE GATE', line: `${play.bestCombo} in a row without a mistake.`, good: true };
    if (play.caught >= 25) return { title: 'CRASHER MAGNET', line: `Caught ${play.caught} gatecrashers.`, good: true };
    return { title: 'SURVIVED THE RUSH', line: 'The gate held for 90 seconds.', good: true };
  }
  if (play.crashed >= 2) return { title: 'THE PUSHOVER', line: `Let in ${play.crashed} gatecrashers. Everyone loves you.`, good: false };
  if (play.snubbed >= 2) return { title: 'VIP NIGHTMARE', line: `Slammed the gate on ${play.snubbed} VIPs.`, good: false };
  if (play.angry >= 2) return { title: 'TRAFFIC JAM', line: `${play.angry} guests gave up and went home.`, good: false };
  return { title: 'OVERWHELMED', line: `The rush won this time: ${play.passed} got in first.`, good: false };
}

/* ------------------------------ a pixel stand-in ------------------------------ */
// A person of the wall without a character yet: a 16 × 16 pixel figure, colours from their name, four walking steps.
const SKIN = ['#F1C9A5', '#D9A47E', '#A8714F', '#6B4430', '#E8B98F'];
const TOP = ['#2E7FD6', '#3E7D4F', '#7A4FA3', '#D9A62E', '#5C6B78', '#B5462F', '#C7B9A6'];
const HAIR = ['#0B0B0B', '#5A3A22', '#C9A16B', '#8E2F1E', '#DEDBD3'];
function drawStandIn(g: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, step: number, dir: number): void {
  const h = fnv1a(name), px = size / 16;
  const skin = SKIN[h % SKIN.length] as string, top = TOP[(h >>> 3) % TOP.length] as string, hair = HAIR[(h >>> 6) % HAIR.length] as string;
  const r = (cx: number, cy: number, w: number, hh: number, c: string): void => { g.fillStyle = c; g.fillRect(Math.round(x + cx * px), Math.round(y + cy * px), Math.ceil(w * px), Math.ceil(hh * px)); };
  const bob = step % 2 ? 0.5 : 0;
  r(5, 1 + bob, 6, 2, hair); r(5, 3 + bob, 6, 4, skin);
  if (dir === DIR.DOWN) { r(6, 4 + bob, 1, 1, INK); r(9, 4 + bob, 1, 1, INK); } else if (dir === DIR.UP) r(5, 3 + bob, 6, 2, hair);
  r(4, 7 + bob, 8, 5, top); r(3, 8 + bob, 1, 3, skin); r(12, 8 + bob, 1, 3, skin);
  const a = step % 4 === 1 ? 1 : step % 4 === 3 ? -1 : 0;
  r(5, 12, 2, 3 + (a > 0 ? 0 : 1), INK); r(9, 12, 2, 3 + (a < 0 ? 0 : 1), INK);
}
function drawPerson(g: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, step: number, dir: number): void {
  const sheet: SpriteSheet | null = sheetOfName(name);
  if (sheet) drawSprite(g, sheet, x, y, size, step, dir);
  else drawStandIn(g, name, x, y, size, step, dir);
}

/* --------------------------------- sound --------------------------------- */
const SOUND_KEY = 'gate-rush:sound';
let audio: AudioContext | null = null;
let soundOn = (() => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } })();
function beep(freqs: number[], len = 0.08, type: OscillatorType = 'square', gain = 0.05): void {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    let t = audio.currentTime;
    for (const f of freqs) {
      const o = audio.createOscillator(), v = audio.createGain();
      o.type = type; o.frequency.value = f; v.gain.setValueAtTime(gain, t); v.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(v).connect(audio.destination); o.start(t); o.stop(t + len); t += len * 0.9;
    }
  } catch { /* no sound on this device */ }
}
const SOUNDS: Record<What, () => void> = {
  in: () => beep([660], 0.04, 'triangle', 0.03),
  vip: () => beep([660, 880, 1320], 0.07),
  caught: () => beep([880, 660], 0.06),
  crash: () => beep([180, 120], 0.14, 'sawtooth', 0.06),
  snub: () => beep([220, 160], 0.14, 'sawtooth', 0.06),
  angry: () => beep([260, 180], 0.14, 'sawtooth', 0.05),
  bump: () => beep([300], 0.05, 'triangle', 0.04),
};

function createStage(host: HTMLElement, io: StageIO): Stage {
  host.classList.add('gr-arena', 'own-end');
  host.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.className = 'ub-canvas gr-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'GATE RUSH. Three lanes run to three turnstiles. Tap a lane, or press 1, 2, 3 or ← ↓ →, to slam its turnstile shut for one second: catch the gatecrashers (sunglasses, or a red wristband), let the blue wristbands and the gold VIPs in.');
  const soundButton = document.createElement('button');
  soundButton.type = 'button'; soundButton.className = 'ub-sound secondary';
  const label = (): void => { soundButton.textContent = soundOn ? 'Sound on' : 'Sound off'; };
  label();
  soundButton.addEventListener('click', () => { soundOn = !soundOn; label(); try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch { /* storage unavailable */ } });
  const endPanel = document.createElement('section');
  endPanel.className = 'end-panel'; endPanel.hidden = true; endPanel.setAttribute('aria-label', 'Your run');
  host.append(canvas, endPanel, soundButton);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  void loadPeople();
  onPeople(() => { dirty = true; });

  /* ------------------------------ stage state ------------------------------ */
  let mode: Mode = 'idle';
  let practice = false;
  let finalScore: number | null = null;
  let view: GrState | null = null;          // the latest authoritative (or predicted) state
  let shown: GrState | null = null;         // that state brought to "now" by the rules: what is drawn
  let nowTick = 0, tickAt = 0;
  let seen = new Map<number, What>();       // event seq -> what, so each event plays once (and a correction replays)
  let pops: Pop[] = [];
  let dancers: Dancer[] = [];
  let bits: Bit[] = [];
  let banner: { text: string; t0: number; gold: boolean } | null = null;
  let lastWave = -2, lastSlam = [-99, -99, -99], pressed = [0, 0, 0];
  let shake = 0, flash = 0, lastCount = -1;
  let endStats: EndStats | null = null;
  let dirty = true, DPR = 1;
  let hits = new HitFeed('gate-rush', false);

  function reset(isPractice: boolean): void {
    view = null; shown = null; nowTick = 0; seen = new Map(); pops = []; dancers = []; bits = []; banner = null;
    lastWave = -2; lastSlam = [-99, -99, -99]; pressed = [0, 0, 0]; shake = 0; flash = 0; lastCount = -1;
    finalScore = null; endStats = null; practice = isPractice;
    hits = new HitFeed('gate-rush', isPractice ? false : undefined);
  }

  /* ------------------------------ text helpers ----------------------------- */
  function text(s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'center', g: CanvasRenderingContext2D = ctx): void {
    g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
  }
  function fitFont(s: string, maxW: number, size: number, family: string, g: CanvasRenderingContext2D = ctx): string {
    let sz = size;
    g.font = `${sz}px ${family}`;
    while (sz > 8 && g.measureText(s).width > maxW) { sz -= 1; g.font = `${sz}px ${family}`; }
    return `${sz}px ${family}`;
  }

  /* -------------------------------- input ----------------------------------- */
  const openTick = (s: GrState): number => engine.openTickOf(s);
  function slam(lane: number): void {
    if (mode !== 'play' || !shown || shown.gameOver || !io.canInput() || nowTick < openTick(shown)) return;
    if (nowTick - (lastSlam[lane] as number) < 3) return;               // one slam per lane every 3 ticks is plenty
    lastSlam[lane] = nowTick; pressed[lane] = performance.now();
    beep([140], 0.05, 'square', 0.05);
    io.sendInput({ action: 'slam', lane });
  }
  function laneAt(e: PointerEvent): number | null {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    return y < HUD_H ? null : Math.max(0, Math.min(LANES - 1, Math.floor(x / LANE_W)));
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'play') return;
    const lane = laneAt(e);
    if (lane === null) return;
    e.preventDefault();
    slam(lane);
  });
  window.addEventListener('keydown', (e) => {
    const lane = LANE_KEYS[e.code];
    if (lane === undefined || mode !== 'play' || e.repeat) return;
    e.preventDefault();
    slam(lane);
  });

  /* ------------------------------ state follow ------------------------------ */
  function burst(x: number, y: number, count: number): void {
    const colors = [GOLD, BLUE, CHALK, RED];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 240;
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, life: 0.7 + Math.random() * 0.6, c: colors[i % colors.length] as string, s: 4 + Math.random() * 4 });
    }
  }
  function follow(s: GrState): void {
    for (const e of s.play.events) {
      const before = seen.get(e.seq);
      if (before === e.what) continue;
      seen.set(e.seq, e.what);
      if (before === undefined) onEvent(e, s);
      pops = pops.filter((p) => p.seq !== e.seq);
      pops.push({ seq: e.seq, what: e.what, lane: e.lane, kind: e.kind, panel: e.panel, gain: e.gain, t0: performance.now() });
      if (pops.length > 6) pops.shift();
    }
    if (s.gameOver) hits.flush();
  }
  function onEvent(e: GrEvent, s: GrState): void {
    SOUNDS[e.what]();
    if (e.what === 'in' || e.what === 'vip') {
      dancers.push({ panel: e.panel, x: laneX(e.lane) + ((fnv1a(`d:${e.seq}`) % 60) - 30), t0: performance.now(), vip: e.what === 'vip' });
      if (dancers.length > 14) dancers.shift();
      if (e.what === 'vip') burst(laneX(e.lane), GATE_Y, 26);
    }
    if (e.what === 'caught' && !practice) hits.add(e.panel);
    if (e.what === 'crash' || e.what === 'snub' || e.what === 'angry') { shake = 1; flash = 1; }
    if ((e.what === 'in' || e.what === 'vip' || e.what === 'caught') && s.play.combo > 0 && s.play.combo % RULES.comboEvery === 0) {
      const step = s.play.combo / RULES.comboEvery;
      if (step < COMBO_BANNERS.length) { banner = { text: COMBO_BANNERS[step] as string, t0: performance.now(), gold: true }; burst(W / 2, 300, 34); }
    }
  }
  /** The state shown: the latest one, brought to the estimated server tick by the rules themselves. */
  function catchUp(): void {
    if (!view || mode !== 'play') return;
    const tick = Math.max(view.tick, io.estimatedTick());
    if (shown && tick === nowTick && shown !== null) return;
    if (tick !== nowTick) tickAt = performance.now();
    nowTick = tick;
    shown = tick > view.tick ? engine.advance(view, tick) : view;
    follow(shown);
  }

  /* --------------------------------- drawing -------------------------------- */
  let backdrop: HTMLCanvasElement | null = null;
  /** The lanes in front of the wall: the names, faint, then three carpets. */
  function lanesBackdrop(): HTMLCanvasElement {
    if (backdrop) return backdrop;
    const c = document.createElement('canvas'); c.width = W * DPR; c.height = H * DPR;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.scale(DPR, DPR);
    g.fillStyle = CONCRETE; g.fillRect(0, 0, W, H);
    const names = WALL_PANELS.map((p) => p.n.toUpperCase());
    g.font = `11px ${F_ANTON}`; g.fillStyle = FAINT; g.textBaseline = 'top';
    let i = 0;
    for (let y = HUD_H + 4; y < FY0 - 6; y += 13) {
      let x = -((y * 7) % 40);
      while (x < W) { const n = names[i++ % names.length] as string; g.fillText(n, x, y); x += g.measureText(n).width + 10; }
    }
    for (let l = 0; l < LANES; l++) {
      g.fillStyle = l % 2 ? '#D5D1C7' : '#D9D5CC'; g.fillRect(l * LANE_W + 6, FY0 - 30, LANE_W - 12, GATE_Y - FY0 + 30);
      g.fillStyle = 'rgba(11,11,11,.06)';
      for (let y = FY0 - 20; y < GATE_Y; y += 28) g.fillRect(l * LANE_W + 10, y, LANE_W - 20, 2);
    }
    // the rope lines between lanes
    g.fillStyle = INK;
    for (let l = 1; l < LANES; l++) { g.fillRect(l * LANE_W - 2, FY0 - 30, 4, GATE_Y - FY0 + 30); }
    backdrop = c;
    return c;
  }

  function heart(x: number, y: number, full: boolean): void {
    const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
    ctx.fillStyle = full ? RED : '#3A3936';
    rows.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === '1') ctx.fillRect(x + rx * 3, y + ry * 3, 3, 3); });
  }
  function hud(s: GrState | null): void {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, HUD_H);
    if (!s) { text('GATE RUSH', W / 2, 48, `40px ${F_ANTON}`, CHALK); return; }
    const end = engine.endTickOf(s), open = openTick(s);
    const secs = Math.ceil(Math.max(0, end - Math.max(nowTick, open)) * TICK_MS / 1000);
    const urgent = nowTick >= open && secs <= 10 && !s.gameOver;
    text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W / 2, 30, `34px ${F_ANTON}`, urgent ? GOLD : CHALK);
    // the rush speeds up all along: how much faster than at the opening
    const speed = engine.speedAt(s, Math.max(nowTick, open)) / RULES.speedStart;
    text(`SPEED ×${speed.toFixed(1)}`, W / 2, 64, `500 11px ${F_MONO}`, speed >= 1.8 ? GOLD : '#B0ACA2');
    for (let i = 0; i < RULES.hearts; i++) heart(W - 38 - i * 28, 22, i < s.play.hearts);
    text(fmtScore(s.play.score), 14, 72, `30px ${F_ANTON}`, CHALK, 'left');
    const mult = engine.multOf(s.play.combo);
    if (s.play.combo >= 3) text(`${mult > 1 ? `×${mult} · ` : ''}${s.play.combo} IN A ROW`, W - 14, 72, `500 12px ${F_MONO}`, mult > 1 ? GOLD : '#B0ACA2', 'right');
    if (nowTick >= open && !s.gameOver) {
      const wave = engine.waveAt(s, nowTick);
      if (wave !== lastWave) { banner = { text: WAVE_BANNERS[wave] as string, t0: performance.now(), gold: wave === RULES.weights.length - 1 }; lastWave = wave; }
    }
  }

  /** The badge over a head says who they are: a blue wristband, a gold crown, sunglasses, a red wristband. */
  function badge(kind: Kind, cx: number, top: number, now: number, glow = true): void {
    const y = top - 12;
    if (kind === 'guest' || kind === 'fake') {
      ctx.fillStyle = kind === 'guest' ? BLUE : RED;
      ctx.fillRect(cx - 12, y - 5, 24, 10); ctx.fillStyle = CHALK; ctx.fillRect(cx - 3, y - 2, 6, 4);
    } else if (kind === 'vip') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.moveTo(cx - 13, y + 6); ctx.lineTo(cx - 13, y - 6); ctx.lineTo(cx - 6, y); ctx.lineTo(cx, y - 9); ctx.lineTo(cx + 6, y); ctx.lineTo(cx + 13, y - 6); ctx.lineTo(cx + 13, y + 6); ctx.closePath(); ctx.fill();
      if (glow) { ctx.fillStyle = `rgba(217,166,46,${(0.25 * pulse).toFixed(3)})`; ctx.beginPath(); ctx.arc(cx, top + SIZE / 2, SIZE * 0.62, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function shades(cx: number, top: number): void {
    const y = top + SIZE * 0.24;
    ctx.fillStyle = INK; ctx.fillRect(cx - 13, y, 11, 6); ctx.fillRect(cx + 2, y, 11, 6); ctx.fillRect(cx - 2, y + 1, 4, 2);
  }
  function person(p: Person, frac: number, now: number): void {
    const walking = p.wait < 0;
    const y = walking ? Math.min(LINE - 1, p.y + p.v * frac) : p.y;
    const cx = laneX(p.lane), feet = feetY(y), top = feet - SIZE;
    if (p.kind === 'vip') badge('vip', cx, top, now);          // the glow sits behind
    const name = nameOfPanel(p.panel);
    drawPerson(ctx, name, cx - SIZE / 2, top, SIZE, walking ? stepAt(now + p.id * 37) : 0, DIR.DOWN);
    if (isCrasher(p.kind) && p.kind !== 'fake') shades(cx, top);
    if (p.kind === 'runner') { ctx.fillStyle = 'rgba(11,11,11,.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(cx - 18 + k * 14, top - 20 - k * 4, 3, 14); }
    if (p.kind === 'jumper' && p.sw >= 0) text(p.sw > p.lane ? '↘' : '↙', cx + 24, top + 10, `16px ${F_MONO}`, INK);
    if (p.kind !== 'vip') badge(p.kind, cx, top, now);
    if (!walking) text('…', cx + 20, top - 4, `500 14px ${F_MONO}`, RED);
    ctx.font = fitFont(name, LANE_W - 22, 10, F_MONO);
    text(name, cx, feet + 7, ctx.font, LABEL);
  }

  function gates(s: GrState, now: number): void {
    for (let l = 0; l < LANES; l++) {
      const x0 = l * LANE_W + 8, x1 = (l + 1) * LANE_W - 8;
      const until = s.play.shut[l] as number, shut = nowTick < until;
      ctx.fillStyle = INK; ctx.fillRect(x0 - 2, GATE_Y - 18, 8, 34); ctx.fillRect(x1 - 6, GATE_Y - 18, 8, 34);
      if (shut) {
        const left = Math.max(0, Math.min(1, (until - nowTick) / RULES.shutTicks));
        ctx.fillStyle = RED; ctx.fillRect(x0 + 6, GATE_Y - 6, x1 - x0 - 12, 12);
        ctx.fillStyle = CHALK; ctx.fillRect(x0 + 6, GATE_Y - 1, (x1 - x0 - 12) * left, 2);
      } else {
        ctx.fillStyle = BLUE; ctx.fillRect(x0 + 6, GATE_Y - 16, 6, 22); ctx.fillRect(x1 - 12, GATE_Y - 16, 6, 22);
      }
      const t = (now - (pressed[l] as number)) / 200;
      if (t < 1) { ctx.fillStyle = `rgba(214,69,50,${(0.25 * (1 - t)).toFixed(3)})`; ctx.fillRect(l * LANE_W, HUD_H, LANE_W, GATE_Y - HUD_H + 20); }
    }
  }

  function dancefloor(now: number): void {
    ctx.fillStyle = FLOOR; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    for (let i = 0; i < 7; i++) {                                // the lights
      const c = [BLUE, GOLD, RED][i % 3] as string, x = ((i * 67 + now / 9) % (W + 80)) - 40;
      ctx.fillStyle = c; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(x, FLOOR_Y + 60 + (i % 3) * 40, 46, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    text('INSIDE', 12, FLOOR_Y + 14, `500 11px ${F_MONO}`, '#8C8A84', 'left');
    dancers.forEach((d, i) => {
      const t = (now - d.t0) / 1000, size = 46;
      const row = i % 2, x = Math.max(8, Math.min(W - size - 8, d.x - size / 2 + Math.sin(now / 400 + i) * 6));
      const y = FLOOR_Y + 30 + row * 64 - Math.abs(Math.sin(now / 180 + i)) * (t < 0.5 ? 14 : 6);
      drawPerson(ctx, nameOfPanel(d.panel), x, y, size, stepAt(now + i * 90), DIR.DOWN);
      if (d.vip) { ctx.fillStyle = GOLD; ctx.fillRect(x + size / 2 - 8, y - 6, 16, 5); }
    });
  }

  /** A speech bubble whose tail points down at (x, y). */
  function bubble(say: string, x: number, y: number, loud: boolean, alpha: number): void {
    ctx.globalAlpha = alpha;
    ctx.font = `500 12px ${F_MONO}`;
    const w = Math.min(W - 16, ctx.measureText(say).width + 16), h = 24;
    const bx = Math.max(6, Math.min(W - 6 - w, x - w / 2)), by = y - h - 7;
    ctx.fillStyle = loud ? INK : CHALK; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(bx, by, w, h); ctx.moveTo(x - 5, by + h); ctx.lineTo(x, y); ctx.lineTo(x + 5, by + h); ctx.fill(); ctx.stroke();
    ctx.fillRect(x - 4, by + h - 2, 8, 3);
    text(say, bx + w / 2, by + h / 2 + 1, ctx.font, loud ? CHALK : INK);
    ctx.globalAlpha = 1;
  }
  function popups(now: number): void {
    for (const p of pops) {
      const t = (now - p.t0) / 1100;
      if (t >= 1) continue;
      const x = laneX(p.lane), alpha = 1 - Math.max(0, t - 0.7) / 0.3;
      const loud = p.what === 'crash' || p.what === 'snub' || p.what === 'angry';
      // every 'in' would be noise: one guest in three speaks
      if (p.what !== 'in' || fnv1a(`s:${p.seq}`) % 3 === 0) bubble(pick(SAYS[p.what], `${p.what}:${p.seq}`), x, GATE_Y - 40 - t * 20, loud, alpha);
      const tag = p.what === 'crash' ? '−♥' : p.what === 'snub' || p.what === 'angry' ? '−♥' : p.gain > 0 ? `+${p.gain}` : '';
      if (tag) { ctx.globalAlpha = alpha; text(tag, x, GATE_Y + 24 - t * 16, `22px ${F_ANTON}`, loud ? RED : p.what === 'vip' ? GOLD : CHALK); ctx.globalAlpha = 1; }
    }
  }
  function banners(now: number): void {
    if (!banner) return;
    const t = (now - banner.t0) / 1400;
    if (t >= 1) { banner = null; return; }
    const pop = Math.min(1, t * 8);
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, t - 0.75) / 0.25;
    ctx.translate(W / 2, 300); ctx.rotate(-0.06); ctx.scale(pop, pop);
    ctx.font = fitFont(banner.text, W - 60, 40, F_ANTON);
    const w = ctx.measureText(banner.text).width + 36;
    ctx.fillStyle = banner.gold ? GOLD : INK; ctx.fillRect(-w / 2, -32, w, 64);
    text(banner.text, 0, 1, ctx.font, banner.gold ? INK : CHALK);
    ctx.restore();
  }
  function legendRow(y: number, draw: () => void, words: string): void {
    draw();
    text(words, 160, y, `500 14px ${F_MONO}`, INK, 'left');
  }
  function countdown(s: GrState, now: number): void {
    const left = openTick(s) - nowTick;
    if (left <= 0 || s.gameOver) return;
    ctx.fillStyle = 'rgba(222,219,211,.92)'; ctx.fillRect(0, HUD_H, W, H - HUD_H);
    text(String(Math.ceil(left * TICK_MS / 1000)), W / 2, 200, `110px ${F_ANTON}`, BLUE);
    text('TAP A LANE TO SLAM ITS GATE', W / 2, 290, `26px ${F_ANTON}`, INK);
    legendRow(350, () => badge('guest', 120, 362, now), 'let them in');
    legendRow(400, () => badge('vip', 120, 412, now, false), 'VIP: never stop them');
    legendRow(450, () => { ctx.fillStyle = SKIN[0] as string; ctx.fillRect(106, 436, 28, 26); shades(120, 450 - SIZE * 0.24 - 9); }, 'gatecrasher: SLAM!');
    legendRow(500, () => badge('fake', 120, 512, now), 'fake band: SLAM!');
    text('3 hearts · 90 seconds · faster and faster', W / 2, 560, `500 13px ${F_MONO}`, LABEL);
    const n = Math.ceil(left * TICK_MS / 1000);
    if (n !== lastCount) { lastCount = n; beep([440], 0.05, 'sine'); }
  }

  function draw(now: number): void {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = CONCRETE; ctx.fillRect(0, 0, W, H);
    if (mode === 'end') return;                          // the end panel and the page's bar cover the stage
    const s = mode === 'idle' ? null : shown;
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 6 * shake);
    ctx.drawImage(lanesBackdrop(), 0, 0, W * DPR, H * DPR, 0, 0, W, H);
    if (s && mode === 'play') {
      const frac = Math.max(0, Math.min(1, (now - tickAt) / TICK_MS));
      const crowd = [...s.play.people].sort((a, b) => a.y - b.y);
      for (const p of crowd) person(p, s.gameOver ? 0 : frac, now);
      gates(s, now);
      dancefloor(now);
      popups(now);
      hud(s);
      banners(now);
      countdown(s, now);
      if (s.gameOver) {
        ctx.fillStyle = 'rgba(222,219,211,.88)'; ctx.fillRect(0, 380, W, 160);
        text(s.play.end === 'shut' ? 'GATE DOWN' : 'YOU HELD THE GATE!', W / 2, 440, fitFont(s.play.end === 'shut' ? 'GATE DOWN' : 'YOU HELD THE GATE!', W - 40, 56, F_ANTON), s.play.end === 'shut' ? RED : BLUE);
        if (s.play.bonus) text(`SURVIVAL BONUS +${fmtScore(s.play.bonus)}`, W / 2, 500, `500 14px ${F_MONO}`, INK);
      }
    } else {
      // the entry: a quiet rush behind the page's own overlay
      for (let l = 0; l < LANES; l++) {
        const y = ((now / 1.2 + l * 3300) % LINE);
        const name = nameOfPanel(WALL_PANELS[(Math.floor(now / 4000) * 3 + l) % WALL_PANELS.length]?.p ?? 1);
        drawPerson(ctx, name, laneX(l) - SIZE / 2, feetY(y) - SIZE, SIZE, stepAt(now + l * 50), DIR.DOWN);
      }
      dancefloor(now);
      hud(null);
    }
    for (const b of bits) { ctx.globalAlpha = Math.min(1, b.life); ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.s, b.s * 0.6); }
    ctx.globalAlpha = 1;
    if (flash > 0) { ctx.fillStyle = `rgba(214,69,50,${(flash * 0.25).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  /* ------------------------------- end screen ------------------------------- */
  /** The end card, 1080 × 1080, drawn here (the same picture a screenshot shares). */
  function endCard(s: GrState | null, score: number): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = CONCRETE; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = INK; g.fillRect(0, 0, 1080, 140);
    text('GATE RUSH', 60, 72, `80px ${F_ANTON}`, CHALK, 'left', g);
    text(practice ? 'PRACTICE' : 'NFC SUMMIT 2027', 1020, 72, `500 26px ${F_MONO}`, practice ? BLUE : '#B0ACA2', 'right', g);
    const p = s?.play;
    if (p) {
      const t = gatekeeperTitle(p);
      text('YOUR GATEKEEPER TITLE', 64, 196, `500 24px ${F_MONO}`, LABEL, 'left', g);
      text(t.title, 58, 270, fitFont(t.title, 960, 104, F_ANTON, g), t.good ? BLUE : RED, 'left', g);
      text(t.line, 64, 348, `500 28px ${F_MONO}`, INK, 'left', g);
    }
    g.fillStyle = 'rgba(11,11,11,.12)'; g.fillRect(60, 392, 960, 2);
    text(fmtScore(score), 58, 470, `100px ${F_ANTON}`, INK, 'left', g);
    g.font = `100px ${F_ANTON}`;
    const sw = g.measureText(fmtScore(score)).width;
    const rank = practice ? undefined : rankOf(endStats?.rank);
    text(`POINTS${rank ? ` · #${rank} THIS WEEK` : ''}`, 58 + sw + 24, 494, `500 26px ${F_MONO}`, LABEL, 'left', g);
    if (p) {
      text(`${p.passed} ${p.passed === 1 ? 'PERSON' : 'PEOPLE'} OF THE WALL GOT IN · ${p.caught} CAUGHT`, 60, 580, fitFont(`${p.passed} PEOPLE OF THE WALL GOT IN · ${p.caught} CAUGHT`, 960, 44, F_ANTON, g), INK, 'left', g);
      g.fillStyle = FLOOR; g.fillRect(60, 616, 960, 230);
      const names = [...p.inList].reverse().slice(0, 6).map(nameOfPanel);
      names.forEach((n, i) => {
        const x = 70 + i * 158;
        drawPerson(g, n, x + 17, 630, 124, 0, DIR.DOWN);
        g.font = fitFont(n, 148, 24, F_ANTON, g);
        text(n, x + 79, 800, g.font, CHALK, 'center', g);
      });
    }
    const player = endStats?.player;                    // an ENS name only: an address says nothing on a card
    if (player && !/^0x[0-9a-f]{40}$/i.test(player)) text(player, 60, 910, `500 28px ${F_MONO}`, INK, 'left', g);
    g.fillStyle = INK; g.fillRect(0, 980, 1080, 100);
    text('A REMIX THE WALL EXPERIMENT · NFC SUMMIT 2027 · LISBON', 540, 1030, `500 24px ${F_MONO}`, CHALK, 'center', g);
    return c;
  }
  function renderEnd(): void {
    const s = shown ?? view;
    const score = finalScore ?? s?.play.score ?? 0;
    const card = endCard(s, score);
    card.className = 'end-card';
    card.setAttribute('role', 'img');
    card.setAttribute('aria-label', `Your card: ${score} points, ${s?.play.passed ?? 0} people of the wall got in.`);
    const nodes: HTMLElement[] = [card];
    if (!practice && s) {
      const gameUrl = `${location.origin}/`;
      const panels = [...new Set([...s.play.inList].reverse())];
      const tags = panels.map((panel) => tag(SNAPSHOT_NAME.get(panel)?.n ?? '', handleOf(panel))).filter(Boolean);
      const title = gatekeeperTitle(s.play).title, passed = s.play.passed;
      const tweet = fitTweet(tags, (names, more) => `I'm ${title} at the gate of NFC Summit 2027: ${score} points on GATE RUSH, ${passed} ${passed === 1 ? 'person' : 'people'} of the wall got in.${names ? ` You're on the list: ${names}${more ? ' …' : ''}` : ''} ${gameUrl}`, gameUrl);
      const post = document.createElement('a');
      post.className = 'end-post'; post.target = '_blank'; post.rel = 'noopener';
      post.href = intentHref(tweet); post.textContent = 'Post on X';
      nodes.push(post);
    }
    const wall = document.createElement('a');
    wall.className = 'end-wall'; wall.href = 'https://onthewall.nfcsummit.com'; wall.target = '_blank'; wall.rel = 'noopener';
    wall.textContent = 'get on the wall';
    nodes.push(wall);
    endPanel.replaceChildren(...nodes);
  }

  /* ---------------------------- layout and main loop ------------------------ */
  const frameEl = host.parentElement ?? host;
  function layout(): void {
    const availW = frameEl.clientWidth || W, availH = frameEl.clientHeight || H;
    const cssW = Math.max(220, Math.floor(Math.min(availW, availH * W / H)));
    const cssH = Math.floor(cssW * H / W);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    host.style.width = `${cssW}px`; host.style.height = `${cssH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    DPR = canvas.width / W;
    backdrop = null; dirty = true;
  }
  new ResizeObserver(() => layout()).observe(frameEl);
  layout();
  void Promise.race([
    Promise.all([document.fonts.load('40px Anton'), document.fonts.load('500 12px "IBM Plex Mono"')]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]).then(() => { backdrop = null; dirty = true; }).catch(() => undefined);

  let lastFrame = performance.now(), idleT = 0;
  function frame(t: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - lastFrame) / 1000); lastFrame = t;
    if (shake > 0.05) shake *= Math.pow(0.004, dt); else shake = 0;
    if (flash > 0) flash = Math.max(0, flash - dt * 3);
    for (const b of bits) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 520 * dt; b.life -= dt; }
    if (bits.length) bits = bits.filter((b) => b.life > 0);
    if (mode === 'play') { catchUp(); draw(t); }
    else if (mode === 'idle' && t - idleT > 60) { idleT = t; draw(t); }
    else if (dirty) { draw(t); dirty = false; }
  }
  requestAnimationFrame(frame);

  /* -------------------------------- Stage API ------------------------------- */
  return {
    setMessage(_text: string, extra?: { final?: number; view?: unknown; practice?: boolean; idle?: boolean }): void {
      dirty = true;
      if (extra?.idle) { mode = 'idle'; endPanel.hidden = true; return; }
      if (extra && typeof extra.final === 'number') {
        finalScore = extra.final;
        practice = Boolean(extra.practice);
        if (extra.view && typeof extra.view === 'object' && !view) { view = extra.view as GrState; shown = view; }
        mode = 'end';
        hits.flush();
        renderEnd(); endPanel.hidden = false;
      } else if (mode !== 'end') { mode = 'idle'; endPanel.hidden = true; }
    },
    hideRun(): void {
      if (mode !== 'play') return;
      mode = view?.gameOver ? 'end' : 'idle';
      if (mode === 'end') { renderEnd(); endPanel.hidden = false; }
      dirty = true;
    },
    endStats(stats: EndStats): void {
      endStats = stats;
      if (mode === 'end') renderEnd();
    },
    showRun(next: GrState, info): void {
      const nextPractice = Boolean(info.practice);
      if (mode !== 'play' || nextPractice !== practice || (view && view.seed !== next.seed)) {
        reset(nextPractice); mode = 'play'; endPanel.hidden = true;
      }
      if (next !== view) { view = next; shown = null; nowTick = -1; }
      catchUp();
    },
  };
}

export const gateRushAdapter: GameAdapter = {
  id: 'gate-rush',
  title: 'GATE RUSH',
  heading: 'Hold the gate',
  tagline: 'The people of the wall rush the gate of NFC Summit. Let the wristbands in, slam the gate on the gatecrashers. 90 seconds.',
  lede: 'The people of the wall rush the gate of NFC Summit 2027 down three lanes. Tap a lane to slam its turnstile shut for one second. A blue wristband gets in: let them through. A gold crown is a VIP: never stop them. Sunglasses or a red (fake) wristband is a gatecrasher: slam the gate and they are caught. A crasher who gets in, a VIP you stop or a guest kept waiting too long costs a heart; three hearts and the gate is down. The rush gets faster every second, all the way to the end; waves bring VIPs, runners, lane jumpers and fake wristbands; catches and entries in a row multiply your points. Hold the gate for 90 seconds for a big bonus. One credit per run, scored by the server.',
  stateSchema: stateSchema as never,
  snapshotSchema: snapshotSchema as never,
  parseSavedRound: createSavedRoundParser(stateSchema as never, inputSchema as never),
  applyInput: (state: GrState, input: unknown, tick: number) => engine.applyInput(state, input, tick),
  scoreOf: (state: GrState) => state.play.score,
  statusLine(state: GrState, tick: number): string {
    if (state.gameOver) return 'Waiting for the platform’s recorded result…';
    if (!state.started) return 'Starting your server-validated round…';
    const open = engine.openTickOf(state);
    if (tick < open) return `Gates open in ${Math.ceil((open - tick) * TICK_MS / 1000)}`;
    const left = Math.max(0, engine.endTickOf(state) - tick) * TICK_MS / 1000;
    return `Score ${state.play.score} · hearts ${state.play.hearts}/${RULES.hearts} · ${Math.ceil(left)} s left`;
  },
  createStage,
  diagSummary: (s: GrState) => ({ tick: s.tick, started: s.started, startTick: s.startTick, gameOver: s.gameOver, score: s.play.score, hearts: s.play.hearts, people: s.play.people.length, shut: s.play.shut, last: s.play.events.at(-1) ?? null }),
  practice: {
    createRun: (seed: number) => engine.createRun(seed, scoringConfiguration('gate-rush')),
    advance: (state: GrState, tick: number) => engine.advance(state, tick),
  },
};
