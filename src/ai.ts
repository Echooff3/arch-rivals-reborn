

import * as THREE from "three";
import { Player } from "./entities";
import { Ball } from "./entities";
import { Team, GAME, COURT, STAT, BallState } from "./definitions";
import { distXZ, angleXZ, clamp, vec2 } from "./utils";

type Intent = {
  move: THREE.Vector2; // x,z desired direction
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  punch: boolean;
  facing: number;
};

export interface AIContext {
  self: Player;
  ball: Ball;
  teammates: Player[];
  opponents: Player[];
  holder: Player | null;
  targetHoopX: number;
  ownHoopX: number;
}

// Predict where the ball will be `time` seconds from now, accounting for gravity.
function predictBallPosition(ball: Ball, time: number): THREE.Vector3 {
  const g = 18;
  const px = ball.pos.x + ball.vel.x * time;
  const py = ball.pos.y + ball.vel.y * time - 0.5 * g * time * time;
  const pz = ball.pos.z + ball.vel.z * time;
  return new THREE.Vector3(px, py, pz);
}

// Find the best intercept point for a player chasing a flying ball.
// We iterate forward in time and find the earliest point where the player
// can plausibly reach the ball given their sprint speed.
function findInterceptPoint(player: Player, ball: Ball): { point: THREE.Vector3; time: number } | null {
  const sprintSpeed = STAT.sprint(player.character.speed);
  const step = 0.05;
  const maxTime = 2.0;

  let best: { point: THREE.Vector3; time: number } | null = null;
  let bestScore = Infinity;

  for (let t = step; t <= maxTime; t += step) {
    const p = predictBallPosition(ball, t);
    // Only consider catchable heights (ball within arm's reach range during window)
    if (p.y > 3.5) continue;
    // Don't chase past reasonable boundaries
    if (Math.abs(p.x) > COURT.LENGTH / 2 + 2 || Math.abs(p.z) > COURT.WIDTH / 2 + 1) continue;

    const horizDist = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    const canReachIn = horizDist / Math.max(0.1, sprintSpeed);
    // Slack: allow a little tolerance since the player only needs to be within pickup radius
    const reachable = canReachIn <= t + 0.15;

    if (reachable) {
      // Prefer earliest valid intercept near catchable height
      const heightPenalty = Math.max(0, p.y - 1.5) * 0.5;
      const score = t + heightPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = { point: p, time: t };
      }
    }
  }

  // Fallback: if we can't quite catch it in time, aim for its eventual landing spot
  if (!best) {
    // Find the approximate point where ball will settle around catch height
    for (let t = 0.1; t <= maxTime; t += step) {
      const p = predictBallPosition(ball, t);
      if (p.y < 1.2 && p.y > 0) {
        return { point: p, time: t };
      }
    }
  }
  return best;
}

export function computeAIIntent(ctx: AIContext, dt: number): Intent {
  const intent: Intent = {
    move: new THREE.Vector2(0, 0),
    sprint: false,
    shoot: false,
    pass: false,
    punch: false,
    facing: ctx.self.facing,
  };
  const me = ctx.self;
  if (me.stunTimer > 0) return intent;

  const hoopPos = new THREE.Vector3(ctx.targetHoopX, 0, 0);
  const ballPos = ctx.ball.pos.clone();
  const holder = ctx.holder;

  const myTeam = me.team;
  const onMyTeam = holder && holder.team === myTeam;
  const opponentHasBall = holder && holder.team !== myTeam;

  // ---- PASS INTERCEPTION / CATCH LOGIC ----
  // A pass from a teammate is in flight — run to catch it!
  // This takes priority over most other behaviors.
  if (ctx.ball.state === BallState.Pass && ctx.ball.shooter) {
    const passer = ctx.ball.shooter;
    const passIsFromTeammate = passer.team === myTeam && passer !== me;

    if (passIsFromTeammate) {
      // Figure out who on my team is the "intended receiver" — the teammate
      // (other than the passer) closest to the ball's predicted landing spot.
      // If that's me, I sprint hard to catch it.
      const landing = predictBallPosition(ctx.ball, 0.4);
      const candidates = [me, ...ctx.teammates.filter(t => t !== passer && t !== me)];
      let bestReceiver: Player = me;
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = distXZ(c.pos, landing);
        if (d < bestDist) {
          bestDist = d;
          bestReceiver = c;
        }
      }

      if (bestReceiver === me) {
        // I'm the intended receiver — intercept the ball!
        const intercept = findInterceptPoint(me, ctx.ball);
        if (intercept) {
          const target = intercept.point;
          const dx = target.x - me.pos.x;
          const dz = target.z - me.pos.z;
          const len = Math.sqrt(dx * dx + dz * dz);
          if (len > 0.15) {
            intent.move.set(dx / len, dz / len);
            // Sprint when we need to hustle to reach it in time
            intent.sprint = intercept.time < 0.8 || len > 2.5;
            intent.facing = Math.atan2(dx, dz);
          } else {
            // We're on the spot — face the incoming ball
            intent.facing = Math.atan2(ctx.ball.pos.x - me.pos.x, ctx.ball.pos.z - me.pos.z);
          }
          return intent;
        }
      } else {
        // Not the intended receiver — reposition for a rebound / support spot
        // (fall through to normal logic below but bias toward offense)
      }
    }
  }

  // ---- Determine role ----
  if (ctx.ball.state === BallState.Free) {
    // Chase the ball if I'm closest on my team
    const myDist = distXZ(me.pos, ballPos);
    const teammateDist = ctx.teammates.length ? Math.min(...ctx.teammates.map(t => distXZ(t.pos, ballPos))) : Infinity;
    if (myDist <= teammateDist + 0.1) {
      seekTo(me, ballPos, intent, true);
    } else {
      // Spread out toward offensive position
      const target = vec2(ctx.targetHoopX * 0.4, me.index % 2 === 0 ? 3 : -3);
      seekTo(me, target, intent, false);
    }
  } else if (onMyTeam) {
    if (holder === me) {
      // I have ball. Drive toward hoop, shoot when close-ish.
      const distToHoop = distXZ(me.pos, hoopPos);
      const closestOpp = ctx.opponents.reduce<Player | null>((best, p) => {
        if (p.stunTimer > 0) return best;
        if (!best) return p;
        return distXZ(me.pos, p.pos) < distXZ(me.pos, best.pos) ? p : best;
      }, null);

      // Face hoop generally
      const targetAngle = angleXZ(me.pos, hoopPos);
      intent.facing = targetAngle;

      // Shooting logic
      const open = !closestOpp || distXZ(me.pos, closestOpp.pos) > 2.2;
      const shootChance = (distToHoop < 7 && open ? 0.012 : 0) + (distToHoop < 3 ? 0.04 : 0);
      if (me.shootCooldown <= 0 && Math.random() < shootChance) {
        intent.shoot = true;
      }

      // Move toward hoop, dodge defender
      const dir = new THREE.Vector2(hoopPos.x - me.pos.x, hoopPos.z - me.pos.z).normalize();
      if (closestOpp && distXZ(me.pos, closestOpp.pos) < 1.6) {
        // sidestep
        const perp = new THREE.Vector2(-dir.y, dir.x);
        const side = Math.sign((me.pos.z - closestOpp.pos.z)) || 1;
        dir.addScaledVector(perp, side * 0.7).normalize();
      }
      intent.move.copy(dir);
      intent.sprint = distToHoop > 4;
    } else {
      // Teammate has ball: move to support (lane opposite) and get OPEN for a pass.
      // Pick a support spot toward the offensive hoop but away from defenders.
      const baseSupport = new THREE.Vector3(
        ctx.targetHoopX * 0.6,
        0,
        me.index % 2 === 0 ? 3.5 : -3.5
      );

      // If an opponent is crowding our support spot, drift further away to get open
      const support = baseSupport.clone();
      for (const opp of ctx.opponents) {
        if (opp.stunTimer > 0) continue;
        const d = distXZ(opp.pos, support);
        if (d < 3) {
          const away = new THREE.Vector3(support.x - opp.pos.x, 0, support.z - opp.pos.z).normalize();
          support.addScaledVector(away, (3 - d) * 0.8);
        }
      }
      // Keep inside the court
      support.x = clamp(support.x, -COURT.LENGTH / 2 + 1, COURT.LENGTH / 2 - 1);
      support.z = clamp(support.z, -COURT.WIDTH / 2 + 1, COURT.WIDTH / 2 - 1);

      seekTo(me, support, intent, distXZ(me.pos, support) > 3);
    }
  } else if (opponentHasBall && holder) {
    // Defense: close on ball handler or punch opportunity
    const d = distXZ(me.pos, holder.pos);
    intent.facing = angleXZ(me.pos, holder.pos);

    if (d < GAME.PUNCH_RANGE && me.punchCooldown <= 0) {
      // Punch!
      intent.punch = true;
    }
    // Move to block hoop path
    const betweenPoint = holder.pos.clone().lerp(new THREE.Vector3(ctx.ownHoopX, 0, 0), 0.4);
    seekTo(me, betweenPoint, intent, d > 3);
  } else {
    // Ball in flight (shot by opponent, or pass we're not receiving) — go for rebound
    const reboundSpot = new THREE.Vector3(ctx.targetHoopX * 0.8, 0, 0);
    seekTo(me, reboundSpot, intent, false);
  }

  return intent;
}

function seekTo(me: Player, target: THREE.Vector3, intent: Intent, sprint: boolean): void {
  const dx = target.x - me.pos.x;
  const dz = target.z - me.pos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.3) return;
  intent.move.set(dx / len, dz / len);
  intent.sprint = sprint;
  intent.facing = Math.atan2(dx, dz);
}

export function applyIntent(p: Player, intent: Intent, dt: number): void {
  if (p.stunTimer > 0) return;
  const base = STAT.speed(p.character.speed);
  const sprint = STAT.sprint(p.character.speed);
  const sp = intent.sprint ? sprint : base;
  p.vel.x = intent.move.x * sp;
  p.vel.z = intent.move.y * sp;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  // smooth facing
  if (intent.move.lengthSq() > 0.01) {
    p.facing = smoothAngle(p.facing, intent.facing, dt * 10);
  }
}

function smoothAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
