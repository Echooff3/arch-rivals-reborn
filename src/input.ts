


// Unified input: keyboard + gamepad.
//
// Gamepad mapping (standard layout) — REMAPPABLE via pause menu:
//   Left stick  -> movement (analog)
//   A/B/X/Y     -> pass / punch / shoot / switch (default, configurable)
//   LB/RB/LT/RT -> sprint
//   Start (9)   -> pause / confirm
//   D-pad (12-15) -> WASD / arrows
//
// Virtual keys emitted by the gamepad are the SAME lowercase strings used by
// the keyboard path, so the rest of the game doesn't need to know which
// device fired an action.

export type GameAction = "shoot" | "pass" | "punch" | "switch" | "sprint";

// Keys that each action maps to in the game's existing key-event system.
// (These are the strings that game.ts / game logic already checks via wasPressed/isDown.)
export const ACTION_KEYS: Record<GameAction, string[]> = {
  shoot:  ["j"],
  pass:   ["l", " "],
  punch:  ["k"],
  switch: ["tab"],
  sprint: ["shift"],
};

export const ACTION_LABELS: Record<GameAction, string> = {
  shoot:  "SHOOT",
  pass:   "PASS",
  punch:  "PUNCH",
  switch: "SWITCH PLAYER",
  sprint: "SPRINT",
};

// Default button -> action assignments (Xbox-style standard mapping).
// Users can remap these from the pause menu.
const DEFAULT_BUTTON_ACTIONS: Record<number, GameAction> = {
  0: "pass",    // A
  1: "punch",   // B
  2: "shoot",   // X
  3: "switch",  // Y
  4: "sprint",  // LB
  5: "sprint",  // RB
  6: "sprint",  // LT
  7: "sprint",  // RT
};

// Button labels for the UI (Xbox face; most pads use these positions)
export const BUTTON_LABELS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "BACK",
  9: "START",
  10: "LS",
  11: "RS",
  12: "D-UP",
  13: "D-DN",
  14: "D-LT",
  15: "D-RT",
};

// Buttons that ARE remappable (face + shoulder).
export const REMAPPABLE_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];

const STICK_DEADZONE = 0.25;
const TRIGGER_THRESHOLD = 0.35;
const START_BUTTON = 9;

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  // Virtual keys currently held by the gamepad (so we can diff each frame)
  private padKeys = new Set<string>();

  // Raw button state from last frame, for edge-detection independent of remapping.
  private prevPadButtons: boolean[] = [];

  // Current remap: button index -> action
  private buttonActions: Record<number, GameAction> = { ...DEFAULT_BUTTON_ACTIONS };

  // Start button edge-detect (independent of remapping)
  private _startPressedThisFrame = false;

  // Listeners waiting for the next raw button press (for remap UI)
  private rawButtonListeners: Array<(buttonIndex: number) => void> = [];

  // Analog axes from the left stick (normalized, deadzoned)
  private _axisX = 0;
  private _axisY = 0;
  private _padConnected = false;
  private _padIndex: number | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"].includes(k)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      this.released.add(k);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.padKeys.clear();
    });

    window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
      this._padConnected = true;
      this._padIndex = e.gamepad.index;
      this.flashToast(`🎮 ${e.gamepad.id || "Gamepad"} connected`);
    });
    window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
      if (this._padIndex === e.gamepad.index) {
        this._padConnected = false;
        this._padIndex = null;
        this.padKeys.forEach(k => this.keys.delete(k));
        this.padKeys.clear();
        this.flashToast(`🎮 Gamepad disconnected`);
      }
    });

    // Try to load saved bindings
    this.loadBindings();
  }

  // ---------- Public API ----------
  isDown(...keys: string[]): boolean {
    return keys.some(k => this.keys.has(k));
  }

  wasPressed(...keys: string[]): boolean {
    return keys.some(k => this.pressed.has(k));
  }

  // Analog movement (left stick). Returns {x, y} with y>0 == down-screen.
  getMoveAxis(): { x: number; y: number } {
    return { x: this._axisX, y: this._axisY };
  }

  get hasGamepad(): boolean { return this._padConnected; }

  // True once on the frame START is pressed, regardless of remap state.
  wasStartPressed(): boolean {
    return this._startPressedThisFrame;
  }

  // ----- Remap API -----
  getButtonAction(buttonIndex: number): GameAction | null {
    return this.buttonActions[buttonIndex] ?? null;
  }

  getActionButton(action: GameAction): number | null {
    // Returns first button bound to the given action
    for (const [idx, act] of Object.entries(this.buttonActions)) {
      if (act === action) return Number(idx);
    }
    return null;
  }

  getAllBindings(): Record<number, GameAction> {
    return { ...this.buttonActions };
  }

  // Rebind: assign `action` to `buttonIndex`. If another button was bound to
  // this action, they swap (so every action stays bound to at least one button).
  rebind(buttonIndex: number, action: GameAction): void {
    if (!REMAPPABLE_BUTTONS.includes(buttonIndex)) return;
    const oldAction = this.buttonActions[buttonIndex];
    // Find any button currently bound to the incoming action
    const existingButton = Object.entries(this.buttonActions).find(
      ([, a]) => a === action
    )?.[0];

    this.buttonActions[buttonIndex] = action;
    if (existingButton !== undefined && Number(existingButton) !== buttonIndex && oldAction) {
      this.buttonActions[Number(existingButton)] = oldAction;
    }
    this.saveBindings();
  }

  resetBindings(): void {
    this.buttonActions = { ...DEFAULT_BUTTON_ACTIONS };
    this.saveBindings();
  }

  private async saveBindings(): Promise<void> {
    try {
      await window.persistentStorage.setItem(
        "arch-rivals:bindings",
        JSON.stringify(this.buttonActions)
      );
    } catch {}
  }

  private async loadBindings(): Promise<void> {
    try {
      const raw = await window.persistentStorage.getItem("arch-rivals:bindings");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, GameAction>;
      const next: Record<number, GameAction> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k);
        if (REMAPPABLE_BUTTONS.includes(idx)) next[idx] = v;
      }
      // Ensure every action is bound somewhere; otherwise fall back to defaults
      const allActions: GameAction[] = ["shoot", "pass", "punch", "switch", "sprint"];
      const hasAll = allActions.every(a => Object.values(next).includes(a));
      if (hasAll) this.buttonActions = { ...DEFAULT_BUTTON_ACTIONS, ...next };
    } catch {}
  }

  // Register a one-shot callback that fires with the next raw button pressed
  // on the gamepad (used by the remap UI). Returns an unsubscribe function.
  onNextRawButton(cb: (buttonIndex: number) => void): () => void {
    this.rawButtonListeners.push(cb);
    return () => {
      const i = this.rawButtonListeners.indexOf(cb);
      if (i >= 0) this.rawButtonListeners.splice(i, 1);
    };
  }

  // Temporarily block virtual key emission from the pad (useful while the
  // remap menu is capturing button presses, so you don't accidentally shoot).
  private _suppressVirtualKeys = false;
  setSuppressVirtualKeys(on: boolean): void {
    this._suppressVirtualKeys = on;
    if (on) {
      // Release any pad-held virtual keys immediately
      for (const k of this.padKeys) this.keys.delete(k);
      this.padKeys.clear();
      this._axisX = 0;
      this._axisY = 0;
    }
  }

  // Call once per frame BEFORE game logic reads input.
  pollGamepad(): void {
    this._startPressedThisFrame = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return;

    // Find an active pad (prefer the last connected one)
    let pad: Gamepad | null = null;
    if (this._padIndex !== null && pads[this._padIndex]) {
      pad = pads[this._padIndex]!;
    } else {
      for (const p of pads) {
        if (p && p.connected) { pad = p; this._padIndex = p.index; this._padConnected = true; break; }
      }
    }

    const nowHeld = new Set<string>();
    const currentButtons: boolean[] = [];

    if (pad) {
      // --- Left stick movement ---
      const rawX = pad.axes[0] ?? 0;
      const rawY = pad.axes[1] ?? 0;
      const mag = Math.hypot(rawX, rawY);
      if (mag > STICK_DEADZONE && !this._suppressVirtualKeys) {
        const scaled = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
        const norm = Math.min(1, scaled) / mag;
        this._axisX = rawX * norm;
        this._axisY = rawY * norm;
      } else {
        this._axisX = 0;
        this._axisY = 0;
      }

      if (!this._suppressVirtualKeys) {
        if (this._axisX < -0.35) nowHeld.add("a");
        if (this._axisX > 0.35)  nowHeld.add("d");
        if (this._axisY < -0.35) nowHeld.add("w");
        if (this._axisY > 0.35)  nowHeld.add("s");
      }

      // --- Buttons (raw state) ---
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        const active = !!b && (typeof b === "object"
          ? b.pressed || b.value > TRIGGER_THRESHOLD
          : (b as unknown as number) > TRIGGER_THRESHOLD);
        currentButtons[i] = active;

        // Raw press edge detection (for remap listeners & START)
        const wasActive = this.prevPadButtons[i] ?? false;
        if (active && !wasActive) {
          if (i === START_BUTTON) this._startPressedThisFrame = true;
          if (this.rawButtonListeners.length > 0) {
            const listeners = [...this.rawButtonListeners];
            this.rawButtonListeners.length = 0;
            for (const cb of listeners) cb(i);
          }
        }

        if (this._suppressVirtualKeys) continue;

        // Map to virtual keys via current bindings for action buttons...
        const action = this.buttonActions[i];
        if (active && action) {
          for (const key of ACTION_KEYS[action]) nowHeld.add(key);
        }
        // ...and hardcoded system buttons (START, D-pad)
        if (active) {
          if (i === START_BUTTON) nowHeld.add("enter");
          if (i === 12) { nowHeld.add("w"); nowHeld.add("arrowup"); }
          if (i === 13) { nowHeld.add("s"); nowHeld.add("arrowdown"); }
          if (i === 14) { nowHeld.add("a"); nowHeld.add("arrowleft"); }
          if (i === 15) { nowHeld.add("d"); nowHeld.add("arrowright"); }
        }
      }
    } else {
      this._axisX = 0;
      this._axisY = 0;
    }

    this.prevPadButtons = currentButtons;

    // Diff against previous frame to fire press events
    for (const k of nowHeld) {
      if (!this.padKeys.has(k)) {
        if (!this.keys.has(k)) this.pressed.add(k);
        this.keys.add(k);
      }
    }
    for (const k of this.padKeys) {
      if (!nowHeld.has(k)) {
        this.keys.delete(k);
        this.released.add(k);
      }
    }
    this.padKeys = nowHeld;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }

  // Optional haptic feedback
  rumble(duration = 200, strong = 0.6, weak = 0.3): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return;
    for (const p of pads) {
      if (!p) continue;
      const actuator = (p as any).vibrationActuator;
      if (actuator && typeof actuator.playEffect === "function") {
        actuator.playEffect("dual-rumble", {
          startDelay: 0,
          duration,
          strongMagnitude: strong,
          weakMagnitude: weak,
        }).catch(() => {});
      }
    }
  }

  private flashToast(text: string): void {
    const root = document.getElementById("ui-root");
    if (!root) return;
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = [
      "position:absolute",
      "bottom:80px",
      "left:50%",
      "transform:translateX(-50%) translateY(20px)",
      "padding:10px 20px",
      "background:linear-gradient(180deg,#1a0a2a,#0a0a14)",
      "border:2px solid #ffd23f",
      "border-radius:8px",
      "font-family:'Press Start 2P',monospace",
      "font-size:11px",
      "color:#ffd23f",
      "letter-spacing:2px",
      "box-shadow:0 0 20px rgba(255,210,63,0.6)",
      "opacity:0",
      "transition:opacity .3s, transform .3s",
      "pointer-events:none",
      "z-index:1000",
    ].join(";");
    root.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
    });
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(-20px)";
      setTimeout(() => el.remove(), 400);
    }, 2200);
  }
}

