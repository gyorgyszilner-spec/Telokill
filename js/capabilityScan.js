// js/capabilityScan.js
// "Amikor a kamera-állásszög belövése kész, akkor tudja meg a program, hogy milyen
// pontokat fog általában látni. Ami akkor nem látszik, az jó eséllyel nem jön be."
//
// Ez a modul a tilt-kapu + position_lock UTÁN fut, kb. 1.5-2 másodpercig, és a 33
// MediaPipe landmark mindegyikére átlag-vizibilitást számol. Ebből egy STATIKUS,
// a teljes session alatt változatlan bizalmi profil születik:
//   reliable  (átl. vis. > 0.6) -> élő retarget vezérelheti
//   marginal  (0.3-0.6)         -> csak korrekciós/finomhangoló jel, sosem önálló driver
//   absent    (< 0.3)           -> mindig procedurális, élőben meg sem próbáljuk

export const ReliabilityBand = { RELIABLE: "reliable", MARGINAL: "marginal", ABSENT: "absent" };

const RELIABLE_THRESHOLD = 0.6;
const MARGINAL_THRESHOLD = 0.3;
const SCAN_DURATION_MS = 1800;

export class CapabilityScan {
  constructor(onUpdate, onComplete) {
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.startedAt = null;
    this.sums = {};   // idx -> {sum, count}
    this.done = false;
  }

  update(landmarks) {
    if (this.done) return;
    const now = performance.now();
    if (this.startedAt === null) this.startedAt = now;
    if (landmarks) {
      landmarks.forEach((lm, idx) => {
        const v = lm.visibility ?? 0;
        if (!this.sums[idx]) this.sums[idx] = { sum: 0, count: 0 };
        this.sums[idx].sum += v;
        this.sums[idx].count += 1;
      });
    }
    const elapsed = now - this.startedAt;
    const progress = Math.min(1, elapsed / SCAN_DURATION_MS);
    this.onUpdate({ message: "Felmérjük, mely testrészeid látszanak jól ebből a kamerapozícióból...", progress });

    if (elapsed >= SCAN_DURATION_MS) {
      this.done = true;
      const profile = this._buildProfile();
      this.onComplete(profile);
    }
  }

  _buildProfile() {
    const profile = {}; // idx -> { avgVis, band }
    for (const idx in this.sums) {
      const { sum, count } = this.sums[idx];
      const avgVis = count > 0 ? sum / count : 0;
      let band;
      if (avgVis > RELIABLE_THRESHOLD) band = ReliabilityBand.RELIABLE;
      else if (avgVis >= MARGINAL_THRESHOLD) band = ReliabilityBand.MARGINAL;
      else band = ReliabilityBand.ABSENT;
      profile[idx] = { avgVis: +avgVis.toFixed(3), band };
    }
    return profile;
  }
}

/** Kényelmi lekérdezők a profilra, MediaPipe index alapján. */
export function bandOf(profile, idx) {
  return profile[idx] ? profile[idx].band : ReliabilityBand.ABSENT;
}
export function isReliable(profile, idx) { return bandOf(profile, idx) === ReliabilityBand.RELIABLE; }
export function isAbsent(profile, idx) { return bandOf(profile, idx) === ReliabilityBand.ABSENT; }
