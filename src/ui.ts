
export class UI {
  private el: { [id: string]: HTMLElement } = {};

  constructor() {
    for (const id of ["title-screen", "hud", "end-screen", "score-home", "score-away", "clock", "quarter", "popup", "possession", "end-title", "end-score"]) {
      const e = document.getElementById(id);
      if (e) this.el[id] = e;
    }
  }

  showTitle(): void {
    this.el["title-screen"]?.classList.remove("hidden");
    this.el["hud"]?.classList.add("hidden");
    this.el["end-screen"]?.classList.add("hidden");
  }

  showHUD(): void {
    this.el["title-screen"]?.classList.add("hidden");
    this.el["hud"]?.classList.remove("hidden");
    this.el["end-screen"]?.classList.add("hidden");
  }

  showEnd(homeScore: number, awayScore: number): void {
    this.el["hud"]?.classList.add("hidden");
    this.el["end-screen"]?.classList.remove("hidden");
    const title = homeScore > awayScore ? "VICTORY!" : homeScore < awayScore ? "DEFEAT" : "TIED!";
    if (this.el["end-title"]) this.el["end-title"].textContent = title;
    if (this.el["end-score"]) this.el["end-score"].textContent = `${String(homeScore).padStart(2, "0")} — ${String(awayScore).padStart(2, "0")}`;
  }

  setScore(home: number, away: number): void {
    if (this.el["score-home"]) this.el["score-home"].textContent = String(home).padStart(2, "0");
    if (this.el["score-away"]) this.el["score-away"].textContent = String(away).padStart(2, "0");
  }

  setClock(seconds: number): void {
    const m = Math.max(0, Math.floor(seconds / 60));
    const s = Math.max(0, Math.floor(seconds % 60));
    const el = this.el["clock"];
    if (el) {
      el.textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (seconds < 10) el.classList.add("low");
      else el.classList.remove("low");
    }
  }

  setQuarter(q: number): void {
    if (this.el["quarter"]) this.el["quarter"].textContent = `Q${q}`;
  }

  setPossession(text: string): void {
    if (this.el["possession"]) this.el["possession"].textContent = text;
  }

  popup(text: string): void {
    const el = this.el["popup"];
    if (!el) return;
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("show");
  }
}
