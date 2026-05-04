
import * as THREE from "three";
import { rand, signedRand } from "./utils";

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: THREE.Vector3;
  gravity: number;
  fade: boolean;
}

interface TextPopup {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class Effects {
  group = new THREE.Group();
  private particles: Particle[] = [];
  private popups: TextPopup[] = [];
  private geoSphere = new THREE.SphereGeometry(0.08, 6, 5);
  private geoCube = new THREE.BoxGeometry(0.14, 0.14, 0.14);

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  burst(pos: THREE.Vector3, color: number, count = 16, options: Partial<{ speed: number; size: number; gravity: number; life: number; cube: boolean }> = {}): void {
    const speed = options.speed ?? 5;
    const size = options.size ?? 1;
    const grav = options.gravity ?? 10;
    const life = options.life ?? 0.6;
    const geo = options.cube ? this.geoCube : this.geoSphere;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.scale.setScalar(size * rand(0.6, 1.3));
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3(signedRand(), rand(0.2, 1.4), signedRand()).normalize().multiplyScalar(speed * rand(0.5, 1.2)),
        life,
        maxLife: life,
        spin: new THREE.Vector3(signedRand(10), signedRand(10), signedRand(10)),
        gravity: grav,
        fade: true,
      });
    }
  }

  confetti(pos: THREE.Vector3): void {
    const colors = [0xff2d7a, 0xffd23f, 0x00e5ff, 0x6a0dad, 0xffffff, 0x00ff88];
    for (let i = 0; i < 50; i++) {
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.burst(pos, c, 1, { speed: 8, size: 1.5, gravity: 14, life: 1.6, cube: true });
    }
  }

  popup(text: string, pos: THREE.Vector3, color = "#ffd23f"): void {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.font = 'bold 72px "Bungee", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000";
    ctx.fillText(text, 256 + 4, 64 + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(3, 0.75, 1);
    spr.position.copy(pos);
    spr.renderOrder = 200;
    this.group.add(spr);
    this.popups.push({ sprite: spr, vel: new THREE.Vector3(0, 2.5, 0), life: 1.2, maxLife: 1.2 });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vel.y = -p.vel.y * 0.4;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      if (p.fade) {
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pu = this.popups[i];
      pu.life -= dt;
      pu.sprite.position.addScaledVector(pu.vel, dt);
      pu.vel.y *= 0.96;
      const t = pu.life / pu.maxLife;
      pu.sprite.material.opacity = Math.min(1, t * 2);
      const s = 3 * (1 + (1 - t) * 0.3);
      pu.sprite.scale.set(s, s * 0.25, 1);
      if (pu.life <= 0) {
        this.group.remove(pu.sprite);
        (pu.sprite.material.map as THREE.Texture).dispose();
        pu.sprite.material.dispose();
        this.popups.splice(i, 1);
      }
    }
  }
}
