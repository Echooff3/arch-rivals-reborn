



import * as THREE from "three";
import { Court, HoopRefs } from "./court";
import { Ball, Player } from "./entities";
import { Effects } from "./effects";
import { Input } from "./input";
import { UI } from "./ui";
import { PauseMenu } from "./pause";
import { audio } from "./audio";
import { computeAIIntent, applyIntent } from "./ai";
import {
  Team, TEAM_COLORS, ROSTER, COURT, HOOP_X, GAME, BallState, PlayerState,
  STAT, attackingHoopX, defendingHoopX, Character,
} from "./definitions";
import { clamp, distXZ, angleXZ, solveArc, lerpAngle } from "./utils";

enum Phase { Title, Tipoff, Playing, ScoreCelebration, QuarterBreak, GameOver }

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private court!: Court;
  private ball!: Ball;
  private players: Player[] = [];
  private humanIndex = 0;
  private effects!: Effects;
  private input = new Input();
  private ui = new UI();
  private pause!: PauseMenu;
  private paused = false;

  private score = [0, 0]; // home, away
  private quarter = 1;
  private clockTime = GAME.QUARTER_SECONDS;
  private phase: Phase = Phase.Title;
  private phaseTimer = 0;
  private shakeTime = 0;
  private shakeAmp = 0;

  private cameraTargetLook = new THREE.Vector3();
  private cameraTargetPos = new THREE.Vector3();
  private titleAngle = 0;

  // Ball out-of-bounds watchdog
  private ballOOBTimer = 0;
  private ballStuckTimer = 0;
  private lastBallPos = new THREE.Vector3();

  async start(): Promise<void> {
    this.initRenderer();
    this.initScene();
    this.initWorld();
    this.initPlayers();

    this.pause = new PauseMenu(this.input);

    window.addEventListener("resize", () => this.handleResize());

    // Title loop
    this.ui.showTitle();
    this.phase = Phase.Title;

    const startHandler = async () => {
      if (this.phase === Phase.Title) {
        await audio.ensure();
        this.beginMatch();
      } else if (this.phase === Phase.GameOver) {
        this.resetMatch();
      }
    };
    window.addEventListener("keydown", async (e) => {
      if (this.pause.isOpen) return;
      if (e.key === "Enter") await startHandler();
      // ESC to pause mid-game
      if ((e.key === "Escape" || e.key === "p" || e.key === "P") &&
          (this.phase === Phase.Playing || this.phase === Phase.Tipoff || this.phase === Phase.ScoreCelebration)) {
        this.togglePause();
      }
    });
    this._startHandler = startHandler;

    this.animate();
  }

  private _startHandler: (() => Promise<void>) | null = null;

  private togglePause(): void {
    if (this.paused) return; // menu handles its own close
    this.paused = true;
    this.pause.open(() => { this.paused = false; });
  }

  // ---------- Setup ----------
  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);
  }

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 12, 22);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const amb = new THREE.AmbientLight(0x5566aa, 0.55);
    this.scene.add(amb);

    const hemi = new THREE.HemisphereLight(0xffbbdd, 0x221133, 0.4);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(6, 18, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    // Accent lights (pink/cyan neon rim)
    const pink = new THREE.PointLight(0xff2d7a, 1.8, 40, 1.8);
    pink.position.set(-12, 6, -8);
    this.scene.add(pink);
    const cyan = new THREE.PointLight(0x00e5ff, 1.8, 40, 1.8);
    cyan.position.set(12, 6, 8);
    this.scene.add(cyan);

    const gold = new THREE.PointLight(0xffd23f, 1.0, 25, 2);
    gold.position.set(0, 7, 0);
    this.scene.add(gold);
  }

  private initWorld(): void {
    this.court = new Court();
    this.court.build(this.scene);
    this.ball = new Ball();
    this.scene.add(this.ball.mesh);
    this.scene.add(this.ball.trail);
    this.effects = new Effects(this.scene);
  }

  private initPlayers(): void {
    // Pick roster
    const homeChars = [ROSTER[2], ROSTER[1]]; // Hammer, Vinnie
    const awayChars = [ROSTER[7], ROSTER[3]]; // Tank, Mohawk

    const spawnSlots: Array<[number, number, number]> = [
      [-3, -2, 0],    // home 0 (human)
      [-5, 3, 0.2],  // home 1
      [3, 2, Math.PI], // away 0
      [5, -3, Math.PI], // away 1
    ];

    for (let i = 0; i < 4; i++) {
      const team = i < 2 ? Team.Home : Team.Away;
      const chars = team === Team.Home ? homeChars : awayChars;
      const p = new Player(team, chars[i % 2], i);
      const [x, z, facing] = spawnSlots[i];
      p.spawn(x, z, facing);
      this.players.push(p);
      this.scene.add(p.mesh);
    }

    // First player of Home is human
    this.humanIndex = 0;
    this.players[0].setControlled(true);
  }

  // ---------- Match flow ----------
  private beginMatch(): void {
    this.ui.showHUD();
    this.score = [0, 0];
    this.quarter = 1;
    this.clockTime = GAME.QUARTER_SECONDS;
    this.ui.setScore(0, 0);
    this.ui.setQuarter(1);
    this.ui.setClock(this.clockTime);
    this.tipoff("GAME ON!");
  }

  private resetMatch(): void {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const spawnSlots: Array<[number, number, number]> = [
        [-3, -2, 0], [-5, 3, 0.2], [3, 2, Math.PI], [5, -3, Math.PI],
      ];
      p.spawn(...spawnSlots[i]);
    }
    this.beginMatch();
  }

  private tipoff(message?: string): void {
    this.phase = Phase.Tipoff;
    this.phaseTimer = 1.6;
    this.ball.state = BallState.Free;
    this.ball.holder = null;
    this.ball.shooter = null;
    this.ball.pos.set(0, 6, 0);
    this.ball.vel.set(0, 0, 0);
    this.ballOOBTimer = 0;
    this.ballStuckTimer = 0;
    this.lastBallPos.copy(this.ball.pos);
    // Reset player positions
    const slots: Array<[number, number, number]> = [
      [-2.5, -1.2, 0],
      [-6, 4, 0.3],
      [2.5, 1.2, Math.PI],
      [6, -4, Math.PI],
    ];
    for (let i = 0; i < 4; i++) this.players[i].spawn(...slots[i]);
    if (message) this.ui.popup(message);
    audio.whistle();
  }

  private endQuarter(): void {
    audio.buzzer();
    if (this.quarter >= GAME.QUARTERS) {
      this.phase = Phase.GameOver;
      this.ui.showEnd(this.score[0], this.score[1]);
      return;
    }
    this.quarter++;
    this.clockTime = GAME.QUARTER_SECONDS;
    this.ui.setQuarter(this.quarter);
    this.ui.setClock(this.clockTime);
    this.ui.popup(`QUARTER ${this.quarter}`);
    this.tipoff();
  }

  // Reset the ball to center court when it goes out of bounds or gets stuck
  private resetBallToCenter(reason: string): void {
    const nearest = this.players.reduce((best, p) =>
      distXZ(p.pos, new THREE.Vector3(0, 0, 0)) < distXZ(best.pos, new THREE.Vector3(0, 0, 0)) ? p : best
    , this.players[0]);

    // Place the ball above center court and give it to the nearest player
    this.ball.pos.set(0, 4, 0);
    this.ball.vel.set(0, 0, 0);
    this.ball.state = BallState.Free;
    this.ball.holder = null;
    this.ball.shooter = null;
    this.ball.scoreCooldown = 0;
    this.ballOOBTimer = 0;
    this.ballStuckTimer = 0;
    this.lastBallPos.copy(this.ball.pos);

    this.ui.popup("OUT!");
    this.effects.popup("OUT OF BOUNDS", new THREE.Vector3(0, 4, 0), "#ffd23f");
    audio.whistle();
  }

  // Watchdog: ensure ball stays in play, never gets stuck or lost
  private enforceBallBounds(dt: number): void {
    // Hard spatial bounds — absolute safety net
    const maxX = COURT.LENGTH / 2 + 4;
    const maxZ = COURT.WIDTH / 2 + 3;
    const maxY = 25;
    const minY = -2;

    const p = this.ball.pos;

    // Catch NaN / infinity immediately
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z) ||
        !isFinite(this.ball.vel.x) || !isFinite(this.ball.vel.y) || !isFinite(this.ball.vel.z)) {
      this.resetBallToCenter("NaN");
      return;
    }

    if (p.y > maxY) { this.resetBallToCenter("too high"); return; }
    if (p.y < minY) { this.resetBallToCenter("below floor"); return; }

    const outX = Math.abs(p.x) > maxX;
    const outZ = Math.abs(p.z) > maxZ;
    if ((outX || outZ) && !this.ball.isHeld) {
      this.ballOOBTimer += dt;
      if (this.ballOOBTimer > 0.6) { this.resetBallToCenter("OOB"); return; }
    } else {
      this.ballOOBTimer = 0;
    }

    if (!this.ball.isHeld && this.phase === Phase.Playing) {
      const moved = this.lastBallPos.distanceTo(p);
      this.lastBallPos.copy(p);

      const onGround = p.y < 0.4 && Math.abs(this.ball.vel.y) < 1;
      const slow = this.ball.vel.lengthSq() < 0.25;
      const nearestPlayerDist = Math.min(...this.players.map(pl => distXZ(pl.pos, p)));

      if (onGround && slow && nearestPlayerDist > 2.5) {
        this.ballStuckTimer += dt;
      } else if (moved > 0.02) {
        this.ballStuckTimer = Math.max(0, this.ballStuckTimer - dt);
      }

      if (this.ballStuckTimer > 5) { this.resetBallToCenter("stuck"); return; }

      if (!onGround && this.ball.state !== BallState.Shot && this.ball.state !== BallState.Pass) {
        if (p.y > 6 && this.ball.vel.lengthSq() < 0.5) {
          this.ballStuckTimer += dt;
        }
      }
    } else {
      this.ballStuckTimer = 0;
      this.lastBallPos.copy(p);
    }
  }

  // ---------- Frame loop ----------
  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Poll gamepad FIRST
    this.input.pollGamepad();

    // Pause toggling via gamepad START is allowed any time during a match
    if (this.input.wasStartPressed()) {
      const inMatch = this.phase === Phase.Playing || this.phase === Phase.Tipoff || this.phase === Phase.ScoreCelebration;
      if (this.paused) {
        // Pause menu handles START internally; still, if somehow not, close it.
        // We just don't toggle here — pause.tick() will see it.
      } else if (inMatch) {
        this.togglePause();
      } else if ((this.phase === Phase.Title || this.phase === Phase.GameOver) && this._startHandler) {
        // START also confirms on title/gameover
        this._startHandler();
      }
    }

    // Enter on title/gameover
    if (this.input.wasPressed("enter") && this._startHandler && !this.paused) {
      if (this.phase === Phase.Title || this.phase === Phase.GameOver) {
        this._startHandler();
      }
    }

    if (this.paused) {
      // While paused: menu runs, world holds still
      this.pause.tick(dt);
      // Still render the scene beneath so the blurred backdrop works
      this.input.endFrame();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.phase === Phase.Title) {
      this.updateTitle(dt, t);
    } else {
      this.updateMatch(dt, t);
    }

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  };

  private updateTitle(dt: number, t: number): void {
    this.titleAngle += dt * 0.25;
    const r = 22;
    this.camera.position.set(Math.cos(this.titleAngle) * r, 7 + Math.sin(t * 0.5) * 1.5, Math.sin(this.titleAngle) * r);
    this.camera.lookAt(0, 2, 0);
    this.ball.pos.set(0, 1.5 + Math.sin(t * 2) * 0.3, 0);
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.core.rotation.y = t * 2;
    this.ball.core.rotation.x = t * 0.7;
    this.court.update(dt, t);
    for (const p of this.players) p.update(dt, t);
    this.effects.update(dt);
  }

  private updateMatch(dt: number, t: number): void {
    // Phase timing
    if (this.phase === Phase.Tipoff) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = Phase.Playing;
      }
    } else if (this.phase === Phase.ScoreCelebration) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.tipoff();
      }
    } else if (this.phase === Phase.Playing) {
      this.clockTime -= dt;
      this.ui.setClock(this.clockTime);
      if (this.clockTime <= 0) {
        this.clockTime = 0;
        this.endQuarter();
        return;
      }
    }

    // Human control
    if (this.phase === Phase.Playing || this.phase === Phase.Tipoff) {
      this.updateHumanInput(dt);
      // AI for others
      for (let i = 0; i < this.players.length; i++) {
        if (i === this.humanIndex) continue;
        const p = this.players[i];
        const ctx = {
          self: p,
          ball: this.ball,
          teammates: this.players.filter(q => q !== p && q.team === p.team),
          opponents: this.players.filter(q => q.team !== p.team),
          holder: this.ball.holder,
          targetHoopX: attackingHoopX(p.team),
          ownHoopX: defendingHoopX(p.team),
        };
        const intent = computeAIIntent(ctx, dt);
        applyIntent(p, intent, dt);
        if (intent.shoot && this.ball.holder === p) this.tryShoot(p);
        if (intent.punch) this.tryPunch(p);
      }
    }

    // Update entities
    for (const p of this.players) p.update(dt, t);
    this.ball.update(dt, t);
    this.effects.update(dt);
    this.court.update(dt, t);

    // Physics interactions
    this.handleBallPickup();
    this.handlePlayerCollisions();
    this.handleScoring();

    // Safety net
    this.enforceBallBounds(dt);

    // Camera
    this.updateCamera(dt, t);

    // Possession indicator
    const holder = this.ball.holder;
    const human = this.players[this.humanIndex];
    const padHint = this.input.hasGamepad;
    if (holder === human) {
      this.ui.setPossession(padHint
        ? "SHOOT • PASS • PUNCH   (START = PAUSE)"
        : "J = SHOOT   •   L = PASS   •   K = PUNCH");
    } else if (holder && holder.team === Team.Home) {
      this.ui.setPossession(`${holder.character.name} HAS IT  •  ${padHint ? "SWITCH" : "TAB"} = SWITCH`);
    } else if (holder) {
      this.ui.setPossession(`${holder.character.name} (AWAY) HAS IT  •  PUNCH TO STEAL`);
    } else if (this.ball.shooter) {
      this.ui.setPossession(`${this.ball.shooter.character.name} SHOOTS...`);
    } else {
      this.ui.setPossession("LOOSE BALL — GRAB IT!");
    }
  }

  // ---------- Human control ----------
  private updateHumanInput(dt: number): void {
    // Auto-switch to teammate with ball
    const holder = this.ball.holder;
    if (holder && holder.team === Team.Home) {
      const holderIdx = this.players.indexOf(holder);
      if (holderIdx !== this.humanIndex) {
        this.players[this.humanIndex].setControlled(false);
        this.humanIndex = holderIdx;
        holder.setControlled(true);
      }
    }

    const p = this.players[this.humanIndex];
    if (p.stunTimer > 0) return;

    // Movement
    let mx = 0, mz = 0;
    const axis = this.input.getMoveAxis();
    if (Math.abs(axis.x) > 0.02 || Math.abs(axis.y) > 0.02) {
      mx = axis.x;
      mz = axis.y;
    } else {
      if (this.input.isDown("w", "arrowup")) mz -= 1;
      if (this.input.isDown("s", "arrowdown")) mz += 1;
      if (this.input.isDown("a", "arrowleft")) mx -= 1;
      if (this.input.isDown("d", "arrowright")) mx += 1;
    }

    const len = Math.sqrt(mx * mx + mz * mz);
    const moveMag = Math.min(1, len);
    if (len > 0.001) { mx /= len; mz /= len; }

    const sprint = this.input.isDown("shift");
    const baseSp = sprint ? STAT.sprint(p.character.speed) : STAT.speed(p.character.speed);
    const sp = baseSp * moveMag;

    p.vel.x = mx * sp;
    p.vel.z = mz * sp;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;

    if (this.ball.holder === p) {
      const hoopX = attackingHoopX(p.team);
      const targetFacing = Math.atan2(hoopX - p.pos.x, 0 - p.pos.z);
      p.facing = this.lerpAngleShort(p.facing, targetFacing, dt * 8);
    } else if (moveMag > 0.1) {
      const targetFacing = Math.atan2(mx, mz);
      p.facing = this.lerpAngleShort(p.facing, targetFacing, dt * 12);
    }

    if (this.input.wasPressed("tab")) {
      this.switchToClosestTeammate();
      audio.blip(660);
    }

    if (this.input.wasPressed("j")) {
      if (this.ball.holder === p) this.tryShoot(p);
    }
    if (this.input.wasPressed("l", " ")) {
      if (this.ball.holder === p) {
        const teammate = this.pickPassTarget(p);
        if (teammate) this.tryPass(p, teammate);
        else this.tryShoot(p);
      }
    }
    if (this.input.wasPressed("k")) this.tryPunch(p);
  }

  private pickPassTarget(p: Player): Player | null {
    const candidates = this.players.filter(q => q !== p && q.team === p.team && q.stunTimer <= 0);
    if (candidates.length === 0) return null;

    const hoopX = attackingHoopX(p.team);
    let best: Player | null = null;
    let bestScore = -Infinity;

    for (const q of candidates) {
      const d = distXZ(p.pos, q.pos);
      if (d < 0.5) continue;

      const advance = (hoopX > 0 ? q.pos.x - p.pos.x : p.pos.x - q.pos.x);
      const distScore = d < 16 ? 1 : 16 / d;
      const score = advance * 0.6 + distScore * 4 - d * 0.05;

      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best ?? candidates[0];
  }

  private switchToClosestTeammate(): void {
    const current = this.players[this.humanIndex];
    current.setControlled(false);
    const teammates = this.players.filter((p, i) => p.team === Team.Home && i !== this.humanIndex);
    if (teammates.length === 0) { current.setControlled(true); return; }
    teammates.sort((a, b) => distXZ(a.pos, this.ball.pos) - distXZ(b.pos, this.ball.pos));
    const next = teammates[0];
    this.humanIndex = this.players.indexOf(next);
    next.setControlled(true);
  }

  private lerpAngleShort(a: number, b: number, t: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }

  // ---------- Actions ----------
  private tryShoot(p: Player): void {
    if (this.ball.holder !== p) return;
    if (p.shootCooldown > 0) return;
    p.shootCooldown = GAME.SHOOT_COOLDOWN;
    p.shootTimer = 0.35;
    const hoopX = attackingHoopX(p.team);
    const hoopPos = new THREE.Vector3(hoopX, COURT.HOOP_HEIGHT, 0);
    const start = p.handPosition();
    const dx = hoopPos.x - start.x;
    const dy = hoopPos.y - start.y;
    const dz = hoopPos.z - start.z;
    let vel = solveArc(dx, dy, dz, GAME.SHOOT_ARC, -18);

    const baseErr = STAT.accuracy(p.character.accuracy);
    const errRad = p.isHuman ? baseErr * 0.6 : baseErr;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const distMul = clamp(horiz / 8, 0.6, 1.7);
    const eyaw = (Math.random() - 0.5) * errRad * distMul;
    const epitch = (Math.random() - 0.5) * errRad * distMul * 0.6;
    const yaw = Math.atan2(vel.x, vel.z) + eyaw;
    const speed = vel.length();
    const pitch = Math.asin(clamp(vel.y / speed, -1, 1)) + epitch;
    const newVH = Math.cos(pitch) * speed;
    vel = new THREE.Vector3(Math.sin(yaw) * newVH, Math.sin(pitch) * speed, Math.cos(yaw) * newVH);

    const maxShotSpeed = 22;
    if (vel.length() > maxShotSpeed) vel.setLength(maxShotSpeed);

    this.ball.pos.copy(start);
    this.ball.release(BallState.Shot, vel, p);
    this.ball.shotValue = horiz >= COURT.THREE_POINT_RADIUS ? 3 : 2;
    this.ball.scoreCooldown = 0;
    this.effects.burst(p.handPosition(), 0xffd23f, 8, { speed: 3, size: 0.6, life: 0.4 });
    audio.blip(1100);

    if (p.isHuman) {
      const tag = this.ball.shotValue === 3 ? "3PT!" : "SHOOT!";
      this.effects.popup(tag, p.pos.clone().setY(2.6), "#ffd23f");
      this.input.rumble(120, 0.2, 0.35);
    }
  }

  private tryPass(p: Player, to: Player): void {
    if (this.ball.holder !== p) return;
    if (p.passCooldown > 0) return;
    p.passCooldown = GAME.PASS_COOLDOWN;

    p.facing = Math.atan2(to.pos.x - p.pos.x, to.pos.z - p.pos.z);

    const start = p.handPosition();
    const horizDist = distXZ(p.pos, to.pos);
    const flightTime = clamp(horizDist / 16, 0.2, 0.8);
    const lead = new THREE.Vector3(
      to.pos.x + to.vel.x * flightTime * 0.9,
      1.25,
      to.pos.z + to.vel.z * flightTime * 0.9,
    );

    const dx = lead.x - start.x;
    const dy = lead.y - start.y;
    const dz = lead.z - start.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);

    const g = 18;
    const t = clamp(horiz / 14, 0.22, 0.7);
    const vx = dx / t;
    const vz = dz / t;
    const vy = (dy + 0.5 * g * t * t) / t;
    let vel = new THREE.Vector3(vx, vy, vz);

    const maxPassSpeed = 24;
    if (vel.length() > maxPassSpeed) vel.setLength(maxPassSpeed);

    this.ball.pos.copy(start);
    this.ball.release(BallState.Pass, vel, p);
    audio.blip(520);

    this.effects.burst(start, 0x00e5ff, 6, { speed: 2.5, size: 0.5, life: 0.35 });
    if (p.isHuman) {
      this.effects.popup(`→ ${to.character.name}`, p.pos.clone().setY(2.6), "#00e5ff");
      this.input.rumble(80, 0.15, 0.25);
    }
  }

  private tryPunch(p: Player): void {
    if (p.stunTimer > 0) return;
    if (p.punchCooldown > 0) return;
    p.punchCooldown = GAME.PUNCH_COOLDOWN;
    p.state = PlayerState.Punching;
    setTimeout(() => { if (p.state === PlayerState.Punching) p.state = PlayerState.Idle; }, 250);

    const forward = new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing));
    let best: Player | null = null;
    let bestDot = 0.5;
    for (const q of this.players) {
      if (q === p || q.team === p.team) continue;
      const to = new THREE.Vector3(q.pos.x - p.pos.x, 0, q.pos.z - p.pos.z);
      const d = to.length();
      if (d > GAME.PUNCH_RANGE) continue;
      to.normalize();
      const dot = forward.dot(to);
      if (dot > bestDot) { bestDot = dot; best = q; }
    }

    const swingPos = p.pos.clone().add(forward.multiplyScalar(0.9)).setY(1.3);
    this.effects.burst(swingPos, 0xffffff, 4, { speed: 2, size: 0.4, life: 0.2 });

    if (best) {
      const dir = new THREE.Vector3(best.pos.x - p.pos.x, 0, best.pos.z - p.pos.z).normalize();
      const power = STAT.power(p.character.power);
      best.applyKnockback(dir, power);

      if (this.ball.holder === best) {
        this.ball.holder = null;
        const steal = Math.random() < 0.35;
        if (steal) this.ball.placeInHand(p);
        else {
          this.ball.pos.copy(best.pos).setY(1.5);
          this.ball.release(BallState.Free, new THREE.Vector3(dir.x * 3, 4, dir.z * 3));
        }
      }

      audio.punch();
      this.effects.burst(best.pos.clone().setY(1.5), 0xff2d7a, 22, { speed: 7, size: 1.2, life: 0.7 });
      this.effects.popup("BAM!", best.pos.clone().setY(2.8), "#ff2d7a");
      this.shake(0.35, 0.35);
      if (p.isHuman) this.input.rumble(250, 0.9, 0.7);
    } else {
      audio.blip(220);
      if (p.isHuman) this.input.rumble(50, 0.1, 0.1);
    }
  }

  // ---------- Ball pickup / collisions ----------
  private handleBallPickup(): void {
    if (this.ball.isHeld) return;
    if (this.ball.airTime < 0.15 && this.ball.state !== BallState.Free) return;

    let best: Player | null = null;
    let bestDist = GAME.PICKUP_RADIUS;
    for (const p of this.players) {
      if (p.stunTimer > 0) continue;
      if (this.ball.state === BallState.Shot && this.ball.shooter === p && this.ball.airTime < 0.6) continue;
      const d = distXZ(p.pos, this.ball.pos);
      if (d < bestDist && this.ball.pos.y < 2.2) { bestDist = d; best = p; }
    }
    if (best) {
      if (this.ball.state === BallState.Pass && this.ball.shooter && this.ball.shooter.team !== best.team) {
        this.effects.popup("PICKED!", best.pos.clone().setY(2.8), "#00e5ff");
      }
      this.ball.placeInHand(best);
      audio.bounce();
    }
  }

  private handlePlayerCollisions(): void {
    const r = 0.55;
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], b = this.players[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = r * 2;
        if (d < min && d > 0.001) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  // ---------- Scoring ----------
  private handleScoring(): void {
    if (this.ball.scoreCooldown > 0) return;
    if (this.ball.state === BallState.Held) return;
    for (const hoop of this.court.hoops) {
      const rim = hoop.rimCenter;
      const dx = this.ball.pos.x - rim.x;
      const dz = this.ball.pos.z - rim.z;
      const horizDist = Math.sqrt(dx * dx + dz * dz);
      if (horizDist < COURT.RIM_RADIUS * 0.9 &&
          this.ball.pos.y < rim.y + 0.15 && this.ball.pos.y > rim.y - 0.25 &&
          this.ball.vel.y < 0) {
        this.ball.scoreCooldown = 1.2;
        this.onScore(hoop);
        return;
      }
      if (horizDist > COURT.RIM_RADIUS * 0.9 && horizDist < COURT.RIM_RADIUS * 1.3 &&
          Math.abs(this.ball.pos.y - rim.y) < 0.2) {
        const nx = dx / horizDist, nz = dz / horizDist;
        this.ball.vel.x = nx * 3 + this.ball.vel.x * 0.2;
        this.ball.vel.z = nz * 3 + this.ball.vel.z * 0.2;
        this.ball.vel.y = Math.abs(this.ball.vel.y) * 0.5 + 1;
        audio.rim();
        this.ball.scoreCooldown = 0.25;
      }
    }
  }

  private onScore(hoop: HoopRefs): void {
    const scoringTeam: Team = hoop.side === 1 ? Team.Home : Team.Away;
    const shooter = this.ball.shooter;
    const points = this.ball.shotValue;
    this.score[scoringTeam] += points;
    this.ui.setScore(this.score[Team.Home], this.score[Team.Away]);

    const msg = points === 3 ? "3-POINTER!" : (shooter && distXZ(shooter.pos, hoop.rimCenter) < 2 ? "DUNK!" : "SCORE!");
    this.ui.popup(msg);

    if (shooter) {
      shooter.celebrateTimer = 1.2;
      shooter.state = PlayerState.Celebrating;
    }

    audio.swish();
    audio.cheer();
    this.effects.burst(hoop.rimCenter.clone(), 0xffd23f, 25, { speed: 5, size: 1, life: 0.9 });
    this.effects.confetti(new THREE.Vector3(hoop.rimCenter.x, hoop.rimCenter.y + 0.5, 0));
    this.effects.popup(msg, new THREE.Vector3(hoop.rimCenter.x, hoop.rimCenter.y + 1.5, 0), points === 3 ? "#00e5ff" : "#ffd23f");
    this.shake(0.6, 0.5);

    if (scoringTeam === Team.Home) this.input.rumble(400, 0.8, 0.5);

    this.phase = Phase.ScoreCelebration;
    this.phaseTimer = 1.8;
  }

  // ---------- Camera ----------
  private updateCamera(dt: number, t: number): void {
    const human = this.players[this.humanIndex];
    const focus = this.ball.holder?.pos ?? this.ball.pos;
    const mid = human.pos.clone().lerp(focus, 0.5);
    this.cameraTargetLook.lerp(new THREE.Vector3(mid.x, 1.2, mid.z), 0.08);

    const bias = clamp(mid.x * 0.35, -5, 5);
    const desired = new THREE.Vector3(bias, 9.5, 18);
    this.cameraTargetPos.lerp(desired, 0.05);

    this.camera.position.copy(this.cameraTargetPos);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * (this.shakeTime / 0.35);
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.cameraTargetLook);
  }

  private shake(amp: number, time: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

