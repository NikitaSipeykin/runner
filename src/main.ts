import {
  Application,
  Assets,
  Sprite,
  AnimatedSprite,
  Texture,
  Rectangle,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";

// Глобальный перехват ошибок — показываем их на экране
window.addEventListener("unhandledrejection", (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:12px;white-space:pre-wrap;">
ОШИБКА: ${e.reason?.message || e.reason}
${e.reason?.stack || ""}
  </pre>`;
});
window.addEventListener("error", (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:12px;white-space:pre-wrap;">
ОШИБКА: ${e.message} (${e.filename}:${e.lineno})
  </pre>`;
});

// ═══════════════════════════════════════════════════════════
// LAYOUT — все позиции здесь
// ═══════════════════════════════════════════════════════════
const W = 390;
const H = 844;

// Земля персонажа и врагов (нижний край спрайта anchor=1)
const CHAR_Y = 760;

// Трава — полоса поверх фона
const GRASS_Y = 720; // верх травяной полосы
const GRASS_COLOR = 0x4a7c3f;
const GRASS_H = H - GRASS_Y; // высота полосы до низа экрана

// Горизонтальные позиции X
const PLAYER_X = 85; // X игрока
const OBS_SPAWN_X = W + 60; // X спавна препятствий

// Параллакс фон: 3 слоя 320×180
const BG_LAYERS = [
  { key: "bg1", spd: 0.4 },
  { key: "bg2", spd: 0.9 },
  { key: "bg3", spd: 1.6 },
];

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const GRAVITY = 0.58;
const JUMP_V = -15.5;
const JUMP2_V = -13.0;
const BASE_SPD = 4.5;
const WIN_DIST = 500; // метров до финиша
const ENEMY_ANIM_SPD = 0.07; // смена кадров гоблина (медленнее = плавнее)

// char_blue.png: 448×392, 8 cols × 7 rows → frame 56×56
const CHAR_FW = 56;
const CHAR_FH = 56;
const CHAR_COLS = 8;
const CHAR_SCALE = 2.2; // 56 * 2.2 ≈ 123px

// Row mapping:
const ROW_IDLE = 0; // idle (меню / пауза)
// row 1 = attack — скипаем
const ROW_RUN = 2; // бег
const ROW_JUMP = 3; // прыжок (взлёт, vy < 0)
const ROW_FALL = 4; // падение (vy > 0)
const ROW_DEATH1 = 5; // смерть часть 1
const ROW_DEATH2 = 6; // смерть часть 2

// Enemy: 1682×1771, 9 cols × 5 rows → frame 186×354
// Enemy: Run.png 1200×150 (8 cols), Idle.png 600×150 (4 cols) → frame 150×150
const ENEMY_RUN_COLS = 8;
const ENEMY_IDLE_COLS = 4;
const ENEMY_FW = 150;
const ENEMY_FH = 150;
// Реальный контент гоблина: rows 64–100 = 37px высотой
// Чтобы гоблин был ~110px (как игрок): scale = 110/37 ≈ 3.0
const ENEMY_SCALE = 3.0;
// anchor.y = 100/150 = 0.667 ставит реальные ноги точно на CHAR_Y
const ENEMY_ANCHOR_Y = 100 / 150; // 0.667

// ═══════════════════════════════════════════════════════════
// MAIN — всё в async функции (top-level await не везде работает)
// ═══════════════════════════════════════════════════════════
async function main() {
  // ═══════════════════════════════════════════════════════════
  // APP
  // ═══════════════════════════════════════════════════════════
  const app = new Application();
  await app.init({
    width: W,
    height: H,
    backgroundColor: 0x87ceeb,
    resolution: 1,
    antialias: true,
  });
  const container = document.getElementById("pixi-container")!;
  container.appendChild(app.canvas);
  // Сбрасываем инлайн-размеры которые ставит Pixi, CSS возьмёт управление
  app.canvas.style.width = W + "px";
  app.canvas.style.height = H + "px";

  // ═══════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════
  const ASSET_LIST = [
    { alias: "character", src: "/assets/char_blue.png" },
    { alias: "enemy_run", src: "/assets/Run.png" },
    { alias: "enemy_idle", src: "/assets/Idle.png" },
    { alias: "bg1", src: "/assets/background_layer_1.png" },
    { alias: "bg2", src: "/assets/background_layer_2.png" },
    { alias: "bg3", src: "/assets/background_layer_3.png" },
    { alias: "coin", src: "/assets/MonedaD.png" },
    { alias: "fail", src: "/assets/fail.png" },
    { alias: "hand", src: "/assets/hand.png" },
    { alias: "adfooter", src: "/assets/adfooter.webp" },
  ];
  for (const a of ASSET_LIST) Assets.add(a);
  const T = await Assets.load(ASSET_LIST.map((a) => a.alias));

  // ═══════════════════════════════════════════════════════════
  // FRAME HELPERS
  // ═══════════════════════════════════════════════════════════
  function charFrames(row: number, count = CHAR_COLS): Texture[] {
    const src = T["character"].source;
    return Array.from(
      { length: count },
      (_, i) =>
        new Texture({
          source: src,
          frame: new Rectangle(i * CHAR_FW, row * CHAR_FH, CHAR_FW, CHAR_FH),
        }),
    );
  }

  function enemyRunFrames(): Texture[] {
    const src = T["enemy_run"].source;
    return Array.from(
      { length: ENEMY_RUN_COLS },
      (_, i) =>
        new Texture({
          source: src,
          frame: new Rectangle(i * ENEMY_FW, 0, ENEMY_FW, ENEMY_FH),
        }),
    );
  }

  function enemyIdleFrames(): Texture[] {
    const src = T["enemy_idle"].source;
    return Array.from(
      { length: ENEMY_IDLE_COLS },
      (_, i) =>
        new Texture({
          source: src,
          frame: new Rectangle(i * ENEMY_FW, 0, ENEMY_FW, ENEMY_FH),
        }),
    );
  }

  // MonedaD.png: 80×16, 5 cols → frame 16×16
  const COIN_COLS = 5;
  const COIN_FW = 16;
  const COIN_FH = 16;
  const COIN_SCALE = 3.5; // 16 * 3.5 = 56px

  function coinFrames(): Texture[] {
    const src = T["coin"].source;
    return Array.from(
      { length: COIN_COLS },
      (_, i) =>
        new Texture({
          source: src,
          frame: new Rectangle(i * COIN_FW, 0, COIN_FW, COIN_FH),
        }),
    );
  }

  function makeCharAnim(row: number, spd = 0.15): AnimatedSprite {
    const a = new AnimatedSprite(charFrames(row));
    a.animationSpeed = spd;
    a.anchor.set(0.5, 1);
    a.scale.set(CHAR_SCALE);
    a.play();
    return a;
  }

  // ═══════════════════════════════════════════════════════════
  // LAYERS
  // ═══════════════════════════════════════════════════════════
  const bgLayer = new Container();
  const gameLayer = new Container();
  const fxLayer = new Container();
  const uiLayer = new Container();
  app.stage.addChild(bgLayer, gameLayer, fxLayer, uiLayer);

  // ═══════════════════════════════════════════════════════════
  // PARALLAX BACKGROUND — 3 слоя 320×180, масштаб по высоте H
  // ═══════════════════════════════════════════════════════════
  const BG_SCALE = H / 180; // 844/180 ≈ 4.69
  const BG_W = Math.round(320 * BG_SCALE); // ~1502px

  interface BgLayer {
    sprites: Sprite[];
    spd: number;
  }
  const bgLayers: BgLayer[] = [];

  for (const cfg of BG_LAYERS) {
    const sprites: Sprite[] = [];
    for (let i = 0; i < 2; i++) {
      const s = new Sprite(T[cfg.key]);
      s.scale.set(BG_SCALE);
      s.x = i * BG_W;
      s.y = 0;
      bgLayer.addChild(s);
      sprites.push(s);
    }
    bgLayers.push({ sprites, spd: cfg.spd });
  }

  // Трава — полоса от GRASS_Y до низа экрана
  const grassStrip = new Graphics()
    .rect(0, GRASS_Y, W, GRASS_H)
    .fill(GRASS_COLOR);
  const grassEdge = new Graphics().rect(0, GRASS_Y, W, 6).fill(0x3a6b2f);
  bgLayer.addChild(grassStrip, grassEdge);

  // Дорожная разметка — на траве
  const roadMarks: Graphics[] = [];
  for (let i = 0; i < 7; i++) {
    const m = new Graphics()
      .rect(0, 0, 36, 4)
      .fill({ color: 0xffffff, alpha: 0.25 });
    m.x = i * 68;
    m.y = GRASS_Y + 14;
    bgLayer.addChild(m);
    roadMarks.push(m);
  }

  // Ad banner
  const adSpr = new Sprite(T["adfooter"]);
  adSpr.width = W;
  adSpr.height = 56;
  adSpr.y = H - 56;
  uiLayer.addChild(adSpr);

  // ═══════════════════════════════════════════════════════════
  // GAME STATE
  // ═══════════════════════════════════════════════════════════
  type GameState = "menu" | "playing" | "dead" | "gameover" | "win";
  let state: GameState = "menu";
  let score = 0,
    distance = 0,
    lives = 3,
    speed = BASE_SPD;
  let bestScore = parseInt(localStorage.getItem("runnerBest") ?? "0");
  let obstTimer = 0,
    coinTimer = 0,
    stepTimer = 0;

  // ═══════════════════════════════════════════════════════════
  // AUDIO
  // ═══════════════════════════════════════════════════════════
  const bgMusic = new Audio("/assets/medieval-fantasy-142837.mp3");
  bgMusic.loop = true;
  bgMusic.volume = 0.45;

  // Браузер блокирует autoplay — запускаем при первом interaction
  let musicUnlocked = false;
  function unlockMusic() {
    if (musicUnlocked) return;
    musicUnlocked = true;
    bgMusic.play().catch(() => {});
  }
  document.addEventListener("touchstart", unlockMusic, { once: true });
  document.addEventListener("click", unlockMusic, { once: true });
  document.addEventListener("keydown", unlockMusic, { once: true });

  // Hurt и step — lowercase расширения для совместимости
  const sndHurt = new Audio("/assets/player_hurt.mp3");
  sndHurt.volume = 0.9;

  const sndStep = new Audio("/assets/step.mp3");
  sndStep.volume = 0.45;

  function playHurt() {
    const s = sndHurt.cloneNode() as HTMLAudioElement;
    s.volume = 0.9;
    s.play().catch(() => {});
  }

  function playStep() {
    const s = sndStep.cloneNode() as HTMLAudioElement;
    s.volume = 0.45;
    s.play().catch(() => {});
  }

  function stopMusic() {
    bgMusic.pause();
    bgMusic.currentTime = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // PLAYER
  // ═══════════════════════════════════════════════════════════
  const playerCont = new Container();
  gameLayer.addChild(playerCont);

  const shadow = new Graphics()
    .ellipse(0, 0, 28, 8)
    .fill({ color: 0x000000, alpha: 0.18 });
  gameLayer.addChildAt(shadow, 0);

  let playerAnim = makeCharAnim(ROW_RUN);
  playerCont.addChild(playerAnim);

  const pl = {
    x: PLAYER_X,
    y: CHAR_Y,
    vy: 0,
    onGround: true,
    jumps: 0,
    dead: false,
    invTimer: 0,
    sliding: false,
    slideTimer: 0,
    curRow: ROW_RUN,
    deathPhase: 0, // 0=не начата, 1=часть1, 2=часть2
  };

  function switchAnim(row: number, spd = 0.15) {
    if (pl.curRow === row) return;
    pl.curRow = row;
    playerCont.removeChild(playerAnim);
    playerAnim.destroy();
    playerAnim = makeCharAnim(row, spd);
    if (pl.sliding) {
      playerAnim.scale.y = CHAR_SCALE * 0.52;
      playerAnim.y = CHAR_FH * CHAR_SCALE * 0.32;
    }
    playerCont.addChild(playerAnim);
  }

  function doJump() {
    if (pl.dead) return;
    if (pl.sliding) {
      endSlide();
      return;
    }
    if (pl.onGround) {
      pl.vy = JUMP_V;
      pl.onGround = false;
      pl.jumps = 1;
      switchAnim(ROW_JUMP, 0.2);
      spawnDust(pl.x, CHAR_Y, 0x7ec850, 7);
    } else if (pl.jumps === 1) {
      pl.vy = JUMP2_V;
      pl.jumps = 2;
      spawnDust(pl.x, pl.y, 0xffd700, 10);
    }
  }

  function doSlide() {
    if (pl.dead || !pl.onGround || pl.sliding) return;
    pl.sliding = true;
    pl.slideTimer = 44;
    switchAnim(ROW_IDLE, 0.1);
    playerAnim.scale.y = CHAR_SCALE * 0.52;
    playerAnim.y = CHAR_FH * CHAR_SCALE * 0.32;
  }

  function endSlide() {
    pl.sliding = false;
    pl.slideTimer = 0;
    playerAnim.scale.y = CHAR_SCALE;
    playerAnim.y = 0;
    pl.curRow = -1;
    switchAnim(ROW_RUN);
  }

  function playerHitbox() {
    // Реальный контент: ~20x31px в кадре 56x56 → hw=0.37, hh=0.55
    const sk = pl.sliding ? 0.55 : 1.0;
    const pw = CHAR_FW * CHAR_SCALE * 0.37;
    const ph = CHAR_FH * CHAR_SCALE * 0.55 * sk;
    return { x: pl.x - pw / 2, y: pl.y - ph, w: pw, h: ph };
  }

  function updatePlayer(dt: number) {
    // Slide timer
    if (pl.slideTimer > 0) {
      pl.slideTimer -= dt;
      if (pl.slideTimer <= 0) endSlide();
    }

    // Анимация по состоянию
    if (!pl.dead && !pl.sliding) {
      if (pl.onGround) {
        if (pl.curRow !== ROW_RUN) {
          pl.curRow = -1;
          switchAnim(ROW_RUN);
        }
      } else {
        // В воздухе: vy < 0 = летим вверх (jump), vy > 0 = падаем (fall)
        const wantRow = pl.vy < 0 ? ROW_JUMP : ROW_FALL;
        if (pl.curRow !== wantRow) {
          pl.curRow = -1;
          switchAnim(wantRow, 0.18);
        }
      }
    }

    // Смерть — анимация в 2 части
    if (pl.dead) {
      if (pl.deathPhase === 0) {
        pl.deathPhase = 1;
        pl.curRow = -1;
        switchAnim(ROW_DEATH1, 0.14);
        // Через 8 кадров переключаем на part2
        setTimeout(() => {
          if (pl.dead) {
            pl.curRow = -1;
            switchAnim(ROW_DEATH2, 0.12);
            pl.deathPhase = 2;
          }
        }, 600);
      }
    }

    // Физика
    pl.vy += GRAVITY * dt;
    pl.y += pl.vy * dt;

    if (pl.y >= CHAR_Y) {
      pl.y = CHAR_Y;
      pl.vy = 0;
      if (!pl.onGround) {
        pl.onGround = true;
        pl.jumps = 0;
      }
    } else {
      pl.onGround = false;
    }

    // Мигание при неуязвимости
    if (pl.invTimer > 0) {
      pl.invTimer -= dt;
      playerCont.alpha = Math.sin(pl.invTimer * 0.35) > 0 ? 1 : 0.3;
    } else {
      playerCont.alpha = 1;
    }

    playerCont.x = pl.x;
    playerCont.y = pl.y;
    shadow.x = pl.x;
    shadow.y = CHAR_Y + 4;
    shadow.alpha = pl.onGround ? 0.18 : 0.06;
    shadow.scale.x = pl.onGround ? 1.0 : 0.6;
  }

  // ═══════════════════════════════════════════════════════════
  // OBSTACLES
  // ═══════════════════════════════════════════════════════════
  interface Obs {
    spr: Sprite | AnimatedSprite | null;
    active: boolean;
    hw: number;
    hh: number;
  }
  let obstacles: Obs[] = [];

  // hw/hh — доля от размера спрайта, соответствующая реальному контенту
  // Run:  content 25x35 из 150x150 → hw=0.17, hh=0.23
  // Idle: content 22x35 из 150x150 → hw=0.15, hh=0.23
  const obsCfgs = [
    { key: "idle_obs", hw: 0.15, hh: 0.23 },
    { key: "idle_obs", hw: 0.15, hh: 0.23 },
    { key: "enemy", hw: 0.17, hh: 0.23 },
    { key: "enemy", hw: 0.17, hh: 0.23 },
  ];

  function spawnObs() {
    if (distance < 10) return;
    const pool = distance < 40 ? [obsCfgs[0]] : obsCfgs;
    const cfg = pool[Math.floor(Math.random() * pool.length)];

    let spr: AnimatedSprite;
    if (cfg.key === "enemy") {
      spr = new AnimatedSprite(enemyRunFrames());
      spr.animationSpeed = ENEMY_ANIM_SPD;
    } else {
      spr = new AnimatedSprite(enemyIdleFrames());
      spr.animationSpeed = ENEMY_ANIM_SPD * 0.8;
      spr.scale.x = -ENEMY_SCALE;
    }
    spr.play();
    spr.anchor.set(0.5, ENEMY_ANCHOR_Y);
    // scale.x уже установлен выше для idle_obs, для enemy ставим обычный
    if (cfg.key === "enemy") {
      spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE); // зеркало — бежит влево на игрока
    } else {
      spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE);
    }
    spr.x = OBS_SPAWN_X;
    spr.y = CHAR_Y;
    gameLayer.addChild(spr);
    obstacles.push({ spr, active: true, hw: cfg.hw, hh: cfg.hh });
  }

  function obsHitbox(o: Obs) {
    const s = o.spr!;
    const w = s.width * o.hw,
      h = s.height * o.hh;
    return { x: s.x - w / 2, y: s.y - h, w, h };
  }

  function updateObs(dt: number) {
    for (const o of obstacles) {
      if (o.spr && o.active) o.spr.x -= speed * dt;
    }
    const toRemove = obstacles.filter(
      (o) => !o.active || (o.spr && o.spr.x < -200),
    );
    toRemove.forEach((o) => {
      if (o.spr) {
        gameLayer.removeChild(o.spr);
        o.spr.destroy();
        o.spr = null;
      }
    });
    obstacles = obstacles.filter((o) => o.spr !== null);
  }

  // ═══════════════════════════════════════════════════════════
  // COINS — анимированная монета MonedaD.png
  // ═══════════════════════════════════════════════════════════
  interface Coin {
    spr: AnimatedSprite | null;
    active: boolean;
    phase: number;
  }
  let coins: Coin[] = [];

  function spawnCoin() {
    const ys = [CHAR_Y - 50, CHAR_Y - 110, CHAR_Y - 180];
    const a = new AnimatedSprite(coinFrames());
    a.animationSpeed = 0.14;
    a.play();
    a.anchor.set(0.5);
    a.scale.set(COIN_SCALE);
    a.x = W + 30;
    a.y = ys[Math.floor(Math.random() * ys.length)];
    gameLayer.addChild(a);
    coins.push({ spr: a, active: true, phase: Math.random() * Math.PI * 2 });
  }

  function updateCoins(dt: number) {
    for (const c of coins) {
      if (!c.spr || !c.active) continue;
      c.spr.x -= speed * dt;
      c.phase += 0.04 * dt;
      c.spr.y += Math.sin(c.phase) * 0.35; // лёгкое покачивание
    }
    const toRemove = coins.filter((c) => !c.active || (c.spr && c.spr.x < -80));
    toRemove.forEach((c) => {
      if (c.spr) {
        gameLayer.removeChild(c.spr);
        c.spr.destroy();
        c.spr = null;
      }
    });
    coins = coins.filter((c) => c.spr !== null);
  }

  // ═══════════════════════════════════════════════════════════
  // PARTICLES
  // ═══════════════════════════════════════════════════════════
  interface Part {
    g: Graphics;
    vx: number;
    vy: number;
    life: number;
    max: number;
  }
  let parts: Part[] = [];

  function spawnDust(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().circle(0, 0, 3 + Math.random() * 3).fill(color);
      g.x = x + (Math.random() - 0.5) * 22;
      g.y = y;
      fxLayer.addChild(g);
      parts.push({
        g,
        vx: (Math.random() - 0.5) * 3.5,
        vy: -(Math.random() * 4 + 1),
        life: 22,
        max: 22,
      });
    }
  }

  function spawnHitFx(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const g = new Graphics()
        .circle(0, 0, 3 + Math.random() * 4)
        .fill(0xff3333);
      g.x = x;
      g.y = y;
      fxLayer.addChild(g);
      parts.push({
        g,
        vx: (Math.random() - 0.5) * 7,
        vy: -(Math.random() * 5 + 1),
        life: 28,
        max: 28,
      });
    }
  }

  function spawnCoinFx(x: number, y: number) {
    for (let i = 0; i < 8; i++) {
      const g = new Graphics().circle(0, 0, 4).fill(0xffd700);
      g.x = x;
      g.y = y;
      fxLayer.addChild(g);
      parts.push({
        g,
        vx: (Math.random() - 0.5) * 5,
        vy: -(Math.random() * 4 + 2),
        life: 20,
        max: 20,
      });
    }
  }

  function updateParts(dt: number) {
    for (const p of parts) {
      p.life -= dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vy += 0.18 * dt;
      p.g.alpha = Math.max(0, p.life / p.max);
    }
    parts
      .filter((p) => p.life <= 0)
      .forEach((p) => {
        fxLayer.removeChild(p.g);
        p.g.destroy();
      });
    parts = parts.filter((p) => p.life > 0);
  }

  // ═══════════════════════════════════════════════════════════
  // FLOATING TEXT
  // ═══════════════════════════════════════════════════════════
  interface FT {
    t: Text;
    vy: number;
    life: number;
    max: number;
  }
  let floats: FT[] = [];

  function floatText(x: number, y: number, txt: string, color = "#FFD700") {
    const t = new Text({
      text: txt,
      style: new TextStyle({
        fontFamily: "Arial Black",
        fontSize: 22,
        fontWeight: "bold",
        fill: color,
        stroke: { color: "#333", width: 3 },
      }),
    });
    t.anchor.set(0.5);
    t.x = x;
    t.y = y;
    uiLayer.addChild(t);
    floats.push({ t, vy: -2.2, life: 38, max: 38 });
  }

  function updateFloats(dt: number) {
    for (const f of floats) {
      f.life -= dt;
      f.t.y += f.vy * dt;
      f.vy *= 0.95;
      f.t.alpha = Math.max(0, f.life / f.max);
    }
    floats
      .filter((f) => f.life <= 0)
      .forEach((f) => {
        uiLayer.removeChild(f.t);
        f.t.destroy();
      });
    floats = floats.filter((f) => f.life > 0);
  }

  // ═══════════════════════════════════════════════════════════
  // FLASH
  // ═══════════════════════════════════════════════════════════
  const flashG = new Graphics().rect(0, 0, W, H).fill(0xff0000);
  flashG.alpha = 0;
  uiLayer.addChild(flashG);
  let flashT = 0;
  function doFlash(a = 0.42) {
    flashG.alpha = a;
    flashT = 14;
  }
  function updateFlash(dt: number) {
    if (flashT > 0) {
      flashT -= dt;
      flashG.alpha = Math.max(0, flashG.alpha - 0.045 * dt);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════
  const scoreText = new Text({
    text: "0",
    style: new TextStyle({
      fontFamily: "Arial Black,Impact,sans-serif",
      fontSize: 30,
      fontWeight: "bold",
      fill: "#fff",
      stroke: { color: "#333", width: 4 },
      dropShadow: { distance: 2, alpha: 0.5 },
    }),
  });
  scoreText.anchor.set(1, 0);
  scoreText.x = W - 16;
  scoreText.y = 20;
  uiLayer.addChild(scoreText);

  const distText = new Text({
    text: "0m",
    style: new TextStyle({
      fontFamily: "Arial,sans-serif",
      fontSize: 14,
      fill: "#fff",
      stroke: { color: "#333", width: 3 },
    }),
  });
  distText.anchor.set(1, 0);
  distText.x = W - 16;
  distText.y = 58;
  uiLayer.addChild(distText);

  const livesCont = new Container();
  livesCont.x = 16;
  livesCont.y = 20;
  uiLayer.addChild(livesCont);

  function refreshLives() {
    livesCont.removeChildren();
    for (let i = 0; i < 3; i++) {
      const h = new Text({
        text: i < lives ? "♥" : "♡",
        style: new TextStyle({
          fontSize: 24,
          fill: i < lives ? "#ff4466" : "#aaa",
        }),
      });
      h.x = i * 30;
      livesCont.addChild(h);
    }
  }

  function refreshScore() {
    scoreText.text = score.toString();
    distText.text = Math.floor(distance) + "m";
  }

  refreshLives();

  // ═══════════════════════════════════════════════════════════
  // COLLISION
  // ═══════════════════════════════════════════════════════════
  type Rect = { x: number; y: number; w: number; h: number };
  function overlaps(a: Rect, b: Rect) {
    return (
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    );
  }

  function checkCollisions() {
    if (pl.invTimer > 0 || pl.dead) return;
    const pb = playerHitbox();

    for (const o of obstacles) {
      if (!o.active || !o.spr) continue;
      if (overlaps(pb, obsHitbox(o))) {
        o.active = false;
        onHit();
        break;
      }
    }
    for (const c of coins) {
      if (!c.active || !c.spr) continue;
      const r = c.spr.width / 2 + 4;
      if (
        overlaps(pb, { x: c.spr.x - r, y: c.spr.y - r, w: r * 2, h: r * 2 })
      ) {
        c.active = false;
        score += 10;
        spawnCoinFx(c.spr.x, c.spr.y);
        floatText(c.spr.x, c.spr.y - 20, "+10");
        refreshScore();
      }
    }
  }

  function onHit() {
    lives--;
    refreshLives();
    playHurt();
    spawnHitFx(pl.x, pl.y - 80);
    doFlash();
    if (lives <= 0) {
      pl.dead = true;
      pl.vy = -8;
      pl.deathPhase = 0;
      state = "dead";
      setTimeout(showGameOver, 1800);
    } else {
      pl.invTimer = 95;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MENU
  // ═══════════════════════════════════════════════════════════
  let menuCont: Container | null = null;

  function showMenu() {
    state = "menu";
    menuCont = new Container();
    uiLayer.addChild(menuCont);

    menuCont.addChild(
      new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.38 }),
    );
    menuCont.addChild(
      new Graphics()
        .roundRect(W / 2 - 155, H / 2 - 200, 310, 230, 22)
        .fill({ color: 0xffffff, alpha: 0.97 }),
    );

    const title = new Text({
      text: "RUNNER",
      style: new TextStyle({
        fontFamily: "Arial Black,Impact,sans-serif",
        fontSize: 48,
        fontWeight: "900",
        fill: "#6c3fe8",
        stroke: { color: "#eee", width: 2 },
      }),
    });
    title.anchor.set(0.5);
    title.x = W / 2;
    title.y = H / 2 - 152;
    menuCont.addChild(title);

    const sub = new Text({
      text: "Tap to jump  ·  Swipe ↓ to slide",
      style: new TextStyle({
        fontFamily: "Arial,sans-serif",
        fontSize: 14,
        fill: "#888",
      }),
    });
    sub.anchor.set(0.5);
    sub.x = W / 2;
    sub.y = H / 2 - 94;
    menuCont.addChild(sub);

    if (bestScore > 0) {
      const bt = new Text({
        text: "BEST: " + bestScore,
        style: new TextStyle({
          fontFamily: "Arial,sans-serif",
          fontSize: 16,
          fill: "#555",
        }),
      });
      bt.anchor.set(0.5);
      bt.x = W / 2;
      bt.y = H / 2 - 62;
      menuCont.addChild(bt);
    }

    const btnBg = new Graphics()
      .roundRect(W / 2 - 110, H / 2 + 32, 220, 58, 29)
      .fill(0x6c3fe8);
    btnBg.interactive = true;
    btnBg.cursor = "pointer";
    btnBg.on("pointertap", startGame);
    menuCont.addChild(btnBg);

    const btnT = new Text({
      text: "PLAY!",
      style: new TextStyle({
        fontFamily: "Arial Black,sans-serif",
        fontSize: 24,
        fontWeight: "bold",
        fill: "#fff",
      }),
    });
    btnT.anchor.set(0.5);
    btnT.x = W / 2;
    btnT.y = H / 2 + 61;
    menuCont.addChild(btnT);

    const hand = new Sprite(T["hand"]);
    hand.anchor.set(0.5);
    hand.scale.set(0.075);
    hand.x = W / 2 + 72;
    hand.y = H / 2 + 68;
    menuCont.addChild(hand);

    let hp = 0;
    const tick = () => {
      if (state !== "menu") {
        app.ticker.remove(tick);
        return;
      }
      hp += 0.05;
      hand.y = H / 2 + 68 + Math.sin(hp) * 7;
      hand.rotation = Math.sin(hp * 0.5) * 0.08;
    };
    app.ticker.add(tick);
  }

  // ═══════════════════════════════════════════════════════════
  // WIN SCREEN
  // ═══════════════════════════════════════════════════════════
  let winCont: Container | null = null;

  function showWin() {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem("runnerBest", String(bestScore));
    }
    stopMusic();
    state = "gameover";
    winCont = new Container();
    uiLayer.addChild(winCont);

    winCont.addChild(
      new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.55 }),
    );

    // Золотой заголовок
    const title = new Text({
      text: "⚔ VICTORY! ⚔",
      style: new TextStyle({
        fontFamily: "Arial Black,Impact",
        fontSize: 36,
        fontWeight: "900",
        fill: "#ffd700",
        stroke: { color: "#7a4400", width: 5 },
        dropShadow: { distance: 3, alpha: 0.8 },
      }),
    });
    title.anchor.set(0.5);
    title.x = W / 2;
    title.y = H / 2 - 200;
    winCont.addChild(title);

    // Анимация пульсации заголовка
    let tp = 0;
    const tt = () => {
      if (state !== "gameover") {
        app.ticker.remove(tt);
        return;
      }
      tp += 0.05;
      title.scale.set(1 + Math.sin(tp) * 0.04);
    };
    app.ticker.add(tt);

    // Карточка результата
    winCont.addChild(
      new Graphics()
        .roundRect(W / 2 - 140, H / 2 - 130, 280, 200, 20)
        .fill({ color: 0xfff8e7, alpha: 0.97 }),
    );

    const lbl500 = new Text({
      text: "500m ЗАВЕРШЕНО!",
      style: new TextStyle({
        fontFamily: "Arial Black",
        fontSize: 16,
        fill: "#a05000",
      }),
    });
    lbl500.anchor.set(0.5);
    lbl500.x = W / 2;
    lbl500.y = H / 2 - 100;
    winCont.addChild(lbl500);

    const val = new Text({
      text: String(score),
      style: new TextStyle({
        fontFamily: "Arial Black,Impact",
        fontSize: 52,
        fontWeight: "900",
        fill: "#222",
      }),
    });
    val.anchor.set(0.5);
    val.x = W / 2;
    val.y = H / 2 - 40;
    winCont.addChild(val);

    const sub = new Text({
      text: "ОЧКОВ",
      style: new TextStyle({
        fontFamily: "Arial Black",
        fontSize: 14,
        fill: "#888",
      }),
    });
    sub.anchor.set(0.5);
    sub.x = W / 2;
    sub.y = H / 2 + 18;
    winCont.addChild(sub);

    const best = new Text({
      text: "РЕКОРД: " + bestScore,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 14, fill: "#888" }),
    });
    best.anchor.set(0.5);
    best.x = W / 2;
    best.y = H / 2 + 44;
    winCont.addChild(best);

    // Кнопка играть снова
    const btnBg = new Graphics()
      .roundRect(W / 2 - 115, H / 2 + 90, 230, 58, 29)
      .fill(0xd4a017);
    btnBg.interactive = true;
    btnBg.cursor = "pointer";
    btnBg.on("pointertap", () => {
      if (winCont) {
        uiLayer.removeChild(winCont);
        winCont = null;
      }
      restartGame();
    });
    winCont.addChild(btnBg);

    const btnT = new Text({
      text: "ЕЩЁ РАЗ!",
      style: new TextStyle({
        fontFamily: "Arial Black,sans-serif",
        fontSize: 22,
        fontWeight: "bold",
        fill: "#fff",
      }),
    });
    btnT.anchor.set(0.5);
    btnT.x = W / 2;
    btnT.y = H / 2 + 119;
    winCont.addChild(btnT);

    // Конфетти-частицы
    for (let i = 0; i < 60; i++) {
      const g = new Graphics()
        .rect(0, 0, 6, 6)
        .fill([0xffd700, 0xff6b6b, 0x6bcfff, 0x6bff8a][i % 4]);
      g.x = Math.random() * W;
      g.y = -20 - Math.random() * H;
      uiLayer.addChild(g);
      const vx = (Math.random() - 0.5) * 3;
      const vy = 2 + Math.random() * 3;
      const confTick = () => {
        if (state !== "gameover") {
          uiLayer.removeChild(g);
          g.destroy();
          app.ticker.remove(confTick);
          return;
        }
        g.x += vx;
        g.y += vy;
        g.rotation += 0.1;
        if (g.y > H + 20) g.y = -20;
      };
      app.ticker.add(confTick);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════
  let goCont: Container | null = null;

  function showGameOver() {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem("runnerBest", String(bestScore));
    }
    stopMusic();
    state = "gameover";
    goCont = new Container();
    uiLayer.addChild(goCont);

    goCont.addChild(
      new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.5 }),
    );

    const failSpr = new Sprite(T["fail"]);
    failSpr.anchor.set(0.5);
    failSpr.scale.set(0.85);
    failSpr.x = W / 2;
    failSpr.y = H / 2 - 168;
    goCont.addChild(failSpr);

    let fp = 0;
    const ft = () => {
      if (state !== "gameover") {
        app.ticker.remove(ft);
        return;
      }
      fp += 0.04;
      failSpr.scale.set(0.85 + Math.sin(fp) * 0.04);
    };
    app.ticker.add(ft);

    goCont.addChild(
      new Graphics()
        .roundRect(W / 2 - 130, H / 2 - 68, 260, 165, 18)
        .fill({ color: 0xffffff, alpha: 0.97 }),
    );

    const lbl = new Text({
      text: "SCORE",
      style: new TextStyle({
        fontFamily: "Arial Black",
        fontSize: 15,
        fill: "#888",
      }),
    });
    lbl.anchor.set(0.5);
    lbl.x = W / 2;
    lbl.y = H / 2 - 44;
    goCont.addChild(lbl);

    const val = new Text({
      text: String(score),
      style: new TextStyle({
        fontFamily: "Arial Black,Impact",
        fontSize: 48,
        fontWeight: "900",
        fill: "#222",
      }),
    });
    val.anchor.set(0.5);
    val.x = W / 2;
    val.y = H / 2 + 10;
    goCont.addChild(val);

    const best = new Text({
      text: "BEST: " + bestScore,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 14, fill: "#888" }),
    });
    best.anchor.set(0.5);
    best.x = W / 2;
    best.y = H / 2 + 66;
    goCont.addChild(best);

    const btnBg = new Graphics()
      .roundRect(W / 2 - 115, H / 2 + 108, 230, 58, 29)
      .fill(0x6c3fe8);
    btnBg.interactive = true;
    btnBg.cursor = "pointer";
    btnBg.on("pointertap", restartGame);
    goCont.addChild(btnBg);

    const btnT = new Text({
      text: "TRY AGAIN",
      style: new TextStyle({
        fontFamily: "Arial Black,sans-serif",
        fontSize: 22,
        fontWeight: "bold",
        fill: "#fff",
      }),
    });
    btnT.anchor.set(0.5);
    btnT.x = W / 2;
    btnT.y = H / 2 + 137;
    goCont.addChild(btnT);
  }

  // ═══════════════════════════════════════════════════════════
  // START / RESTART
  // ═══════════════════════════════════════════════════════════
  function clearAll() {
    obstacles.forEach((o) => {
      if (o.spr) {
        gameLayer.removeChild(o.spr);
        o.spr.destroy();
        o.spr = null;
      }
    });
    coins.forEach((c) => {
      if (c.spr) {
        gameLayer.removeChild(c.spr);
        c.spr.destroy();
        c.spr = null;
      }
    });
    parts.forEach((p) => {
      fxLayer.removeChild(p.g);
      p.g.destroy();
    });
    floats.forEach((f) => {
      uiLayer.removeChild(f.t);
      f.t.destroy();
    });
    obstacles = [];
    coins = [];
    parts = [];
    floats = [];
  }

  function startGame() {
    if (menuCont) {
      uiLayer.removeChild(menuCont);
      menuCont = null;
    }
    if (goCont) {
      uiLayer.removeChild(goCont);
      goCont = null;
    }
    clearAll();

    score = 0;
    distance = 0;
    lives = 3;
    speed = BASE_SPD;
    obstTimer = 0;
    coinTimer = 0;

    pl.x = PLAYER_X;
    pl.y = CHAR_Y;
    pl.vy = 0;
    pl.onGround = true;
    pl.jumps = 0;
    pl.dead = false;
    pl.invTimer = 0;
    pl.sliding = false;
    pl.slideTimer = 0;
    pl.curRow = -1;
    pl.deathPhase = 0;

    playerCont.removeChild(playerAnim);
    playerAnim.destroy();
    playerAnim = makeCharAnim(ROW_RUN, 0.15);
    pl.curRow = ROW_RUN;
    playerCont.addChild(playerAnim);
    playerCont.alpha = 1;
    playerCont.x = pl.x;
    playerCont.y = pl.y;

    refreshLives();
    refreshScore();
    // Музыка: первый interaction уже был (кнопка PLAY = клик) — запускаем
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
    state = "playing";
  }

  function restartGame() {
    startGame();
  }

  // ═══════════════════════════════════════════════════════════
  // INPUT — клавиатура + тач (тап = прыжок, свайп вниз = слайд)
  // ═══════════════════════════════════════════════════════════
  let ty0 = 0;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      if (state === "playing") doJump();
    }
    if (e.code === "ArrowDown" || e.code === "KeyS") {
      e.preventDefault();
      if (state === "playing") doSlide();
    }
  });

  app.canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      ty0 = e.touches[0].clientY;
    },
    { passive: false },
  );

  app.canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      const dy = ty0 - e.changedTouches[0].clientY;
      if (dy < -30 && state === "playing") doSlide();
      else if (state === "playing") doJump();
    },
    { passive: false },
  );

  // Клик мышью (для десктопа в браузере)
  app.canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && state === "playing") doJump();
  });

  // ═══════════════════════════════════════════════════════════
  // MAIN LOOP
  // ═══════════════════════════════════════════════════════════
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    if (state !== "playing" && state !== "dead") return;

    if (state === "playing") {
      distance += speed * dt * 0.05;
      score = Math.floor(distance * 2);
      speed = Math.min(BASE_SPD + Math.floor(distance / 70) * 0.35, 11.5);

      // Шаги — каждые ~18 кадров на земле
      if (pl.onGround && !pl.sliding && !pl.dead) {
        stepTimer += dt;
        if (stepTimer > 18) {
          stepTimer = 0;
          playStep();
        }
      } else {
        stepTimer = 0;
      }

      // Финиш — 500м
      if (distance >= WIN_DIST) {
        state = "dead";
        setTimeout(showWin, 400);
      }
    }

    // Параллакс — каждый слой со своей скоростью
    for (const layer of bgLayers) {
      for (const s of layer.sprites) {
        s.x -= layer.spd * dt;
        if (s.x <= -BG_W) s.x += BG_W * 2;
      }
    }

    for (const m of roadMarks) {
      m.x -= speed * dt;
      if (m.x < -50) m.x += W + 50;
    }

    if (state === "playing") {
      const interval = Math.max(52, 118 - Math.floor(distance / 35) * 3);
      obstTimer += dt;
      if (obstTimer >= interval) {
        spawnObs();
        obstTimer = 0;
      }
      coinTimer += dt;
      if (coinTimer >= 55) {
        if (Math.random() < 0.7) spawnCoin();
        coinTimer = 0;
      }
    }

    updatePlayer(dt);
    updateObs(dt);
    updateCoins(dt);
    updateParts(dt);
    updateFloats(dt);
    updateFlash(dt);

    if (state === "playing") {
      checkCollisions();
      refreshScore();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  showMenu();
} // end main()

main().catch((err) => {
  console.error("Game failed to start:", err);
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:13px;white-space:pre-wrap;">ОШИБКА ЗАПУСКА:\n${err?.message || err}\n${err?.stack || ""}</pre>`;
});
