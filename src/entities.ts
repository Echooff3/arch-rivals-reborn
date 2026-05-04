

import * as THREE from "three";
import {
  Team, TEAM_COLORS, Character, STAT, PlayerState, BallState,
  COURT, HOOP_X, GAME, PALETTE, attackingHoopX, defendingHoopX,
} from "./definitions";
import { clamp, distXZ, lerpAngle, makeCanvasTexture, solveArc, angleXZ } from "./utils";

// ---------- Ball ----------
export class Ball {
  mesh: THREE.Group;
  core: THREE.Mesh;
  shadow: THREE.Mesh;
  trail: THREE.Points;
  trailPositions: Float32Array;
  trailIndex = 0;
  readonly trailLen = 40;

  pos = new THREE.Vector3(0, 2, 0);
  vel = new THREE.Vector3();
  state: BallState = BallState.Free;
  holder: Player | null = null;
  lastHolder: Player | null = null;
  shooter: Player | null = null; // who took the current shot
  shotValue = 2;
  pointsEarned = 0; // set when score is detected
  scoreCooldown = 0; // prevent double scoring
  onGround = false;
  rotationAxis = new THREE.Vector3(1, 0, 0);
  spin = 0;
  airTime = 0; // time since last ground contact / held

  constructor() {
    this.mesh = new THREE.Group();

    const tex = makeCanvasTexture(256, 256, (ctx) => {
      // base
      const g = ctx.createRadialGradient(128, 90, 20, 128, 128, 140);
      g.addColorStop(0, "#ff9255");
      g.addColorStop(0.6, "#d4621f");
      g.addColorStop(1, "#7a3410");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      // nubs / texture
      for (let i = 0; i < 1200; i++) {
        ctx.fillStyle = `rgba(40,15,5,${Math.random() * 0.2})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
      }
      // seams
      ctx.strokeStyle = "#1a0a05";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 128, 90, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 128, 90, Math.PI * 1.5, Math.PI * 0.5); ctx.stroke();
    });

    const geo = new THREE.SphereGeometry(0.24, 32, 24);
    this.core = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 })
    );
    this.core.castShadow = true;
    this.mesh.add(this.core);

    // shadow disc
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.mesh.add(this.shadow);

    // Trail
    this.trailPositions = new Float32Array(this.trailLen * 3);
    for (let i = 0; i < this.trailLen; i++) {
      this.trailPositions[i * 3] = 0;
      this.trailPositions[i * 3 + 1] = -10;
      this.trailPositions[i * 3 + 2] = 0;
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    const tmat = new THREE.PointsMaterial({
      size: 0.18, color: 0xff8844, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.trail = new THREE.Points(tgeo, tmat);
  }

  get isHeld(): boolean { return this.state === BallState.Held; }
  get isFlying(): boolean { return this.state === BallState.Shot || this.state === BallState.Pass; }

  placeInHand(holder: Player): void {
    this.state = BallState.Held;
    this.holder = holder;
    this.lastHolder = holder;
    this.shooter = null;
    this.vel.set(0, 0, 0);
    this.airTime = 0;
  }

  release(state: BallState, vel: THREE.Vector3, shooter?: Player): void {
    this.state = state;
    this.holder = null;
    this.vel.copy(vel);
    this.airTime = 0;
    if (shooter) this.shooter = shooter;

    // Clamp speed so a pathological solve can never send the ball into orbit
    const maxSpeed = 30;
    if (this.vel.length() > maxSpeed) this.vel.setLength(maxSpeed);
  }

  updateFree(dt: number): void {
    // gravity
    this.vel.y -= 18 * dt;

    // Terminal velocity guards (belt & braces)
    const maxV = 40;
    if (this.vel.lengthSq() > maxV * maxV) this.vel.setLength(maxV);

    this.pos.addScaledVector(this.vel, dt);
    this.airTime += dt;

    // Hard ceiling — bounce down so nothing escapes upward
    const ceiling = 14;
    if (this.pos.y > ceiling) {
      this.pos.y = ceiling;
      if (this.vel.y > 0) this.vel.y = -this.vel.y * 0.4;
    }

    // Floor bounce
    if (this.pos.y < 0.24) {
      this.pos.y = 0.24;
      if (this.vel.y < 0) {
        const speed = this.vel.length();
        this.vel.y = -this.vel.y * 0.62;
        this.vel.x *= 0.78;
        this.vel.z *= 0.78;
        if (speed > 2) this.onGround = true;
      }
      if (Math.abs(this.vel.y) < 0.8) this.vel.y = 0;
      this.airTime = 0;
    }

    // Damping when rolling
    if (this.pos.y <= 0.245 && Math.abs(this.vel.y) < 0.1) {
      this.vel.x *= 0.96;
      this.vel.z *= 0.96;
    }

    // Hard boundary walls — clamp and reflect to keep ball on the floor
    const bx = COURT.LENGTH / 2 + 3;
    const bz = COURT.WIDTH / 2 + 2;
    if (this.pos.x > bx)  { this.pos.x = bx;  if (this.vel.x > 0) this.vel.x = -this.vel.x * 0.5; }
    if (this.pos.x < -bx) { this.pos.x = -bx; if (this.vel.x < 0) this.vel.x = -this.vel.x * 0.5; }
    if (this.pos.z > bz)  { this.pos.z = bz;  if (this.vel.z > 0) this.vel.z = -this.vel.z * 0.5; }
    if (this.pos.z < -bz) { this.pos.z = -bz; if (this.vel.z < 0) this.vel.z = -this.vel.z * 0.5; }

    // Revert to FREE once slow
    if (this.state !== BallState.Held && this.pos.y < 0.3 && this.vel.length() < 1.5) {
      this.state = BallState.Free;
    }

    this.spin += this.vel.length() * dt * 2.5;
    this.rotationAxis.set(-this.vel.z, 0, this.vel.x).normalize();
  }

  update(dt: number, t: number): void {
    if (this.scoreCooldown > 0) this.scoreCooldown -= dt;

    if (this.isHeld && this.holder) {
      // dribble bob when moving, still when idle
      const moving = this.holder.vel.lengthSq() > 0.5;
      const base = this.holder.mesh.position.clone();
      const forward = new THREE.Vector3(Math.sin(this.holder.facing), 0, Math.cos(this.holder.facing));
      base.add(forward.multiplyScalar(0.55));
      let by = 1.25;
      if (moving) {
        by = 0.4 + Math.abs(Math.sin(t * 10)) * 0.55;
      } else {
        by = 1.1 + Math.sin(t * 3) * 0.05;
      }
      this.pos.set(base.x, by, base.z);
      this.vel.set(0, 0, 0);
      this.spin += dt * 6;
      this.rotationAxis.set(1, 0, 0);
      this.airTime = 0;
    } else {
      this.updateFree(dt);
    }

    // Final sanity: if anything went NaN, snap to a safe spot
    if (!isFinite(this.pos.x) || !isFinite(this.pos.y) || !isFinite(this.pos.z)) {
      this.pos.set(0, 4, 0);
      this.vel.set(0, 0, 0);
      this.state = BallState.Free;
      this.holder = null;
    }

    this.mesh.position.copy(this.pos);
    this.core.rotateOnWorldAxis(this.rotationAxis.clone().normalize(), this.spin * dt);
    this.spin *= 0.98;

    // Shadow
    const groundY = 0.01;
    const h = Math.max(0, this.pos.y - 0.24);
    this.shadow.position.set(0, -this.pos.y + groundY, 0);
    const s = clamp(1.2 - h * 0.08, 0.3, 1.3);
    this.shadow.scale.set(s, s, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(0.5 - h * 0.04, 0.08, 0.5);

    // Trail
    const visible = this.isFlying || (!this.isHeld && this.vel.length() > 3);
    this.trailPositions[this.trailIndex * 3] = this.pos.x;
    this.trailPositions[this.trailIndex * 3 + 1] = visible ? this.pos.y : -100;
    this.trailPositions[this.trailIndex * 3 + 2] = this.pos.z;
    this.trailIndex = (this.trailIndex + 1) % this.trailLen;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- Player ----------
export class Player {
  mesh: THREE.Group;
  team: Team;
  character: Character;
  index: number; // 0..3

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0; // yaw
  state: PlayerState = PlayerState.Idle;
  stateTimer = 0;

  isHuman = false;
  punchCooldown = 0;
  shootCooldown = 0;
  passCooldown = 0;
  stunTimer = 0;
  shootTimer = 0; // when >0, in shooting wind-up
  celebrateTimer = 0;

  // Animation helpers
  private bodyParts: {
    head: THREE.Mesh;
    torso: THREE.Mesh;
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    nameSprite?: THREE.Sprite;
    outline?: THREE.Mesh;
  };
  private animT = 0;
  private initialY = 0;

  constructor(team: Team, character: Character, index: number) {
    this.team = team;
    this.character = character;
    this.index = index;
    this.mesh = new THREE.Group();
    this.bodyParts = this.buildMesh();
  }

  private buildMesh(): Player["bodyParts"] {
    const colors = TEAM_COLORS[this.team];
    const jerseyColor = colors.primary;
    const shortsColor = colors.secondary;
    const skinColor = 0xb87450;

    // Torso
    const torsoMat = new THREE.MeshStandardMaterial({
      color: jerseyColor,
      roughness: 0.6,
      metalness: 0.05,
      emissive: colors.glow,
      emissiveIntensity: 0.06,
    });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), torsoMat);
    torso.position.y = 1.3;
    torso.castShadow = true;

    // Jersey number canvas
    const numTex = makeCanvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = "#ffffff";
      ctx.font = 'bold 80px "Bungee", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(this.index + 1), 64, 68);
    });
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    const numFront = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), numMat);
    numFront.position.set(0, 1.3, 0.23);
    const numBack = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), numMat);
    numBack.position.set(0, 1.3, -0.23);
    numBack.rotation.y = Math.PI;

    // Shorts
    const shortsMat = new THREE.MeshStandardMaterial({ color: shortsColor, roughness: 0.7 });
    const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.35, 0.47), shortsMat);
    shorts.position.y = 0.78;
    shorts.castShadow = true;

    // Head
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), skinMat);
    head.position.y = 1.95;
    head.castShadow = true;
    // Simple face detail
    const faceTex = makeCanvasTexture(64, 64, (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      // eyes
      ctx.fillStyle = "#000";
      ctx.fillRect(20, 28, 5, 5);
      ctx.fillRect(39, 28, 5, 5);
      // mouth
      ctx.fillRect(24, 42, 16, 3);
    });
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.48),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
    );
    face.position.set(0, 1.95, 0.255);

    // Arms (group around shoulder for easy rotation)
    const makeArm = (sign: number) => {
      const g = new THREE.Group();
      g.position.set(sign * 0.46, 1.65, 0);
      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.55, 10),
        new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.6 })
      );
      upper.position.y = -0.28;
      upper.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), skinMat);
      hand.position.y = -0.6;
      hand.castShadow = true;
      g.add(upper);
      g.add(hand);
      return g;
    };

    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    // Legs
    const makeLeg = (sign: number) => {
      const g = new THREE.Group();
      g.position.set(sign * 0.18, 0.6, 0);
      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.12, 0.55, 10),
        new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 })
      );
      thigh.position.y = -0.3;
      thigh.castShadow = true;
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.15, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 })
      );
      shoe.position.set(0, -0.62, 0.08);
      shoe.castShadow = true;
      const sole = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.06, 0.47),
        new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.4, emissive: colors.glow, emissiveIntensity: 0.2 })
      );
      sole.position.set(0, -0.69, 0.08);
      g.add(thigh);
      g.add(shoe);
      g.add(sole);
      return g;
    };

    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    // Glow aura disc (hidden by default, appears for human-controlled)
    const auraTex = makeCanvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
      g.addColorStop(0, "rgba(255,255,255,0.8)");
      g.addColorStop(0.5, "rgba(255,210,63,0.4)");
      g.addColorStop(1, "rgba(255,210,63,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    const aura = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshBasicMaterial({
        map: auraTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      })
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.02;

    // Name tag sprite
    const nameTex = makeCanvasTexture(256, 64, (ctx) => {
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 16, 256, 32);
      ctx.strokeStyle = `#${colors.primary.toString(16).padStart(6, "0")}`;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 16, 256, 32);
      ctx.fillStyle = "#fff";
      ctx.font = 'bold 22px "Orbitron", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.character.name, 128, 33);
    });
    const nameSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthTest: false })
    );
    nameSprite.scale.set(2, 0.5, 1);
    nameSprite.position.y = 2.55;
    nameSprite.renderOrder = 100;

    this.mesh.add(torso, shorts, head, face, numFront, numBack, leftArm, rightArm, leftLeg, rightLeg, aura, nameSprite);

    (this as any)._aura = aura;

    return { head, torso, leftArm, rightArm, leftLeg, rightLeg, nameSprite };
  }

  setControlled(isHuman: boolean): void {
    this.isHuman = isHuman;
    const aura = (this as any)._aura as THREE.Mesh | undefined;
    if (aura) (aura.material as THREE.MeshBasicMaterial).opacity = isHuman ? 0.9 : 0;
  }

  applyKnockback(dir: THREE.Vector3, power: number): void {
    this.vel.x = dir.x * power;
    this.vel.z = dir.z * power;
    this.stunTimer = GAME.STUN_DURATION;
    this.state = PlayerState.Stunned;
  }

  spawn(x: number, z: number, facing: number): void {
    this.pos.set(x, 0, z);
    this.facing = facing;
    this.vel.set(0, 0, 0);
    this.stunTimer = 0;
    this.state = PlayerState.Idle;
  }

  update(dt: number, t: number): void {
    // Cooldowns
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.passCooldown = Math.max(0, this.passCooldown - dt);

    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      // Apply knockback velocity, damped
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.vel.x *= 0.88;
      this.vel.z *= 0.88;
      if (this.stunTimer <= 0) {
        this.state = PlayerState.Idle;
        this.vel.set(0, 0, 0);
      }
    }

    // Clamp to playable area. Allow going behind the hoops (past the baseline)
    // so players can chase balls that end up behind the rim.
    const bx = COURT.LENGTH / 2 + 2.2; // extended area behind baselines
    const bz = COURT.WIDTH / 2 - 0.3;
    this.pos.x = clamp(this.pos.x, -bx, bx);
    this.pos.z = clamp(this.pos.z, -bz, bz);

    this.mesh.position.copy(this.pos);

    // Face smoothly
    this.mesh.rotation.y = this.facing;

    // Animate
    this.animT += dt;
    const speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    const running = speed > 0.4 && this.stunTimer <= 0;

    const { leftArm, rightArm, leftLeg, rightLeg, torso, head } = this.bodyParts;

    if (this.stunTimer > 0) {
      // Spin + tilt when stunned
      this.mesh.rotation.z = Math.sin(this.stunTimer * 18) * 0.6;
      head.rotation.z = Math.sin(this.animT * 20) * 0.5;
      leftLeg.rotation.x = 0.8;
      rightLeg.rotation.x = -0.8;
    } else {
      this.mesh.rotation.z = 0;
      head.rotation.z = 0;
      if (running) {
        const w = this.animT * 12;
        const amp = 0.9;
        leftLeg.rotation.x = Math.sin(w) * amp;
        rightLeg.rotation.x = -Math.sin(w) * amp;
        leftArm.rotation.x = -Math.sin(w) * amp * 0.8;
        rightArm.rotation.x = Math.sin(w) * amp * 0.8;
        torso.rotation.x = Math.sin(w * 2) * 0.04;
        this.mesh.position.y = Math.abs(Math.sin(w)) * 0.08;
      } else {
        // idle breathe
        leftLeg.rotation.x *= 0.85;
        rightLeg.rotation.x *= 0.85;
        leftArm.rotation.x *= 0.85;
        rightArm.rotation.x *= 0.85;
        torso.rotation.x = Math.sin(t * 1.2) * 0.02;
        this.mesh.position.y = Math.sin(t * 1.2) * 0.015;
      }
    }

    // Shooting wind-up: right arm up
    if (this.shootTimer > 0) {
      this.shootTimer -= dt;
      const p = 1 - (this.shootTimer / 0.35);
      rightArm.rotation.x = -Math.PI * 0.9 * clamp(p, 0, 1);
      leftArm.rotation.x = -Math.PI * 0.5 * clamp(p, 0, 1);
    }

    // Punching wind-up: right arm forward
    if (this.state === PlayerState.Punching) {
      rightArm.rotation.x = -Math.PI / 2;
      rightArm.rotation.z = -0.3;
    } else {
      rightArm.rotation.z *= 0.8;
    }

    // Celebration
    if (this.celebrateTimer > 0) {
      this.celebrateTimer -= dt;
      const c = Math.sin(this.animT * 15);
      this.mesh.position.y = Math.abs(c) * 0.6;
      leftArm.rotation.x = -Math.PI + c * 0.3;
      rightArm.rotation.x = -Math.PI - c * 0.3;
    }

    // Aura pulse
    const aura = (this as any)._aura as THREE.Mesh | undefined;
    if (aura && this.isHuman) {
      const pulse = 0.75 + Math.sin(t * 5) * 0.2;
      aura.scale.set(pulse, pulse, pulse);
    }
  }

  // Position in "hand" roughly (for ball attachments) - world space
  handPosition(): THREE.Vector3 {
    const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    return this.pos.clone()
      .add(forward.multiplyScalar(0.55))
      .add(new THREE.Vector3(0, 1.25, 0));
  }

  // Convenience for AI/logic
  ownHoopX(): number { return defendingHoopX(this.team); }
  targetHoopX(): number { return attackingHoopX(this.team); }
}

