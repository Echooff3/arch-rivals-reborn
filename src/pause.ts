


import {
  Input, GameAction, ACTION_LABELS, ACTION_KEYS,
  BUTTON_LABELS, REMAPPABLE_BUTTONS,
} from "./input";

type OnClose = () => void;

export class PauseMenu {
  private root: HTMLDivElement;
  private visible = false;
  private view: "main" | "remap" = "main";
  private selectedIndex = 0;
  private remapCaptureUnsub: (() => void) | null = null;
  private captureForAction: GameAction | null = null;
  private onClose: OnClose = () => {};

  // Cache button refs per view so we can update selection highlight cheaply
  private buttonEls: HTMLButtonElement[] = [];

  // Stick-based nav debounce for keyboard-less navigation
  private navCooldown = 0;

  constructor(private input: Input) {
    this.root = document.createElement("div");
    this.root.id = "pause-menu";
    this.root.className = "pause-menu hidden";
    document.getElementById("ui-root")?.appendChild(this.root);

    // Keyboard nav
    window.addEventListener("keydown", (e) => {
      if (!this.visible) return;
      const k = e.key.toLowerCase();
      if (this.captureForAction) {
        if (k === "escape") this.cancelCapture();
        return;
      }
      if (k === "arrowup" || k === "w") { e.preventDefault(); this.move(-1); }
      else if (k === "arrowdown" || k === "s") { e.preventDefault(); this.move(1); }
      else if (k === "enter" || k === " ") { e.preventDefault(); this.activate(); }
      else if (k === "escape") {
        e.preventDefault();
        if (this.view === "remap") this.showMain();
        else this.close();
      }
    });
  }

  get isOpen(): boolean { return this.visible; }

  open(onClose: OnClose): void {
    this.onClose = onClose;
    this.visible = true;
    this.view = "main";
    this.selectedIndex = 0;
    this.root.classList.remove("hidden");
    this.render();
  }

  close(): void {
    this.visible = false;
    this.cancelCapture();
    this.root.classList.add("hidden");
    this.onClose();
  }

  // Called every frame while open — handles gamepad navigation via left stick + A/B
  tick(dt: number): void {
    if (!this.visible) return;
    this.navCooldown = Math.max(0, this.navCooldown - dt);

    // If capturing, nothing else matters — raw button handler in Input will resolve it.
    if (this.captureForAction) return;

    const axis = this.input.getMoveAxis();
    if (this.navCooldown <= 0) {
      if (axis.y < -0.5) { this.move(-1); this.navCooldown = 0.18; }
      else if (axis.y > 0.5) { this.move(1); this.navCooldown = 0.18; }
    }

    // Allow START to close pause (resume)
    if (this.input.wasStartPressed()) {
      if (this.view === "remap") this.showMain();
      else this.close();
      return;
    }

    // Use the "pass" virtual key ("l"/" ") as confirm on pad, "punch" ("k") as back
    if (this.input.wasPressed("enter") || this.input.wasPressed(" ")) {
      this.activate();
    } else if (this.input.wasPressed("k")) {
      if (this.view === "remap") this.showMain();
      else this.close();
    }
  }

  // ---------- Navigation ----------
  private move(dir: number): void {
    if (this.buttonEls.length === 0) return;
    this.selectedIndex = (this.selectedIndex + dir + this.buttonEls.length) % this.buttonEls.length;
    this.updateSelection();
  }

  private updateSelection(): void {
    this.buttonEls.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
      if (i === this.selectedIndex) el.focus();
    });
  }

  private activate(): void {
    const el = this.buttonEls[this.selectedIndex];
    if (el) el.click();
  }

  // ---------- Views ----------
  private render(): void {
    if (this.view === "main") this.renderMain();
    else this.renderRemap();
  }

  private showMain(): void {
    this.view = "main";
    this.selectedIndex = 0;
    this.cancelCapture();
    this.renderMain();
  }

  private renderMain(): void {
    this.root.innerHTML = `
      <div class="pause-backdrop"></div>
      <div class="pause-panel">
        <div class="pause-title">PAUSED</div>
        <div class="pause-sub">PRESS <kbd>START</kbd> / <kbd>ESC</kbd> TO RESUME</div>
        <div class="pause-list" id="pause-list"></div>
        <div class="pause-footer">
          ${this.input.hasGamepad ? `<span>🎮 L-STICK NAV • Ⓐ CONFIRM • Ⓑ BACK</span>` : `<span>⌨️ ↑↓ NAV • ENTER CONFIRM • ESC BACK</span>`}
        </div>
      </div>
    `;
    const list = this.root.querySelector<HTMLDivElement>("#pause-list")!;
    this.buttonEls = [];
    this.addMenuItem(list, "RESUME", () => this.close());
    this.addMenuItem(list, "REMAP GAMEPAD BUTTONS", () => this.showRemap());
    this.addMenuItem(list, "RESET BINDINGS TO DEFAULT", () => {
      this.input.resetBindings();
      this.flash("BINDINGS RESET");
      this.renderMain();
    });
    this.updateSelection();
  }

  private showRemap(): void {
    this.view = "remap";
    this.selectedIndex = 0;
    this.renderRemap();
  }

  private renderRemap(): void {
    const bindings = this.input.getAllBindings();
    const rows = REMAPPABLE_BUTTONS.map((btn) => {
      const action = bindings[btn];
      return { button: btn, action };
    });

    this.root.innerHTML = `
      <div class="pause-backdrop"></div>
      <div class="pause-panel wide">
        <div class="pause-title small">REMAP GAMEPAD</div>
        <div class="pause-sub">
          ${this.input.hasGamepad
            ? "SELECT A BUTTON, THEN PRESS THE NEW BUTTON ON YOUR PAD"
            : "⚠️ NO GAMEPAD DETECTED — CONNECT ONE TO TEST"}
        </div>

        <div class="remap-grid">
          <div class="remap-head">BUTTON</div>
          <div class="remap-head">ACTION</div>
          <div class="remap-head">KEYBOARD</div>
          <div class="remap-head"></div>
          ${rows.map((r, idx) => `
            <div class="remap-btn-cell"><span class="pad-badge pad-${r.button}">${BUTTON_LABELS[r.button]}</span></div>
            <div class="remap-action-cell">${ACTION_LABELS[r.action]}</div>
            <div class="remap-kb-cell">${this.keyboardLabel(r.action)}</div>
            <div class="remap-btn-action">
              <button class="remap-rebind-btn" data-button="${r.button}" data-idx="${idx}">
                REBIND
              </button>
            </div>
          `).join("")}
        </div>

        <div class="pause-list" id="pause-list"></div>

        <div class="pause-footer">
          ${this.input.hasGamepad
            ? `<span>🎮 L-STICK NAV • Ⓐ CONFIRM • Ⓑ BACK</span>`
            : `<span>⌨️ ↑↓ NAV • ENTER CONFIRM • ESC BACK</span>`}
        </div>

        <div class="remap-capture ${this.captureForAction ? "" : "hidden"}" id="remap-capture">
          <div class="remap-capture-inner">
            <div class="capture-title">PRESS ANY BUTTON</div>
            <div class="capture-sub" id="capture-sub">ON YOUR GAMEPAD</div>
            <div class="capture-hint">PRESS <kbd>ESC</kbd> OR <kbd>START</kbd> TO CANCEL</div>
          </div>
        </div>
      </div>
    `;

    // Wire up buttons
    const rebindButtons = this.root.querySelectorAll<HTMLButtonElement>(".remap-rebind-btn");
    this.buttonEls = [];
    rebindButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const buttonIdx = Number(btn.dataset.button);
        const currentAction = this.input.getButtonAction(buttonIdx);
        if (currentAction) this.startCapture(currentAction, buttonIdx);
      });
      this.buttonEls.push(btn);
    });

    // Bottom menu actions
    const list = this.root.querySelector<HTMLDivElement>("#pause-list")!;
    this.addMenuItem(list, "RESET TO DEFAULTS", () => {
      this.input.resetBindings();
      this.flash("DEFAULTS RESTORED");
      this.renderRemap();
    });
    this.addMenuItem(list, "BACK", () => this.showMain());

    this.updateSelection();
  }

  private keyboardLabel(action: GameAction): string {
    const keys = ACTION_KEYS[action];
    const pretty = keys.map(k => {
      if (k === " ") return "SPACE";
      if (k === "shift") return "SHIFT";
      if (k === "tab") return "TAB";
      return k.toUpperCase();
    });
    return pretty.join(" / ");
  }

  private addMenuItem(container: HTMLElement, label: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.className = "pause-item";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    btn.addEventListener("mouseenter", () => {
      this.selectedIndex = this.buttonEls.indexOf(btn);
      this.updateSelection();
    });
    container.appendChild(btn);
    this.buttonEls.push(btn);
  }

  // ---------- Capture flow ----------
  private startCapture(action: GameAction, _sourceButton: number): void {
    this.captureForAction = action;
    this.input.setSuppressVirtualKeys(true);

    const cap = this.root.querySelector<HTMLDivElement>("#remap-capture");
    const sub = this.root.querySelector<HTMLDivElement>("#capture-sub");
    if (cap) cap.classList.remove("hidden");
    if (sub) sub.textContent = `ASSIGNING: ${ACTION_LABELS[action]}`;

    this.remapCaptureUnsub = this.input.onNextRawButton((btn) => {
      if (!REMAPPABLE_BUTTONS.includes(btn)) {
        // Not remappable (e.g. START / BACK / stick click) — keep waiting.
        this.remapCaptureUnsub = this.input.onNextRawButton((btn2) => {
          this.finishCapture(btn2);
        });
        return;
      }
      this.finishCapture(btn);
    });
  }

  private finishCapture(buttonIndex: number): void {
    if (!REMAPPABLE_BUTTONS.includes(buttonIndex)) {
      this.cancelCapture();
      return;
    }
    if (this.captureForAction) {
      this.input.rebind(buttonIndex, this.captureForAction);
      this.flash(`${BUTTON_LABELS[buttonIndex]} → ${ACTION_LABELS[this.captureForAction]}`);
    }
    this.captureForAction = null;
    this.input.setSuppressVirtualKeys(false);
    this.renderRemap();
  }

  private cancelCapture(): void {
    if (this.remapCaptureUnsub) { this.remapCaptureUnsub(); this.remapCaptureUnsub = null; }
    this.captureForAction = null;
    this.input.setSuppressVirtualKeys(false);
    const cap = this.root.querySelector<HTMLDivElement>("#remap-capture");
    if (cap) cap.classList.add("hidden");
  }

  private flash(text: string): void {
    const toast = document.createElement("div");
    toast.className = "pause-toast";
    toast.textContent = text;
    this.root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 400);
    }, 1400);
  }
}

