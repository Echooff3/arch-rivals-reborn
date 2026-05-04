
import * as THREE from "three";

// ---------- Court Dimensions ----------
export const COURT = {
  LENGTH: 28, // x axis
  WIDTH: 15,  // z axis
  HOOP_HEIGHT: 3.05,
  HOOP_OFFSET: 1.2, // distance from baseline
  RIM_RADIUS: 0.45,
  BACKBOARD_W: 1.8,
  BACKBOARD_H: 1.05,
  THREE_POINT_RADIUS: 6.75,
  FREE_THROW_DIST: 4.6,
};

// Hoop x-positions (+ and -)
export const HOOP_X = COURT.LENGTH / 2 - COURT.HOOP_OFFSET;

// ---------- Teams ----------
export enum Team { Home = 0, Away = 1 }

export const TEAM_COLORS: Record<Team, { primary: number; secondary: number; glow: number }> = {
  [Team.Home]: { primary: 0xff2d7a, secondary: 0x6a0dad, glow: 0xff2d7a },
  [Team.Away]: { primary: 0x00e5ff, secondary: 0x003d66, glow: 0x00e5ff },
};

// Each team attacks the hoop on the OPPOSITE side from where they start
// Home starts on -x side, attacks +x hoop. Away starts on +x side, attacks -x hoop.
export function attackingHoopX(team: Team): number {
  return team === Team.Home ? HOOP_X : -HOOP_X;
}
export function defendingHoopX(team: Team): number {
  return team === Team.Home ? -HOOP_X : HOOP_X;
}

// ---------- Characters ----------
export interface Character {
  name: string;
  speed: number;    // 1-10
  power: number;
  accuracy: number;
  defense: number;
  stamina: number;
}

export const ROSTER: Character[] = [
  { name: "TYRONE", speed: 4, power: 7, accuracy: 5, defense: 9, stamina: 6 },
  { name: "VINNIE", speed: 6, power: 6, accuracy: 7, defense: 6, stamina: 6 },
  { name: "HAMMER", speed: 3, power: 10, accuracy: 4, defense: 7, stamina: 8 },
  { name: "MOHAWK", speed: 8, power: 5, accuracy: 6, defense: 5, stamina: 7 },
  { name: "REGGIE", speed: 7, power: 4, accuracy: 8, defense: 5, stamina: 6 },
  { name: "LEWIS",  speed: 5, power: 6, accuracy: 6, defense: 7, stamina: 7 },
  { name: "BLADE",  speed: 9, power: 3, accuracy: 7, defense: 4, stamina: 5 },
  { name: "TANK",   speed: 2, power: 9, accuracy: 5, defense: 10, stamina: 9 },
];

// Convert stat (1-10) to multiplier
export const STAT = {
  speed: (s: number) => 3.5 + s * 0.45,           // 3.95 - 8.0 m/s
  sprint: (s: number) => 5.0 + s * 0.65,          // sprint speed
  power: (p: number) => 4 + p * 1.6,              // punch knockback
  accuracy: (a: number) => Math.max(0.04, 0.28 - a * 0.022), // aim cone radians
};

// ---------- Gameplay ----------
export const GAME = {
  QUARTERS: 4,
  QUARTER_SECONDS: 60, // short for arcade feel
  PUNCH_COOLDOWN: 1.2,
  STUN_DURATION: 1.4,
  SHOOT_COOLDOWN: 0.6,
  PASS_COOLDOWN: 0.4,
  PICKUP_RADIUS: 1.1,
  PUNCH_RANGE: 1.8,
  SHOOT_ARC: 55 * Math.PI / 180,
  BALL_HAND_OFFSET: new THREE.Vector3(0, 1.25, 0.45),
};

// ---------- Ball State ----------
export enum BallState { Free, Held, Shot, Pass }

// ---------- Player State ----------
export enum PlayerState { Idle, Running, Stunned, Shooting, Punching, Celebrating }

// ---------- Colors ----------
export const PALETTE = {
  floor: 0xc68b4a,
  floorDark: 0x8a5a2e,
  line: 0xfff2d0,
  rim: 0xff5a1a,
  backboard: 0xfafafa,
  net: 0xeeeeee,
  crowdA: 0x1a0d33,
  crowdB: 0x330d33,
  skyTop: 0x120030,
  skyMid: 0x440066,
  skyBot: 0x0a0520,
  ball: 0xd4621f,
  ballLine: 0x1a0a05,
};
