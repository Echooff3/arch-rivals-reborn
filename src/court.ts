
import * as THREE from "three";
import { COURT, HOOP_X, PALETTE } from "./definitions";
import { makeCanvasTexture } from "./utils";

export interface HoopRefs {
  group: THREE.Group;
  rim: THREE.Mesh;
  backboard: THREE.Mesh;
  net: THREE.Group;
  rimCenter: THREE.Vector3; // world-space center of rim
  side: 1 | -1;
}

export class Court {
  group = new THREE.Group();
  hoops: HoopRefs[] = [];
  private crowdMats: THREE.MeshBasicMaterial[] = [];
  private sceneBg!: THREE.Mesh;

  build(scene: THREE.Scene): void {
    scene.add(this.group);
    this.buildSky(scene);
    this.buildFloor();
    this.buildOutOfBounds();
    this.buildCrowd();
    this.buildHoop(+1);
    this.buildHoop(-1);
    this.buildScoreboardMesh();
    this.buildStageLights();
  }

  // ---------- Sky / arena vault ----------
  private buildSky(scene: THREE.Scene): void {
    const tex = makeCanvasTexture(512, 512, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, "#120030");
      g.addColorStop(0.5, "#440066");
      g.addColorStop(1, "#0a0520");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
      // stars / spotlight specks
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = `rgba(255,${200 + Math.random() * 55},${100 + Math.random() * 150},${0.3 + Math.random() * 0.6})`;
        const r = Math.random() * 1.8 + 0.3;
        ctx.beginPath();
        ctx.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
    scene.fog = new THREE.FogExp2(0x0a0520, 0.018);
  }

  // ---------- Floor with court lines ----------
  private buildFloor(): void {
    const W = COURT.LENGTH, H = COURT.WIDTH;
    const pxPerUnit = 48;
    const tex = makeCanvasTexture(W * pxPerUnit, H * pxPerUnit, (ctx) => {
      const cw = ctx.canvas.width, ch = ctx.canvas.height;

      // Wood base
      const wood = ctx.createLinearGradient(0, 0, 0, ch);
      wood.addColorStop(0, "#d08b4f");
      wood.addColorStop(0.5, "#b8753a");
      wood.addColorStop(1, "#8a5a2e");
      ctx.fillStyle = wood;
      ctx.fillRect(0, 0, cw, ch);

      // Planks
      const plankH = Math.floor(ch / 18);
      for (let y = 0; y < ch; y += plankH) {
        const shade = 20 + Math.random() * 30;
        ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`;
        ctx.fillRect(0, y, cw, 2);
        // plank darkness variance
        ctx.fillStyle = `rgba(${shade},${shade / 2},0,0.06)`;
        ctx.fillRect(0, y, cw, plankH);
      }
      // Grain noise
      for (let i = 0; i < 6000; i++) {
        ctx.fillStyle = `rgba(60,30,10,${Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * cw, Math.random() * ch, 1, 1 + Math.random() * 2);
      }
      // Splashes of highlight
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(255,220,180,${Math.random() * 0.08})`;
        ctx.fillRect(Math.random() * cw, Math.random() * ch, 2, 1);
      }

      // Lines
      ctx.strokeStyle = "#fff2d0";
      ctx.lineWidth = 6;
      ctx.shadowBlur = 0;

      const u = (x: number) => (x + W / 2) * pxPerUnit;
      const v = (z: number) => (z + H / 2) * pxPerUnit;

      // Sideline
      ctx.strokeRect(u(-W / 2) + 6, v(-H / 2) + 6, cw - 12, ch - 12);
      // Midline
      ctx.beginPath();
      ctx.moveTo(u(0), v(-H / 2));
      ctx.lineTo(u(0), v(H / 2));
      ctx.stroke();
      // Center circle
      ctx.beginPath();
      ctx.arc(u(0), v(0), 1.8 * pxPerUnit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(u(0), v(0), 0.6 * pxPerUnit, 0, Math.PI * 2);
      ctx.stroke();

      // Center logo
      ctx.save();
      ctx.translate(u(0), v(0));
      ctx.font = `bold ${Math.floor(pxPerUnit * 0.7)}px "Bungee", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ff2d7a";
      ctx.globalAlpha = 0.55;
      ctx.fillText("ARCH", 0, -pxPerUnit * 0.35);
      ctx.fillStyle = "#00e5ff";
      ctx.fillText("RIVALS", 0, pxPerUnit * 0.35);
      ctx.restore();

      // Three-point arcs + key boxes on each side
      for (const sign of [-1, 1]) {
        const baseX = sign * (W / 2);
        const hoopX = baseX - sign * COURT.HOOP_OFFSET;

        // Three-point arc
        ctx.beginPath();
        if (sign > 0) {
          ctx.arc(u(hoopX), v(0), COURT.THREE_POINT_RADIUS * pxPerUnit, Math.PI * 0.5, Math.PI * 1.5, true);
        } else {
          ctx.arc(u(hoopX), v(0), COURT.THREE_POINT_RADIUS * pxPerUnit, Math.PI * 1.5, Math.PI * 0.5, true);
        }
        ctx.stroke();

        // Key / free throw lane
        const laneW = 4.9;
        const laneH = 3.6;
        const laneStartX = sign > 0 ? hoopX : hoopX;
        const laneEndX = sign > 0 ? hoopX - laneW : hoopX + laneW;
        ctx.strokeRect(
          Math.min(u(laneStartX), u(laneEndX)),
          v(-laneH / 2),
          Math.abs(u(laneStartX) - u(laneEndX)),
          laneH * pxPerUnit
        );
        // paint fill
        ctx.fillStyle = sign > 0 ? "rgba(0,229,255,0.18)" : "rgba(255,45,122,0.18)";
        ctx.fillRect(
          Math.min(u(laneStartX), u(laneEndX)),
          v(-laneH / 2),
          Math.abs(u(laneStartX) - u(laneEndX)),
          laneH * pxPerUnit
        );
        // Free throw circle
        ctx.beginPath();
        ctx.arc(u(laneEndX), v(0), 1.8 * pxPerUnit, 0, Math.PI * 2);
        ctx.stroke();

        // Restricted area
        ctx.beginPath();
        const arcStart = sign > 0 ? Math.PI * 0.5 : Math.PI * 1.5;
        const arcEnd = sign > 0 ? Math.PI * 1.5 : Math.PI * 0.5;
        ctx.arc(u(hoopX), v(0), 1.25 * pxPerUnit, arcStart, arcEnd, sign > 0);
        ctx.stroke();
      }
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const floorMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      metalness: 0.15,
      envMapIntensity: 0.4,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Reflective gloss pass (subtle sheen)
    const gloss = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
      })
    );
    gloss.rotation.x = -Math.PI / 2;
    gloss.position.y = 0.001;
    this.group.add(gloss);
  }

  // Surrounding dark out-of-bounds area
  private buildOutOfBounds(): void {
    const pad = 8;
    const geo = new THREE.RingGeometry(
      0,
      1,
      4
    );
    geo.dispose();

    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT.LENGTH + pad * 2, COURT.WIDTH + pad * 2),
      new THREE.MeshStandardMaterial({ color: 0x0a0514, roughness: 0.9 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.group.add(outer);
  }

  // Pixelated crowd stands on both long sides
  private buildCrowd(): void {
    const makeCrowdTex = () => makeCanvasTexture(512, 128, (ctx) => {
      ctx.fillStyle = "#100518";
      ctx.fillRect(0, 0, 512, 128);
      // Rows of heads
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        const y = 128 - (r + 1) * 14;
        const brightness = 0.4 + (r / rows) * 0.4;
        for (let x = -6; x < 512 + 6; x += 10) {
          const jitter = Math.sin(x * 0.3 + r) * 2;
          const hue = Math.floor(Math.random() * 360);
          ctx.fillStyle = `hsl(${hue},${60 + Math.random() * 30}%,${25 + Math.random() * 35}%)`;
          ctx.beginPath();
          ctx.arc(x + Math.random() * 4, y + jitter, 3.5 + Math.random() * 1.5, 0, Math.PI * 2);
          ctx.fill();
          // shirt
          ctx.fillStyle = `hsl(${hue},${60 + Math.random() * 30}%,${30 + Math.random() * 20}%)`;
          ctx.fillRect(x - 3, y + 2, 7, 10);
        }
        // row dim overlay
        ctx.fillStyle = `rgba(0,0,0,${0.5 - brightness * 0.4})`;
        ctx.fillRect(0, y - 6, 512, 18);
      }
      // scattered phone flashes
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = `rgba(255,255,200,${Math.random()})`;
        ctx.fillRect(Math.random() * 512, Math.random() * 110 + 10, 1.5, 1.5);
      }
    });

    const longLen = COURT.LENGTH + 8;
    const stands: Array<[number, number, number]> = [
      [0, 2.2, COURT.WIDTH / 2 + 2.5],
      [0, 2.2, -(COURT.WIDTH / 2 + 2.5)],
    ];

    for (let i = 0; i < stands.length; i++) {
      const tex = makeCrowdTex();
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = 1;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      this.crowdMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(longLen, 4.5), mat);
      mesh.position.set(...stands[i]);
      mesh.rotation.y = i === 0 ? Math.PI : 0;
      this.group.add(mesh);

      // bleacher steps below crowd
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(longLen, 0.4, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x1a1020, roughness: 0.8 })
      );
      step.position.set(stands[i][0], 0.2, stands[i][2]);
      step.receiveShadow = true;
      this.group.add(step);
    }

    // End caps (short sides)
    const endTex = makeCrowdTex();
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(COURT.WIDTH + 6, 3.5),
        new THREE.MeshBasicMaterial({ map: endTex })
      );
      m.position.set(sx * (COURT.LENGTH / 2 + 3), 1.8, 0);
      m.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(m);
    }
  }

  // ---------- Hoop ----------
  private buildHoop(side: 1 | -1): void {
    const g = new THREE.Group();
    const baseX = side * (COURT.LENGTH / 2 + 0.2);
    const hoopX = side * HOOP_X;

    // Stanchion pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 4, 16),
      new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.3 })
    );
    pole.position.set(baseX, 2, 0);
    pole.castShadow = true;
    g.add(pole);

    // Pole base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.3, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.6, roughness: 0.4 })
    );
    base.position.set(baseX, 0.15, 0);
    base.castShadow = true;
    g.add(base);

    // Arm
    const armLen = Math.abs(baseX - hoopX) + 0.1;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(armLen, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.3 })
    );
    arm.position.set((baseX + hoopX) / 2, COURT.HOOP_HEIGHT + 0.45, 0);
    arm.castShadow = true;
    g.add(arm);

    // Backboard
    const bbGeo = new THREE.BoxGeometry(0.08, COURT.BACKBOARD_H, COURT.BACKBOARD_W);
    const bbMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.0,
      transmission: 0.3,
      transparent: true,
      opacity: 0.85,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });
    const bb = new THREE.Mesh(bbGeo, bbMat);
    bb.position.set(hoopX + side * 0.25, COURT.HOOP_HEIGHT + 0.35, 0);
    bb.castShadow = true;
    g.add(bb);

    // Painted target square on backboard
    const targetTex = makeCanvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 6;
      ctx.strokeRect(32, 32, 64, 48);
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, 112, 112);
    });
    const targetMat = new THREE.MeshBasicMaterial({ map: targetTex, transparent: true });
    const target = new THREE.Mesh(new THREE.PlaneGeometry(COURT.BACKBOARD_W, COURT.BACKBOARD_H), targetMat);
    target.position.copy(bb.position);
    target.position.x += side * -0.045;
    target.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(target);

    // Rim
    const rimGeo = new THREE.TorusGeometry(COURT.RIM_RADIUS, 0.035, 10, 28);
    const rimMat = new THREE.MeshStandardMaterial({
      color: PALETTE.rim,
      emissive: 0xff2d00,
      emissiveIntensity: 0.5,
      metalness: 0.9,
      roughness: 0.3,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const rimX = hoopX - side * 0.05;
    rim.position.set(rimX, COURT.HOOP_HEIGHT, 0);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    g.add(rim);

    // Net (lines radiating downward)
    const net = new THREE.Group();
    const netSegments = 14;
    for (let i = 0; i < netSegments; i++) {
      const a = (i / netSegments) * Math.PI * 2;
      const topX = Math.cos(a) * COURT.RIM_RADIUS;
      const topZ = Math.sin(a) * COURT.RIM_RADIUS;
      const botA = a + 0.15;
      const botR = COURT.RIM_RADIUS * 0.55;
      const botX = Math.cos(botA) * botR;
      const botZ = Math.sin(botA) * botR;

      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(topX, 0, topZ),
        new THREE.Vector3(botX, -0.45, botZ),
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
      );
      net.add(line);
    }
    // horizontal rings
    for (let k = 1; k < 4; k++) {
      const y = -0.12 * k;
      const r = COURT.RIM_RADIUS * (1 - k * 0.12);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      net.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
      ));
    }
    net.position.copy(rim.position);
    g.add(net);

    this.group.add(g);
    this.hoops.push({
      group: g,
      rim,
      backboard: bb,
      net,
      rimCenter: rim.position.clone(),
      side,
    });
  }

  // Simple hanging scoreboard mesh (HUD is HTML, but we add a visual element)
  private buildScoreboardMesh(): void {
    const sb = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(5, 2, 3),
      new THREE.MeshStandardMaterial({ color: 0x0a0a14, metalness: 0.7, roughness: 0.4 })
    );
    body.position.y = 8.5;
    sb.add(body);
    // Neon edges
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xff2d7a });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), edgeMat);
    edges.position.copy(body.position);
    sb.add(edges);
    // Cables
    for (const x of [-1.5, 1.5]) {
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      cable.position.set(x, 11.5, 0);
      sb.add(cable);
    }
    this.group.add(sb);
  }

  private buildStageLights(): void {
    // Four corner spot rigs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rig = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.25, 0.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.8, roughness: 0.3 })
        );
        rig.position.set(sx * (COURT.LENGTH / 2 - 1), 9, sz * (COURT.WIDTH / 2 - 0.5));
        this.group.add(rig);
      }
    }
  }

  update(_dt: number, t: number): void {
    // subtle crowd animation via texture offset
    for (const mat of this.crowdMats) {
      if (mat.map) {
        mat.map.offset.y = Math.sin(t * 4) * 0.004;
        mat.map.needsUpdate = false;
      }
    }
  }
}
