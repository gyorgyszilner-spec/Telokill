// js/handLogger.js
// "Csináljunk egy hasonló filet, mint az elején a json volt."
// A mérési rutin (measurementSession.js) hajtja: minden fázishoz automatikusan a fázis
// kulcsát írja címkének (nem kell kézzel kattintgatni menet közben). A letöltött JSON két
// részből áll -- ahogy az eredeti kalibrációs fájl is: egy tömör ÖSSZEGZÉS fázisonként
// (gyors átnézésre), és egy teljes NYERS NAPLÓ (rawLog) minden mintavett frame-ről.

const THROTTLE_MS = 100; // kb. 10 Hz mintavétel

const LANDMARK_KEYS = {
  nose: 0, shoulder_l: 11, shoulder_r: 12, elbow_l: 13, elbow_r: 14, wrist_l: 15, wrist_r: 16,
  hip_l: 23, hip_r: 24
};

export class HandLogger {
  constructor() {
    this.recording = false;
    this.phaseKey = "reset";
    this.rawLog = [];
    this.lastLogAt = 0;
  }

  start() {
    this.recording = true;
    this.rawLog = [];
    this.lastLogAt = 0;
  }

  stop() {
    this.recording = false;
  }

  setPhase(key) {
    this.phaseKey = key;
  }

  /**
   * @param {number} t performance.now() időbélyeg
   * @param {object} rawArms retargeter.lastRawArms (Kalidokit nyers kar-rotációk)
   * @param {Array} landmarks MediaPipe 2D landmarkok
   * @param {object} classifierDebug a poseClassifier update() debug mezője
   * @param {string} detectedAnim a klasszifikátor által épp választott láb-animáció
   */
  log(t, rawArms, landmarks, classifierDebug, detectedAnim) {
    if (!this.recording) return;
    if (this.lastLogAt && t - this.lastLogAt < THROTTLE_MS) return;
    this.lastLogAt = t;

    const lm = {};
    for (const key in LANDMARK_KEYS) {
      const p = landmarks && landmarks[LANDMARK_KEYS[key]];
      lm[key] = p ? {
        x: +p.x.toFixed(3), y: +p.y.toFixed(3),
        z: p.z !== undefined ? +p.z.toFixed(3) : undefined,
        visibility: p.visibility !== undefined ? +p.visibility.toFixed(2) : undefined
      } : null;
    }

    this.rawLog.push({
      t: Math.round(t),
      phase: this.phaseKey,
      detectedAnim: detectedAnim || null,
      classifierDebug: classifierDebug || null,
      rawArms: rawArms ? JSON.parse(JSON.stringify(rawArms)) : null,
      lm
    });
  }

  /** Fázisonkénti tömör összegzés a teljes rawLog-ból -- gyors átnézésre. */
  _buildSummary() {
    const byPhase = {};
    for (const entry of this.rawLog) {
      if (!byPhase[entry.phase]) byPhase[entry.phase] = [];
      byPhase[entry.phase].push(entry);
    }
    const summary = {};
    for (const phaseKey in byPhase) {
      const entries = byPhase[phaseKey];
      const animCounts = {};
      let maxHeadDrop = 0, maxLateralDx = 0, maxHipFreq = 0;
      for (const e of entries) {
        if (e.detectedAnim) animCounts[e.detectedAnim] = (animCounts[e.detectedAnim] || 0) + 1;
        const d = e.classifierDebug;
        if (d) {
          if (typeof d.headDropHeadHeights === "number") maxHeadDrop = Math.max(maxHeadDrop, d.headDropHeadHeights);
          if (typeof d.lateralDx === "number") maxLateralDx = Math.max(maxLateralDx, Math.abs(d.lateralDx));
          if (typeof d.hipFreqHz === "number") maxHipFreq = Math.max(maxHipFreq, d.hipFreqHz);
        }
      }
      const dominantAnim = Object.entries(animCounts).sort((a, b) => b[1] - a[1])[0];
      summary[phaseKey] = {
        frameCount: entries.length,
        dominantDetectedAnim: dominantAnim ? dominantAnim[0] : null,
        animDistribution: animCounts,
        maxHeadDropHeadHeights: +maxHeadDrop.toFixed(2),
        maxLateralDx: +maxLateralDx.toFixed(2),
        maxHipFreqHz: +maxHipFreq.toFixed(2)
      };
    }
    return summary;
  }

  download() {
    const payload = {
      createdAt: new Date().toISOString(),
      frameCount: this.rawLog.length,
      summary: this._buildSummary(),
      rawLog: this.rawLog
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ginger-meresi-naplo-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
