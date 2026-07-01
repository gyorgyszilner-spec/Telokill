// js/positionLock.js
// A dőlésszög-kapu UTÁN fut. Nem kér külön "lépj hátrébb/előrébb" táncot, mint az eredeti
// kalibráció - a játékhoz elég, ha a felhasználó megáll egy számára kényelmes távolságban,
// és ezt a rendszer stabil mérésből (nem kattintásból) lezárja. Ez adja az "optimalShoulderPx"
// referenciát, amire a capabilityScan és a VRM-színpad is támaszkodik.

const STABLE_HOLD_MS = 1200;
const STABLE_REL_TOLERANCE = 0.06; // ±6%-on belüli ingadozás számít "stabilnak"

export class PositionLock {
  constructor(canvasWidthRef, canvasHeightRef, onUpdate, onLocked) {
    this.canvasWidthRef = canvasWidthRef; // function -> aktuális canvas.width
    this.canvasHeightRef = canvasHeightRef;
    this.onUpdate = onUpdate;
    this.onLocked = onLocked;
    this.locked = false;
    this.windowStart = null;
    this.windowBase = null;
    this.optimalShoulderPx = null;
  }

  update(landmarks) {
    if (this.locked) return;
    const now = performance.now();
    if (!landmarks || !landmarks[11] || !landmarks[12]) {
      this.windowStart = null;
      this.onUpdate({ message: "Állj be a képbe úgy, hogy a felsőtested látszódjon.", progress: 0 });
      return;
    }
    const l = landmarks[11], r = landmarks[12];
    const dx = (l.x - r.x) * this.canvasWidthRef();
    const dy = (l.y - r.y) * this.canvasHeightRef();
    const swPx = Math.sqrt(dx * dx + dy * dy);

    if (this.windowBase === null || Math.abs(swPx - this.windowBase) / this.windowBase > STABLE_REL_TOLERANCE) {
      this.windowBase = swPx;
      this.windowStart = now;
    }
    const heldFor = now - this.windowStart;
    const progress = Math.min(1, heldFor / STABLE_HOLD_MS);
    this.onUpdate({ message: progress < 1 ? "Állj meg egy kényelmes távolságban..." : "✅ Pozíció rögzítve.", progress, shoulderPx: swPx });

    if (heldFor >= STABLE_HOLD_MS) {
      this.optimalShoulderPx = +swPx.toFixed(1);
      this.locked = true;
      this.onLocked(this.optimalShoulderPx);
    }
  }
}
