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

// Global error overlay (Playable Ads friendly: no silent failures)
window.addEventListener("unhandledrejection", (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:12px;white-space:pre-wrap;">
ERROR: ${e.reason?.message || e.reason}
${e.reason?.stack || ""}
  </pre>`;
});
window.addEventListener("error", (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:12px;white-space:pre-wrap;">
ERROR: ${e.message} (${e.filename}:${e.lineno})
  </pre>`;
});

(async () => {
  // ═══════════════════════════════════════════════════════════
  // LAYOUT — all design-space positions live here
  // ═══════════════════════════════════════════════════════════
  const W = 390; // design width (logical pixels)
  const H = 844; // design height (logical pixels)
  const CHAR_Y = 660;
  const GRASS_Y = 620;
  const GRASS_H = H - GRASS_Y;
  const PLAYER_X = 85;
  const BG_LAYERS = [
    { key: "bg1", spd: 0.4 },
    { key: "bg2", spd: 0.9 },
    { key: "bg3", spd: 1.6 },
  ];

  // ── PHYSICS / GAME ────────────────────────────────────────
  const GRAVITY = 0.58;
  const JUMP_V = -15.5;
  const JUMP2_V = -13.0;
  const BASE_SPD = 4.5;
  const WIN_DIST = 500;
  const ENEMY_ANIM_SPD = 0.07;
  const METERS_PER_PX = 0.05; // keep original pacing, but track distance from actual scroll

  // ── CHARACTER ─────────────────────────────────────────────
  const CHAR_FW = 56;
  const CHAR_FH = 56;
  const CHAR_COLS = 8;
  const CHAR_SCALE = 2.75;
  const ROW_IDLE = 0;
  const ROW_RUN = 2;
  const ROW_JUMP = 3;
  const ROW_FALL = 4;
  const ROW_DEATH1 = 5;
  const ROW_DEATH2 = 6;

  // ── ENEMY ─────────────────────────────────────────────────
  const ENEMY_RUN_COLS = 8;
  const ENEMY_IDLE_COLS = 4;
  const ENEMY_FW = 150;
  const ENEMY_FH = 150;
  const ENEMY_SCALE = 3.4;
  const ENEMY_ANCHOR_Y = 100 / 150;

  const app = new Application();
  await app.init({
    width: 1,
    height: 1,
    backgroundColor: 0x87ceeb,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
  });
  const container = document.getElementById("pixi-container")!;
  container.appendChild(app.canvas);

  // ── RESPONSIVE SCALE (aspect-preserving, centered, letterbox) ─────────────
  // We keep a fixed "design world" (W×H) and scale it into the real viewport.
  const root = new Container();
  app.stage.addChild(root);

  // Ensure pointer events work even on "empty" pixels (tap-anywhere start)
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  function resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);

    app.renderer.resize(vw, vh);
    app.stage.hitArea = app.screen;

    const scale = Math.min(vw / W, vh / H);
    root.scale.set(scale);
    root.x = Math.round((vw - W * scale) / 2);
    root.y = Math.round((vh - H * scale) / 2);
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

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
    { alias: "finish", src: "/assets/finish.png" },
    { alias: "hand", src: "/assets/hand.png" },
    { alias: "adfooter", src: "/assets/adfooter.webp" },
    { alias: "floor", src: "/assets/floor.png" },
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
  const COIN_SCALE = 4.6; // bigger money for stronger gameplay presence

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
  root.addChild(bgLayer, gameLayer, fxLayer, uiLayer);

  // ─── Helper: leftmost X visible in design (root) coordinates ───────────
  // On wide screens the root is offset right, exposing area with x < 0
  function visibleDesignLeft(): number {
    return -root.x / root.scale.x;
  }
  function visibleDesignRight(): number {
    return (window.innerWidth - root.x) / root.scale.x;
  }

  // ═══════════════════════════════════════════════════════════
  // PARALLAX BACKGROUND — 3 layers (320×180), scaled to design height H
  // ═══════════════════════════════════════════════════════════
  const BG_SCALE = H / 180; // 844/180 ≈ 4.69
  const BG_W = Math.round(320 * BG_SCALE); // ~1502px

  // Spawn 6 tiles starting 1 tile left of origin — covers any viewport width
  const NUM_BG_SPRITES = 6;
  const BG_START_X = -BG_W; // start one tile to the left so wide screens are covered

  interface BgLayer {
    sprites: Sprite[];
    spd: number;
  }
  const bgLayers: BgLayer[] = [];

  for (const cfg of BG_LAYERS) {
    const sprites: Sprite[] = [];
    for (let i = 0; i < NUM_BG_SPRITES; i++) {
      const s = new Sprite(T[cfg.key]);
      s.scale.set(BG_SCALE);
      // Overdraw by 2px top and bottom to prevent gap artifacts
      s.y = -2;
      s.height = H + 4;
      s.x = BG_START_X + i * BG_W;
      bgLayer.addChild(s);
      sprites.push(s);
    }
    bgLayers.push({ sprites, spd: cfg.spd });
  }

  // ── FLOOR TILES (floor.png — horizontally seamless) ─────────────────────
  const floorTex = T["floor"];
  const FLOOR_SCALE = GRASS_H / floorTex.height; // fit height to ground strip
  const FLOOR_TILE_W = Math.ceil(floorTex.width * FLOOR_SCALE);
  // Spawn 16 tiles: start 3 tiles to the left so wide screens + left edge are covered
  const NUM_FLOOR_TILES = 16;
  const FLOOR_START_X = -3 * FLOOR_TILE_W;
  const floorTiles: Sprite[] = [];
  for (let i = 0; i < NUM_FLOOR_TILES; i++) {
    const s = new Sprite(floorTex);
    s.scale.set(FLOOR_SCALE);
    s.x = FLOOR_START_X + i * FLOOR_TILE_W;
    s.y = GRASS_Y;
    bgLayer.addChild(s);
    floorTiles.push(s);
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
  type GameState =
    | "menu"
    | "playing"
    | "finishing"
    | "win_anim"
    | "dead"
    | "gameover"
    | "win";
  let state: GameState = "menu";
  let score = 0,
    displayScore = 0,
    distance = 0,
    runPx = 0,
    lives = 3,
    speed = BASE_SPD;
  let bestScore = parseInt(localStorage.getItem("runnerBest") ?? "0");
  let obstTimer = 0,
    coinTimer = 0,
    stepTimer = 0;
  const COIN_VALUE = 10;
  let winAnimTimer = 0;

  // Finish line (existing sprite)
  const totalRunPx = WIN_DIST / METERS_PER_PX;
  const finishSpr = new Sprite(T["finish"]);
  finishSpr.anchor.set(0.5, 1);
  finishSpr.scale.set(0.9);
  finishSpr.y = CHAR_Y + 45;
  const finishCrossX = PLAYER_X - finishSpr.width * 0.35;
  const finishStartX = finishCrossX + totalRunPx;
  finishSpr.x = finishStartX;
  gameLayer.addChild(finishSpr);
  let finishCrossed = false;

  // CTA url helpers (Playable Ads compliant: user-initiated open only)
  const DEFAULT_CTA_URL = "https://github.com/NikitaSipeykin/runner";
  function getCtaUrl(): string {
    const w = window as unknown as Record<string, unknown>;
    const qs = new URLSearchParams(window.location.search);
    const fromQs =
      qs.get("clickUrl") ||
      qs.get("clickurl") ||
      qs.get("clickURL") ||
      qs.get("url");
    const fromGlobal =
      (typeof w.clickTag === "string" && w.clickTag) ||
      (typeof w.clickURL === "string" && w.clickURL) ||
      (typeof w.CLICK_URL === "string" && w.CLICK_URL) ||
      (typeof w.EXIT_URL === "string" && w.EXIT_URL);
    return (fromQs || fromGlobal || DEFAULT_CTA_URL).toString();
  }

  function openCta(url = getCtaUrl()) {
    try {
      const mw = window as unknown as {
        mraid?: { open?: (u: string) => void };
      };
      if (mw.mraid?.open) mw.mraid.open(url);
      else window.open(url, "_blank");
    } catch {
      try {
        window.open(url, "_blank");
      } catch {
        // noop
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AUDIO
  // ═══════════════════════════════════════════════════════════
  const bgMusic = new Audio("/assets/medieval-fantasy-142837.mp3");
  bgMusic.loop = true;
  bgMusic.volume = 0.45;

  // Browsers block autoplay — unlock audio on first user interaction
  let musicUnlocked = false;
  function unlockMusic() {
    if (musicUnlocked) return;
    musicUnlocked = true;
    bgMusic.play().catch(() => {});
  }
  document.addEventListener("touchstart", unlockMusic, { once: true });
  document.addEventListener("click", unlockMusic, { once: true });
  document.addEventListener("keydown", unlockMusic, { once: true });

  // Hurt/step: use lowercase extensions for compatibility
  const sndHurt = new Audio("/assets/player_hurt.MP3");
  sndHurt.volume = 0.9;

  const sndStep = new Audio("/assets/step.MP3");
  sndStep.volume = 0.45;

  const sndWin = new Audio("/assets/win.mp3");
  sndWin.volume = 0.8;

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
    deathPhase: 0, // 0=not started, 1=part1, 2=part2
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
    // Real content is smaller than the sprite frame: ~20×31 inside 56×56
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

    // Animation by state
    if (!pl.dead && !pl.sliding) {
      if (pl.onGround) {
        if (pl.curRow !== ROW_RUN) {
          pl.curRow = -1;
          switchAnim(ROW_RUN);
        }
      } else {
        // In air: vy < 0 = rising (jump), vy > 0 = falling
        const wantRow = pl.vy < 0 ? ROW_JUMP : ROW_FALL;
        if (pl.curRow !== wantRow) {
          pl.curRow = -1;
          switchAnim(wantRow, 0.18);
        }
      }
    }

    // Death animation in 2 phases
    if (pl.dead) {
      if (pl.deathPhase === 0) {
        pl.deathPhase = 1;
        pl.curRow = -1;
        switchAnim(ROW_DEATH1, 0.14);
        // After ~8 frames switch to part2
        setTimeout(() => {
          if (pl.dead) {
            pl.curRow = -1;
            switchAnim(ROW_DEATH2, 0.12);
            pl.deathPhase = 2;
          }
        }, 600);
      }
    }

    // Physics
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

    // Blink while invulnerable
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

  // hw/hh are fractions of sprite size that match the actual visible content
  // Run:  content 25×35 inside 150×150 → hw=0.17, hh=0.23
  // Idle: content 22×35 inside 150×150 → hw=0.15, hh=0.23
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
    // scale.x is already mirrored for idle_obs; enemy uses the standard mirrored run
    if (cfg.key === "enemy") {
      spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE); // mirrored so it runs toward the player
    } else {
      spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE);
    }
    spr.x = visibleDesignRight() + 60;
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
      (o) => !o.active || (o.spr && o.spr.x < visibleDesignLeft() - 200),
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
  // COINS — animated sprite from MonedaD.png
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
    a.x = visibleDesignRight() + 30;
    a.y = ys[Math.floor(Math.random() * ys.length)];
    gameLayer.addChild(a);
    coins.push({ spr: a, active: true, phase: Math.random() * Math.PI * 2 });
  }

  function updateCoins(dt: number) {
    for (const c of coins) {
      if (!c.spr || !c.active) continue;
      c.spr.x -= speed * dt;
      c.phase += 0.04 * dt;
      c.spr.y += Math.sin(c.phase) * 0.35; // subtle bobbing
    }
    const toRemove = coins.filter(
      (c) => !c.active || (c.spr && c.spr.x < visibleDesignLeft() - 80),
    );
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
      fontSize: 34,
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
          fontSize: 32,
          fill: i < lives ? "#ff4466" : "#aaa",
        }),
      });
      h.x = i * 38;
      livesCont.addChild(h);
    }
  }

  function refreshScore() {
    scoreText.text = Math.round(displayScore).toString();
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
        score += COIN_VALUE;
        spawnCoinFx(c.spr.x, c.spr.y);
        floatText(c.spr.x, c.spr.y - 20, `+${COIN_VALUE}`);
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
  let menuTapArmed = true;

  function showMenu() {
    state = "menu";
    menuCont = new Container();
    uiLayer.addChild(menuCont);
    menuTapArmed = true;

    const MENU_CARD_W = Math.min(320, W - 40);
    menuCont.addChild(
      new Graphics()
        .roundRect(W / 2 - MENU_CARD_W / 2, H / 2 - 200, MENU_CARD_W, 230, 22)
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
    btnBg.eventMode = "static";
    btnBg.cursor = "pointer";
    btnBg.on("pointerdown", startGame);
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
    hand.x = W / 2 + 60;
    hand.y = H / 2 + 157;
    menuCont.addChild(hand);

    let hp = 0;
    const tick = () => {
      if (state !== "menu") {
        app.ticker.remove(tick);
        return;
      }
      hp += 0.05;
      hand.y = H / 2 + 128 + Math.sin(hp) * 7;
      hand.rotation = Math.sin(hp * 0.5) * 0.08;
    };
    app.ticker.add(tick);
  }

  // ═══════════════════════════════════════════════════════════
  // WIN SCREEN
  // ═══════════════════════════════════════════════════════════
  let winCont: Container | null = null;
  let confettiTicker: ((ticker: { deltaTime: number }) => void) | null = null;
  const confettiParts: Array<{
    g: Graphics;
    vx: number;
    vy: number;
    vr: number;
    life: number;
    max: number;
  }> = [];

  function clearConfetti() {
    if (confettiTicker) {
      app.ticker.remove(confettiTicker);
      confettiTicker = null;
    }
    for (const p of confettiParts) {
      uiLayer.removeChild(p.g);
      p.g.destroy();
    }
    confettiParts.length = 0;
  }

  function spawnConfettiBurst(count: number) {
    clearConfetti();
    const colors = [
      0xffd700, 0xff6b6b, 0x6bcfff, 0x6bff8a, 0xffa500, 0xff69b4, 0xffffff,
    ];

    function addPiece() {
      const vLeft = visibleDesignLeft();
      const vRight = visibleDesignRight();
      const spanW = vRight - vLeft;
      const g = new Graphics()
        .rect(0, 0, 6 + Math.random() * 8, 5 + Math.random() * 10)
        .fill(colors[Math.floor(Math.random() * colors.length)]);
      g.x = vLeft + Math.random() * spanW;
      g.y = -20 - Math.random() * 80;
      g.rotation = Math.random() * Math.PI * 2;
      uiLayer.addChild(g);
      const maxLife = 140 + Math.random() * 80;
      confettiParts.push({
        g,
        vx: (Math.random() - 0.5) * 5,
        vy: 1.5 + Math.random() * 3.5,
        vr: (Math.random() - 0.5) * 0.3,
        life: maxLife,
        max: maxLife,
      });
    }

    // Initial burst
    for (let i = 0; i < count; i++) addPiece();

    let spawnTimer = 0;
    confettiTicker = (ticker) => {
      const dt = ticker.deltaTime;

      // Continuously spawn new pieces so confetti never runs out
      spawnTimer += dt;
      if (spawnTimer >= 2) {
        spawnTimer = 0;
        for (let i = 0; i < 6; i++) addPiece();
      }

      for (const p of confettiParts) {
        p.life -= dt;
        p.g.x += p.vx * dt;
        p.g.y += p.vy * dt;
        p.vy += 0.12 * dt;
        p.g.rotation += p.vr * dt;
        // Fade only in last 30 frames
        p.g.alpha = p.life < 30 ? Math.max(0, p.life / 30) : 1;
      }
      for (let i = confettiParts.length - 1; i >= 0; i--) {
        if (confettiParts[i].life <= 0 || confettiParts[i].g.y > H + 40) {
          const g = confettiParts[i].g;
          uiLayer.removeChild(g);
          g.destroy();
          confettiParts.splice(i, 1);
        }
      }
    };
    app.ticker.add(confettiTicker);
  }

  function showWin() {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem("runnerBest", String(bestScore));
    }
    stopMusic();
    sndWin.currentTime = 0;
    sndWin.play().catch(() => {});
    state = "gameover";
    winCont = new Container();
    uiLayer.addChild(winCont);
    clearConfetti();

    // Golden title
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

    // Title pulse animation
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

    // Result card — responsive width
    const CARD_W = Math.min(320, W - 40);
    winCont.addChild(
      new Graphics()
        .roundRect(W / 2 - CARD_W / 2, H / 2 - 130, CARD_W, 200, 20)
        .fill({ color: 0xfff8e7, alpha: 0.97 }),
    );

    const lbl500 = new Text({
      text: `${WIN_DIST}m Completed!`,
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
      text: "COINS",
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
      text: "BEST COINS: " + bestScore,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 14, fill: "#888" }),
    });
    best.anchor.set(0.5);
    best.x = W / 2;
    best.y = H / 2 + 44;
    winCont.addChild(best);

    // Single DOWNLOAD button centered
    const BTN_W = Math.min(260, W - 60);
    const ctaBg = new Graphics()
      .roundRect(W / 2 - BTN_W / 2, H / 2 + 90, BTN_W, 62, 31)
      .fill(0xd4a017);
    ctaBg.eventMode = "static";
    ctaBg.cursor = "pointer";
    ctaBg.on("pointerdown", () => openCta());
    winCont.addChild(ctaBg);

    const ctaT = new Text({
      text: "DOWNLOAD",
      style: new TextStyle({
        fontFamily: "Arial Black,sans-serif",
        fontSize: 22,
        fontWeight: "bold",
        fill: "#fff",
      }),
    });
    ctaT.anchor.set(0.5);
    ctaT.x = W / 2;
    ctaT.y = H / 2 + 121;
    winCont.addChild(ctaT);

    // Confetti already started at finish line crossing
    spawnConfettiBurst(200);
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
    clearConfetti();

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

    const GO_CARD_W = Math.min(300, W - 40);
    goCont.addChild(
      new Graphics()
        .roundRect(W / 2 - GO_CARD_W / 2, H / 2 - 68, GO_CARD_W, 165, 18)
        .fill({ color: 0xffffff, alpha: 0.97 }),
    );

    const lbl = new Text({
      text: "COINS",
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

    // Single DOWNLOAD button
    const GO_BTN_W = Math.min(260, W - 60);
    const btnBg = new Graphics()
      .roundRect(W / 2 - GO_BTN_W / 2, H / 2 + 108, GO_BTN_W, 62, 31)
      .fill(0xd4a017);
    btnBg.eventMode = "static";
    btnBg.cursor = "pointer";
    btnBg.on("pointerdown", () => openCta());
    goCont.addChild(btnBg);

    const btnT = new Text({
      text: "DOWNLOAD",
      style: new TextStyle({
        fontFamily: "Arial Black,sans-serif",
        fontSize: 22,
        fontWeight: "bold",
        fill: "#fff",
      }),
    });
    btnT.anchor.set(0.5);
    btnT.x = W / 2;
    btnT.y = H / 2 + 139;
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
    clearConfetti();
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
    if (winCont) {
      uiLayer.removeChild(winCont);
      winCont = null;
    }
    clearAll();

    score = 0;
    distance = 0;
    runPx = 0;
    displayScore = 0;
    lives = 3;
    speed = BASE_SPD;
    obstTimer = 0;
    coinTimer = 0;
    winAnimTimer = 0;
    finishCrossed = false;
    finishSpr.x = finishStartX;

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
    playerCont.scale.set(1);
    playerCont.x = pl.x;
    playerCont.y = pl.y;

    refreshLives();
    refreshScore();
    // Music: first interaction already happened (tap/click) — start playback
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
    state = "playing";
    menuTapArmed = false;
  }

  // ═══════════════════════════════════════════════════════════
  // INPUT — keyboard + touch (tap = jump, swipe down = slide)
  // ═══════════════════════════════════════════════════════════
  let ty0 = 0;

  function tryStartFromAnywhere() {
    if (state !== "menu") return;
    if (!menuTapArmed) return;
    menuTapArmed = false;
    startGame();
  }

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
      tryStartFromAnywhere();
    },
    { passive: false },
  );

  app.canvas.addEventListener(
    "touchend",
    (e) => {
      // On gameover/win screens, let Pixi handle button taps natively — do NOT preventDefault
      if (state === "gameover") return;
      e.preventDefault();
      const dy = ty0 - e.changedTouches[0].clientY;
      if (dy < -30 && state === "playing") doSlide();
      else if (state === "playing") doJump();
      else tryStartFromAnywhere();
    },
    { passive: false },
  );

  // Mouse click (desktop)
  app.canvas.addEventListener("pointerdown", (e) => {
    if (state === "playing") {
      if (e.pointerType === "mouse") doJump();
    } else if (state === "menu") {
      tryStartFromAnywhere();
    }
    // on gameover let Pixi button handlers fire
  });

  // Pixi pointer events (helps WebViews capture the first interaction reliably)
  app.stage.on("pointerdown", () => {
    if (state === "menu") tryStartFromAnywhere();
  });

  // ═══════════════════════════════════════════════════════════
  // MAIN LOOP
  // ═══════════════════════════════════════════════════════════
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    if (
      state !== "playing" &&
      state !== "finishing" &&
      state !== "win_anim" &&
      state !== "dead"
    )
      return;

    if (state === "playing" || state === "finishing") {
      runPx += speed * dt;
      distance = runPx * METERS_PER_PX;
      speed = Math.min(BASE_SPD + Math.floor(distance / 70) * 0.35, 11.5);

      // Steps — roughly every ~18 frames on ground
      if (pl.onGround && !pl.sliding && !pl.dead) {
        stepTimer += dt;
        if (stepTimer > 18) {
          stepTimer = 0;
          playStep();
        }
      } else {
        stepTimer = 0;
      }
    }

    // Smooth count-up (coin-only score)
    if (displayScore !== score) {
      const diff = score - displayScore;
      displayScore += Math.sign(diff) * Math.max(1, Math.abs(diff) * 0.25);
      if (Math.abs(score - displayScore) < 0.5) displayScore = score;
    }

    // Win beat (0.8–1.2s), then CTA screen
    if (state === "win_anim") {
      winAnimTimer += dt;
      const t = Math.min(1, winAnimTimer / 65);
      playerCont.scale.set(1 + Math.sin(t * Math.PI) * 0.06);
      updatePlayer(dt);
      updateParts(dt);
      updateFloats(dt);
      updateFlash(dt);
      refreshScore();

      if (winAnimTimer >= 65) {
        playerCont.scale.set(1);
        state = "dead";
        setTimeout(showWin, 50);
      }
      return;
    }

    // Parallax background — wrap when tile fully exits visible design area
    const vLeft = visibleDesignLeft();
    for (const layer of bgLayers) {
      for (const s of layer.sprites) {
        s.x -= layer.spd * dt;
        if (s.x + BG_W <= vLeft) s.x += NUM_BG_SPRITES * BG_W;
      }
    }

    // Floor tiles scroll at game speed
    for (const tile of floorTiles) {
      tile.x -= speed * dt;
      if (tile.x + FLOOR_TILE_W <= vLeft)
        tile.x += NUM_FLOOR_TILES * FLOOR_TILE_W;
    }

    // Finish line: must be visually crossed before victory triggers
    if (!finishCrossed && (state === "playing" || state === "finishing")) {
      finishSpr.x -= speed * dt;
      if (state === "playing" && finishSpr.x < W - 90) {
        state = "finishing"; // stop new spawns near the end
      }
      if (finishSpr.x < finishCrossX) {
        finishCrossed = true;
        state = "win_anim";
        winAnimTimer = 0;
        pl.curRow = -1;
        switchAnim(ROW_IDLE, 0.12);
        spawnDust(pl.x, CHAR_Y, 0xffd700, 18);
      }
    }

    // Spawns only while actively playing (not during finishing/dead)
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

    if (state === "playing" || state === "finishing") {
      checkCollisions();
      refreshScore();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  showMenu();
})().catch((err) => {
  console.error("Game failed to start:", err);
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:13px;white-space:pre-wrap;">ERROR:
${err?.message || err}
${err?.stack || ""}</pre>`;
});
