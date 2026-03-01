import {
  Application,
  Assets,
  Sprite,
  TilingSprite,
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
    resolution: 1,
    autoDensity: false,
    antialias: false,
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

  // ─── Cached visible design bounds — updated on resize, never calls window APIs in game loop
  let cachedVLeft = 0;
  let cachedVRight = W;

  function updateVisibleBounds() {
    cachedVLeft = -root.x / root.scale.x;
    cachedVRight = (window.innerWidth - root.x) / root.scale.x;
  }

  function visibleDesignLeft(): number {
    return cachedVLeft;
  }
  function visibleDesignRight(): number {
    return cachedVRight;
  }

  // Forward declaration — resizeBgSprites is defined after TilingSprites are created
  let resizeBgSprites: () => void = () => {};

  function resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);

    app.renderer.resize(vw, vh);
    app.stage.hitArea = app.screen;

    // Scale by height — fills full screen height, no side bars ever
    const scale = vh / H;
    root.scale.set(scale);
    root.x = Math.round((vw - W * scale) / 2);
    root.y = 0;
    updateVisibleBounds();
    resizeBgSprites();
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
    { alias: "adfooter", src: "/assets/adfooter.png" },
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

  // MonedaD.png: 80×16, 5 cols → frame 16×16
  const COIN_COLS = 5;
  const COIN_FW = 16;
  const COIN_FH = 16;
  const COIN_SCALE = 4.6;

  // ── PRE-CACHED FRAME ARRAYS (created once, reused on every spawn) ───────
  const CACHED_ENEMY_RUN_FRAMES: Texture[] = Array.from(
    { length: ENEMY_RUN_COLS },
    (_, i) =>
      new Texture({
        source: T["enemy_run"].source,
        frame: new Rectangle(i * ENEMY_FW, 0, ENEMY_FW, ENEMY_FH),
      }),
  );
  const CACHED_ENEMY_IDLE_FRAMES: Texture[] = Array.from(
    { length: ENEMY_IDLE_COLS },
    (_, i) =>
      new Texture({
        source: T["enemy_idle"].source,
        frame: new Rectangle(i * ENEMY_FW, 0, ENEMY_FW, ENEMY_FH),
      }),
  );
  const CACHED_COIN_FRAMES: Texture[] = Array.from(
    { length: COIN_COLS },
    (_, i) =>
      new Texture({
        source: T["coin"].source,
        frame: new Rectangle(i * COIN_FW, 0, COIN_FW, COIN_FH),
      }),
  );

  const ROW_FRAME_COUNTS: Record<number, number> = {
    [ROW_IDLE]: 6,
    [ROW_DEATH1]: 6,
    [ROW_DEATH2]: 6,
  };

  // Pre-cache every character animation row — zero allocations during gameplay
  const CACHED_CHAR_FRAMES: Record<number, Texture[]> = {};
  for (const row of [
    ROW_IDLE,
    ROW_RUN,
    ROW_JUMP,
    ROW_FALL,
    ROW_DEATH1,
    ROW_DEATH2,
  ]) {
    const count = ROW_FRAME_COUNTS[row] ?? CHAR_COLS;
    CACHED_CHAR_FRAMES[row] = charFrames(row, count);
  }

  function makeCharAnim(row: number, spd = 0.15): AnimatedSprite {
    const a = new AnimatedSprite(CACHED_CHAR_FRAMES[row]);
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

  // ═══════════════════════════════════════════════════════════
  // PARALLAX BACKGROUND — 3 TilingSprites, one per layer
  // ═══════════════════════════════════════════════════════════
  const BG_SCALE = H / 180; // 844/180 ≈ 4.69

  interface BgLayer {
    spr: TilingSprite;
    spd: number;
  }
  const bgLayers: BgLayer[] = [];

  for (const cfg of BG_LAYERS) {
    const tex = T[cfg.key];
    const spr = new TilingSprite({
      texture: tex,
      width: W,
      height: H + 4,
    });
    spr.tileScale.set(BG_SCALE);
    spr.y = -2;
    bgLayer.addChild(spr);
    bgLayers.push({ spr, spd: cfg.spd });
  }

  // ── FLOOR TILE (floor.png — single TilingSprite, seamless scroll) ──────
  const floorTex = T["floor"];
  const FLOOR_SCALE = GRASS_H / floorTex.height; // fit height to ground strip
  const floorTile = new TilingSprite({
    texture: floorTex,
    width: W,
    height: GRASS_H,
  });
  floorTile.tileScale.set(FLOOR_SCALE);
  floorTile.y = GRASS_Y;
  bgLayer.addChild(floorTile);
  let floorScrollX = 0;

  // Stretches all TilingSprites to cover the full visible design width (handles wide screens)
  resizeBgSprites = () => {
    const x = cachedVLeft;
    const w = cachedVRight - cachedVLeft;
    for (let i = 0; i < bgLayers.length; i++) {
      bgLayers[i].spr.x = x;
      bgLayers[i].spr.width = w;
    }
    floorTile.x = x;
    floorTile.width = w;
  };
  // Apply correct dimensions immediately now that sprites exist
  resizeBgSprites();

  // Ad banner — centered, max 1.5× native height, sides cropped if viewport is narrower
  const nativeAdW = T["adfooter"].width;
  const nativeAdH = T["adfooter"].height;
  const MAX_AD_SCALE = 0.5;

  // No Graphics mask — use PixiJS scissor rect via boundsArea (no stencil cost)
  const adSpr = new Sprite(T["adfooter"]);
  uiLayer.addChild(adSpr);

  function resizeAd() {
    const vw = window.innerWidth;
    const scale = root.scale.x;
    const designW = vw / scale;
    const offsetX = -root.x / scale;

    const sprW = nativeAdW * MAX_AD_SCALE;
    const sprH = nativeAdH * MAX_AD_SCALE;

    // Reset to full texture
    adSpr.texture = T["adfooter"];
    adSpr.width = sprW;
    adSpr.height = sprH;
    adSpr.x = offsetX + designW / 2 - sprW / 2;
    adSpr.y = H - sprH;
  }
  resizeAd();
  window.addEventListener("resize", resizeAd);
  window.addEventListener("orientationchange", resizeAd);

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
  const finishCrossX = PLAYER_X;
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

  const sndWin = new Audio("/assets/win.mp3");
  sndWin.volume = 0.8;

  // Pre-allocated audio pools — no allocations during gameplay
  const STEP_POOL_SIZE = 4;
  const HURT_POOL_SIZE = 3;
  const stepPool = Array.from({ length: STEP_POOL_SIZE }, () => {
    const a = new Audio("/assets/step.MP3");
    a.volume = 0.45;
    return a;
  });
  const hurtPool = Array.from({ length: HURT_POOL_SIZE }, () => {
    const a = new Audio("/assets/player_hurt.MP3");
    a.volume = 0.9;
    return a;
  });
  let stepIdx = 0,
    hurtIdx = 0;

  function playHurt() {
    const s = hurtPool[hurtIdx % HURT_POOL_SIZE];
    hurtIdx++;
    s.currentTime = 0;
    s.play().catch(() => {});
  }

  function playStep() {
    const s = stepPool[stepIdx % STEP_POOL_SIZE];
    stepIdx++;
    s.currentTime = 0;
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

  const playerAnim = makeCharAnim(ROW_RUN);
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
    curRow: ROW_RUN,
    deathPhase: 0, // 0=not started, 1=part1, 2=part2
    deathTimer: 0, // replaces setTimeout
  };

  function switchAnim(row: number, spd = 0.15) {
    if (pl.curRow === row) return;
    pl.curRow = row;
    // Swap textures in-place — no destroy/create, no GC pressure
    playerAnim.textures = CACHED_CHAR_FRAMES[row];
    playerAnim.animationSpeed = spd;
    playerAnim.gotoAndPlay(0);
    if (pl.sliding) {
      playerAnim.scale.y = CHAR_SCALE * 0.52;
      playerAnim.y = CHAR_FH * CHAR_SCALE * 0.32;
    } else {
      playerAnim.scale.set(CHAR_SCALE);
      playerAnim.y = 0;
    }
  }

  function doJump() {
    if (pl.dead) return;

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

  // Pre-allocated rect objects — reused every frame, zero allocations during collision checks
  const _pbRect = { x: 0, y: 0, w: 0, h: 0 };
  const _obRect = { x: 0, y: 0, w: 0, h: 0 };
  const _cbRect = { x: 0, y: 0, w: 0, h: 0 };

  function playerHitbox() {
    const sk = pl.sliding ? 0.55 : 1.0;
    const pw = CHAR_FW * CHAR_SCALE * 0.37;
    const ph = CHAR_FH * CHAR_SCALE * 0.55 * sk;
    _pbRect.x = pl.x - pw / 2;
    _pbRect.y = pl.y - ph;
    _pbRect.w = pw;
    _pbRect.h = ph;
    return _pbRect;
  }

  function updatePlayer(dt: number) {
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

    // Death animation in 2 phases — no setTimeout, uses deathTimer counter
    if (pl.dead) {
      if (pl.deathPhase === 0) {
        pl.deathPhase = 1;
        pl.deathTimer = 0;
        pl.curRow = -1;
        switchAnim(ROW_DEATH1, 0.14);
      } else if (pl.deathPhase === 1) {
        pl.deathTimer += dt;
        if (pl.deathTimer >= 36) {
          // ~600ms at 60fps
          pl.deathPhase = 2;
          pl.curRow = -1;
          switchAnim(ROW_DEATH2, 0.12);
          playerAnim.loop = false;
          playerAnim.onComplete = () => {
            playerAnim.gotoAndStop(playerAnim.totalFrames - 1);
          };
        }
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
  // hw/hh are fractions of sprite size that match the actual visible content
  const obsCfgs = [
    { key: "idle_obs", hw: 0.15, hh: 0.23 },
    { key: "idle_obs", hw: 0.15, hh: 0.23 },
    { key: "enemy", hw: 0.17, hh: 0.23 },
    { key: "enemy", hw: 0.17, hh: 0.23 },
  ];

  // ── ENEMY POOL ────────────────────────────────────────────
  interface PooledObs {
    spr: AnimatedSprite;
    active: boolean;
    hw: number;
    hh: number;
  }
  const OBS_POOL_SIZE = 6;
  const obsPool: PooledObs[] = [];
  for (let i = 0; i < OBS_POOL_SIZE; i++) {
    const spr = new AnimatedSprite(CACHED_ENEMY_RUN_FRAMES);
    spr.anchor.set(0.5, ENEMY_ANCHOR_Y);
    spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE);
    spr.animationSpeed = ENEMY_ANIM_SPD;
    spr.visible = false;
    gameLayer.addChild(spr);
    obsPool.push({ spr, active: false, hw: 0.17, hh: 0.23 });
  }
  let obstacles: PooledObs[] = [];

  let obsPoolIdx = 0;
  function spawnObs() {
    if (distance < 10) return;
    const cfgPool = distance < 40 ? [obsCfgs[0]] : obsCfgs;
    const cfg = cfgPool[Math.floor(Math.random() * cfgPool.length)];
    // Find free slot with round-robin — avoids linear scan
    let slot: PooledObs | null = null;
    for (let i = 0; i < OBS_POOL_SIZE; i++) {
      const idx = (obsPoolIdx + i) % OBS_POOL_SIZE;
      if (!obsPool[idx].active) {
        slot = obsPool[idx];
        obsPoolIdx = (idx + 1) % OBS_POOL_SIZE;
        break;
      }
    }
    if (!slot) return;
    const frames =
      cfg.key === "enemy" ? CACHED_ENEMY_RUN_FRAMES : CACHED_ENEMY_IDLE_FRAMES;
    slot.spr.textures = frames;
    slot.spr.animationSpeed =
      cfg.key === "enemy" ? ENEMY_ANIM_SPD : ENEMY_ANIM_SPD * 0.8;
    slot.spr.scale.set(-ENEMY_SCALE, ENEMY_SCALE);
    slot.spr.x = visibleDesignRight() + 60;
    slot.spr.y = CHAR_Y;
    slot.spr.visible = true;
    slot.spr.gotoAndPlay(0);
    slot.hw = cfg.hw;
    slot.hh = cfg.hh;
    slot.active = true;
    obstacles.push(slot);
  }

  function obsHitbox(o: PooledObs) {
    const w = o.spr.width * o.hw,
      h = o.spr.height * o.hh;
    _obRect.x = o.spr.x - w / 2;
    _obRect.y = o.spr.y - h;
    _obRect.w = w;
    _obRect.h = h;
    return _obRect;
  }

  function updateObs(dt: number) {
    const vLeft = visibleDesignLeft();
    for (const o of obstacles) {
      if (o.active) o.spr.x -= speed * dt;
    }
    let i = obstacles.length;
    while (i--) {
      const o = obstacles[i];
      if (!o.active || o.spr.x < vLeft - 200) {
        o.active = false;
        o.spr.visible = false;
        obstacles[i] = obstacles[obstacles.length - 1];
        obstacles.length--;
      }
    }
  }

  // ── COIN POOL ─────────────────────────────────────────────
  interface PooledCoin {
    spr: AnimatedSprite;
    active: boolean;
    phase: number;
  }
  const COIN_POOL_SIZE = 8;
  const coinPool: PooledCoin[] = [];
  for (let i = 0; i < COIN_POOL_SIZE; i++) {
    const spr = new AnimatedSprite(CACHED_COIN_FRAMES);
    spr.anchor.set(0.5);
    spr.scale.set(COIN_SCALE);
    spr.animationSpeed = 0.14;
    spr.visible = false;
    gameLayer.addChild(spr);
    coinPool.push({ spr, active: false, phase: 0 });
  }
  let coins: PooledCoin[] = [];

  let coinPoolIdx = 0;
  function spawnCoin() {
    let slot: PooledCoin | null = null;
    for (let i = 0; i < COIN_POOL_SIZE; i++) {
      const idx = (coinPoolIdx + i) % COIN_POOL_SIZE;
      if (!coinPool[idx].active) {
        slot = coinPool[idx];
        coinPoolIdx = (idx + 1) % COIN_POOL_SIZE;
        break;
      }
    }
    if (!slot) return;
    const ys = [CHAR_Y - 50, CHAR_Y - 110, CHAR_Y - 180];
    slot.spr.x = visibleDesignRight() + 30;
    slot.spr.y = ys[Math.floor(Math.random() * ys.length)];
    slot.spr.visible = true;
    slot.spr.gotoAndPlay(0);
    slot.active = true;
    slot.phase = Math.random() * Math.PI * 2;
    coins.push(slot);
  }

  function updateCoins(dt: number) {
    const vLeft = visibleDesignLeft();
    for (const c of coins) {
      if (!c.active) continue;
      c.spr.x -= speed * dt;
      c.phase += 0.04 * dt;
      c.spr.y += Math.sin(c.phase) * 0.35;
      if (c.spr.x < vLeft - 80) {
        c.active = false;
        c.spr.visible = false;
      }
    }
    let i = coins.length;
    while (i--) {
      if (!coins[i].active) {
        coins[i] = coins[coins.length - 1];
        coins.length--;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PARTICLES — object pool, geometry drawn ONCE at init, never cleared during gameplay
  // ═══════════════════════════════════════════════════════════
  interface Part {
    g: Graphics;
    vx: number;
    vy: number;
    life: number;
    max: number;
    active: boolean;
  }

  function makePartPool(color: number, r: number, count: number): Part[] {
    return Array.from({ length: count }, () => {
      const g = new Graphics().circle(0, 0, r).fill(color);
      g.visible = false;
      fxLayer.addChild(g);
      return { g, vx: 0, vy: 0, life: 0, max: 1, active: false };
    });
  }

  // Three fixed-color pools — no geometry changes at runtime
  const dustPoolGold = makePartPool(0xffd700, 4, 40);
  const dustPoolGreen = makePartPool(0x7ec850, 4, 20);
  const hitPool = makePartPool(0xff3333, 5, 20);
  const coinFxPool = makePartPool(0xffd700, 4, 16);
  const allPartPools = [dustPoolGold, dustPoolGreen, hitPool, coinFxPool];

  function acquireFrom(pool: Part[]): Part | null {
    for (const p of pool) if (!p.active) return p;
    return null;
  }

  function emitFrom(
    pool: Part[],
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
  ) {
    const p = acquireFrom(pool);
    if (!p) return;
    p.g.x = x;
    p.g.y = y;
    p.g.alpha = 1;
    p.g.visible = true;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.active = true;
  }

  function spawnDust(x: number, y: number, color: number, n: number) {
    const pool = color === 0x7ec850 ? dustPoolGreen : dustPoolGold;
    for (let i = 0; i < n; i++)
      emitFrom(
        pool,
        x + (Math.random() - 0.5) * 22,
        y,
        (Math.random() - 0.5) * 3.5,
        -(Math.random() * 4 + 1),
        22,
      );
  }

  function spawnHitFx(x: number, y: number) {
    for (let i = 0; i < 14; i++)
      emitFrom(
        hitPool,
        x,
        y,
        (Math.random() - 0.5) * 7,
        -(Math.random() * 5 + 1),
        28,
      );
  }

  function spawnCoinFx(x: number, y: number) {
    for (let i = 0; i < 8; i++)
      emitFrom(
        coinFxPool,
        x,
        y,
        (Math.random() - 0.5) * 5,
        -(Math.random() * 4 + 2),
        20,
      );
  }

  function updateParts(dt: number) {
    for (const pool of allPartPools) {
      for (const p of pool) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          p.g.visible = false;
          continue;
        }
        p.g.x += p.vx * dt;
        p.g.y += p.vy * dt;
        p.vy += 0.18 * dt;
        p.g.alpha = Math.max(0, p.life / p.max);
      }
    }
  }

  // ── FLOAT TEXT POOL ───────────────────────────────────────
  interface FT {
    t: Text;
    vy: number;
    life: number;
    max: number;
    active: boolean;
  }
  const FLOAT_POOL_SIZE = 8;
  const floatPool: FT[] = Array.from({ length: FLOAT_POOL_SIZE }, () => {
    const t = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "Arial Black",
        fontSize: 22,
        fontWeight: "bold",
        fill: "#FFD700",
        stroke: { color: "#333", width: 3 },
      }),
    });
    t.anchor.set(0.5);
    t.visible = false;
    uiLayer.addChild(t);
    return { t, vy: 0, life: 0, max: 1, active: false };
  });
  let floats: FT[] = [];

  let floatPoolIdx = 0;
  function floatText(x: number, y: number, txt: string, color = "#FFD700") {
    let slot: FT | null = null;
    for (let i = 0; i < FLOAT_POOL_SIZE; i++) {
      const idx = (floatPoolIdx + i) % FLOAT_POOL_SIZE;
      if (!floatPool[idx].active) {
        slot = floatPool[idx];
        floatPoolIdx = (idx + 1) % FLOAT_POOL_SIZE;
        break;
      }
    }
    if (!slot) return;
    slot.t.text = txt;
    (slot.t.style as TextStyle).fill = color;
    slot.t.x = x;
    slot.t.y = y;
    slot.t.alpha = 1;
    slot.t.visible = true;
    slot.vy = -2.2;
    slot.life = 38;
    slot.max = 38;
    slot.active = true;
    floats.push(slot);
  }

  function updateFloats(dt: number) {
    for (const f of floats) {
      f.life -= dt;
      f.t.y += f.vy * dt;
      f.vy *= 0.95;
      f.t.alpha = Math.max(0, f.life / f.max);
      if (f.life <= 0) {
        f.active = false;
        f.t.visible = false;
      }
    }
    let i = floats.length;
    while (i--) {
      if (!floats[i].active) {
        floats[i] = floats[floats.length - 1];
        floats.length--;
      }
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

  // Pre-create heart texts — never destroy/recreate
  const heartTexts = Array.from({ length: 3 }, (_, i) => {
    const h = new Text({
      text: "♥",
      style: new TextStyle({ fontSize: 32, fill: "#ff4466" }),
    });
    h.x = i * 38;
    livesCont.addChild(h);
    return h;
  });

  function refreshLives() {
    for (let i = 0; i < 3; i++) {
      heartTexts[i].text = i < lives ? "♥" : "♡";
      (heartTexts[i].style as TextStyle).fill = i < lives ? "#ff4466" : "#aaa";
    }
  }

  let lastDisplayScore = -1;
  let lastDistance = -1;
  function refreshScore() {
    const s = Math.round(displayScore);
    const d = Math.floor(distance);
    if (s !== lastDisplayScore) {
      scoreText.text = s.toString();
      lastDisplayScore = s;
    }
    if (d !== lastDistance) {
      distText.text = `${d}m`;
      lastDistance = d;
    }
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
      _cbRect.x = c.spr.x - r;
      _cbRect.y = c.spr.y - r;
      _cbRect.w = r * 2;
      _cbRect.h = r * 2;
      if (overlaps(pb, _cbRect)) {
        c.active = false;
        c.spr.visible = false;
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
    if (lives <= 0) {
      pl.dead = true;
      pl.vy = -8;
      pl.deathPhase = 0;
      pl.deathTimer = 0;
      state = "dead";
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

  // Pre-allocated confetti pool — geometry and color drawn ONCE per slot at init
  const CONFETTI_POOL_SIZE = 250;
  const CONFETTI_COLORS = [
    0xffd700, 0xff6b6b, 0x6bcfff, 0x6bff8a, 0xffa500, 0xff69b4, 0xffffff,
  ];
  interface CPart {
    g: Graphics;
    vx: number;
    vy: number;
    vr: number;
    life: number;
    max: number;
    active: boolean;
  }
  const confettiPool: CPart[] = Array.from(
    { length: CONFETTI_POOL_SIZE },
    (_, i) => {
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      const w = 6 + (i % 5) * 1.6,
        h = 5 + (i % 4) * 1.25; // varied but fixed sizes
      const g = new Graphics().rect(0, 0, w, h).fill(color);
      g.visible = false;
      uiLayer.addChild(g);
      return { g, vx: 0, vy: 0, vr: 0, life: 0, max: 1, active: false };
    },
  );
  const confettiParts: CPart[] = [];

  function clearConfetti() {
    if (confettiTicker) {
      app.ticker.remove(confettiTicker);
      confettiTicker = null;
    }
    for (const p of confettiPool) {
      p.active = false;
      p.g.visible = false;
    }
    confettiParts.length = 0;
  }

  let confettiPoolIdx = 0;
  function spawnConfettiBurst(count: number) {
    clearConfetti();
    confettiPoolIdx = 0;

    function addPiece() {
      let slot: CPart | null = null;
      for (let i = 0; i < CONFETTI_POOL_SIZE; i++) {
        const idx = (confettiPoolIdx + i) % CONFETTI_POOL_SIZE;
        if (!confettiPool[idx].active) {
          slot = confettiPool[idx];
          confettiPoolIdx = (idx + 1) % CONFETTI_POOL_SIZE;
          break;
        }
      }
      if (!slot) return;
      // No clear() — geometry pre-drawn at pool creation
      slot.g.x = cachedVLeft + Math.random() * (cachedVRight - cachedVLeft);
      slot.g.y = -20 - Math.random() * 80;
      slot.g.rotation = Math.random() * Math.PI * 2;
      slot.g.alpha = 1;
      slot.g.visible = true;
      const maxLife = 140 + Math.random() * 80;
      slot.vx = (Math.random() - 0.5) * 5;
      slot.vy = 1.5 + Math.random() * 3.5;
      slot.vr = (Math.random() - 0.5) * 0.3;
      slot.life = maxLife;
      slot.max = maxLife;
      slot.active = true;
      confettiParts.push(slot);
    }

    for (let i = 0; i < count; i++) addPiece();

    let spawnTimer = 0;
    confettiTicker = (ticker) => {
      const dt = ticker.deltaTime;
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
        p.g.alpha = p.life < 30 ? Math.max(0, p.life / 30) : 1;
      }
      let ci = confettiParts.length;
      while (ci--) {
        const p = confettiParts[ci];
        if (p.life <= 0 || p.g.y > H + 40) {
          p.active = false;
          p.g.visible = false;
          confettiParts[ci] = confettiParts[confettiParts.length - 1];
          confettiParts.length--;
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
    // Return all pooled enemies and coins to inactive state
    for (const o of obsPool) {
      o.active = false;
      o.spr.visible = false;
    }
    for (const c of coinPool) {
      c.active = false;
      c.spr.visible = false;
    }
    obstacles = [];
    coins = [];
    // Reset particle pool
    for (const pool of allPartPools)
      for (const p of pool) {
        p.active = false;
        p.g.visible = false;
      }
    // Reset float text pool
    for (const f of floatPool) {
      f.active = false;
      f.t.visible = false;
    }
    floats = [];
    clearConfetti();
  }

  function startGame() {
    if (menuCont) {
      uiLayer.removeChild(menuCont);
      menuCont.destroy({ children: true });
      menuCont = null;
    }
    if (goCont) {
      uiLayer.removeChild(goCont);
      goCont.destroy({ children: true });
      goCont = null;
    }
    if (winCont) {
      uiLayer.removeChild(winCont);
      winCont.destroy({ children: true });
      winCont = null;
    }
    clearAll();

    score = 0;
    distance = 0;
    runPx = 0;
    displayScore = 0;
    lastDisplayScore = -1;
    lastDistance = -1;
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
    pl.curRow = -1;
    pl.deathPhase = 0;
    pl.deathTimer = 0;

    // Reset player animation in-place — no destroy/create
    playerAnim.loop = true;
    playerAnim.onComplete = undefined;
    playerAnim.scale.set(CHAR_SCALE);
    playerAnim.y = 0;
    switchAnim(ROW_RUN, 0.15);
    pl.curRow = ROW_RUN;
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
  // INPUT — keyboard + touch (tap = jump)
  // ═══════════════════════════════════════════════════════════

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
  });

  app.canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      tryStartFromAnywhere();
    },
    { passive: false },
  );

  app.canvas.addEventListener(
    "touchend",
    (e) => {
      // On gameover/win screens — tap anywhere opens CTA
      if (state === "gameover") {
        openCta();
        return;
      }
      e.preventDefault();
      if (state === "playing") doJump();
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
    } else if (state === "gameover" && e.pointerType === "mouse") {
      openCta();
    }
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
      refreshScore();

      if (winAnimTimer >= 65) {
        playerCont.scale.set(1);
        state = "dead";
        showWin(); // no setTimeout — called directly
      }
      return;
    }

    // Parallax background — shift tilePosition, zero allocations, zero wrapping
    for (let i = 0; i < bgLayers.length; i++) {
      bgLayers[i].spr.tilePosition.x -= bgLayers[i].spd * dt;
    }

    // Floor scrolls at game speed
    floorScrollX -= speed * dt;
    floorTile.tilePosition.x = floorScrollX;

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
        pl.dead = true;
        pl.deathPhase = 2;
        pl.curRow = -1;
        switchAnim(ROW_IDLE, 0.12);
        spawnDust(pl.x, CHAR_Y, 0xffd700, 18);
      }
    }

    // Spawns only while actively playing — stop well before finish so no mob blocks the gate
    const SPAWN_STOP_DIST = WIN_DIST * 0.87; // stop spawns at 72% of run
    if (state === "playing" && distance < SPAWN_STOP_DIST) {
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

    // Dead state — wait ~108 frames (~1.8s) then show gameover screen
    if (state === "dead" && pl.dead && pl.deathPhase === 2) {
      pl.deathTimer += dt;
      if (pl.deathTimer >= 108) {
        pl.deathTimer = 999; // prevent re-trigger
        showGameOver();
      }
    }

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
