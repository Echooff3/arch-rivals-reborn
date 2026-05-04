
import { Game } from "./game";

const game = new Game();
game.start().catch((err) => {
  console.error("Game failed to start:", err);
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:20px;left:20px;color:#f44;font-family:monospace;z-index:9999;";
  el.textContent = "Error: " + (err?.message || String(err));
  document.body.appendChild(el);
});
