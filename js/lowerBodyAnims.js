// js/lowerBodyAnims.js
// A boka (vis. ~0.08-0.10) és a térd (vis. ~0.33) a kamera-elrendezésből adódóan tartósan
// a megbízhatósági küszöb alatt van (ld. a kalibrációs JSON reliabilityMap-jét) -> ezeket a
// csontokat SOHA nem hajtjuk nyers landmarkból, mindig ez a procedurális könyvtár adja őket.
// A poseClassifier dönti el élőben, melyik klip fusson és milyen sebességgel; ez a modul csak
// legenerálja és crossfade-eli a kért pózokat, majd ráírja a VRM humanoid csontjaira.

// Megjegyzés: a VRMHumanBoneName a @pixiv/three-vrm-ben csak TS-típus, futásidőben
// nincs hozzá importálható objektum -- ezért itt egyszerű lowerCamelCase string
// kulcsokat használunk közvetlenül a getNormalizedBoneNode()-nak, ami ezt várja.

const DEG = Math.PI / 180;

// Egy "pose" függvény: phase (0..1, a ciklus aktuális pontja) -> csont-rotációk (radián, Euler XYZ)
// és egy opcionális Hips-pozíció eltolás (méterben), ami a fel-le bólintást/guggolást adja.
const CLIPS = {
  idle: (phase) => {
    const sway = Math.sin(phase * Math.PI * 2) * 0.6 * DEG;
    return {
      legs: zeroLegs(),
      hipsOffsetY: Math.sin(phase * Math.PI * 2) * 0.004,
      hipsLean: { x: 0, y: sway, z: 0 }
    };
  },

  walk: (phase) => makeStepCycle(phase, { hipSwing: 22 * DEG, kneeBend: 35 * DEG, bounce: 0.018 }),

  run: (phase) => makeStepCycle(phase, { hipSwing: 42 * DEG, kneeBend: 70 * DEG, bounce: 0.045 }),

  highKnee: (phase) => makeStepCycle(phase, { hipSwing: 70 * DEG, kneeBend: 95 * DEG, bounce: 0.03, liftBoost: 25 * DEG }),

  squat: (phase) => {
    // phase: 0 = állás, 0.5 = legmélyebb pont, 1 = vissza állásba (egy le-fel ciklus)
    const depth = Math.sin(phase * Math.PI); // 0..1..0
    const hipBend = depth * 75 * DEG;
    const kneeBend = depth * 95 * DEG;
    const ankleBend = depth * 18 * DEG;
    return {
      legs: {
        LeftUpperLeg: { x: hipBend, y: 0, z: 2 * DEG },
        RightUpperLeg: { x: hipBend, y: 0, z: -2 * DEG },
        LeftLowerLeg: { x: -kneeBend, y: 0, z: 0 },
        RightLowerLeg: { x: -kneeBend, y: 0, z: 0 },
        LeftFoot: { x: ankleBend, y: 0, z: 0 },
        RightFoot: { x: ankleBend, y: 0, z: 0 }
      },
      hipsOffsetY: -depth * 0.22,
      hipsLean: { x: depth * 8 * DEG, y: 0, z: 0 }
    };
  },

  squatJump: (phase) => {
    // 0-0.4: lemegy guggolásba, 0.4-0.55: felpattan, 0.55-1: landol és kiegyenesedik
    let depth = 0, lift = 0;
    if (phase < 0.4) {
      depth = phase / 0.4;
    } else if (phase < 0.55) {
      depth = 1 - (phase - 0.4) / 0.15;
      lift = ((phase - 0.4) / 0.15);
    } else {
      lift = Math.max(0, 1 - (phase - 0.55) / 0.2);
    }
    const hipBend = depth * 65 * DEG;
    const kneeBend = depth * 85 * DEG;
    return {
      legs: {
        LeftUpperLeg: { x: hipBend, y: 0, z: 2 * DEG },
        RightUpperLeg: { x: hipBend, y: 0, z: -2 * DEG },
        LeftLowerLeg: { x: -kneeBend, y: 0, z: 0 },
        RightLowerLeg: { x: -kneeBend, y: 0, z: 0 },
        LeftFoot: { x: depth * 14 * DEG, y: 0, z: 0 },
        RightFoot: { x: depth * 14 * DEG, y: 0, z: 0 }
      },
      hipsOffsetY: -depth * 0.18 + lift * 0.22,
      hipsLean: { x: 0, y: 0, z: 0 }
    };
  },

  lateralLeft: (phase) => makeLateralCycle(phase, -1),
  lateralRight: (phase) => makeLateralCycle(phase, +1)
};

function zeroLegs() {
  return {
    LeftUpperLeg: { x: 0, y: 0, z: 0 }, RightUpperLeg: { x: 0, y: 0, z: 0 },
    LeftLowerLeg: { x: 0, y: 0, z: 0 }, RightLowerLeg: { x: 0, y: 0, z: 0 },
    LeftFoot: { x: 0, y: 0, z: 0 }, RightFoot: { x: 0, y: 0, z: 0 }
  };
}

function makeStepCycle(phase, { hipSwing, kneeBend, bounce, liftBoost = 0 }) {
  const a = Math.sin(phase * Math.PI * 2);          // bal láb fázisa
  const b = Math.sin(phase * Math.PI * 2 + Math.PI); // jobb láb (180°-kal eltolva)
  const lLift = Math.max(0, a);
  const rLift = Math.max(0, b);
  return {
    legs: {
      LeftUpperLeg: { x: a * hipSwing - lLift * liftBoost, y: 0, z: 0 },
      RightUpperLeg: { x: b * hipSwing - rLift * liftBoost, y: 0, z: 0 },
      LeftLowerLeg: { x: -lLift * kneeBend, y: 0, z: 0 },
      RightLowerLeg: { x: -rLift * kneeBend, y: 0, z: 0 },
      LeftFoot: { x: -a * 10 * DEG, y: 0, z: 0 },
      RightFoot: { x: -b * 10 * DEG, y: 0, z: 0 }
    },
    hipsOffsetY: Math.abs(Math.sin(phase * Math.PI * 2 * 2)) * bounce,
    hipsLean: { x: 0, y: a * 3 * DEG, z: -a * 2 * DEG }
  };
}

function makeLateralCycle(phase, dir) {
  // 0->0.5: lépés oldalra és megállás, 0.5->1: vissza középre
  const out = phase < 0.5 ? (phase / 0.5) : (1 - (phase - 0.5) / 0.5);
  const stepLeg = dir > 0 ? "RightUpperLeg" : "LeftUpperLeg";
  const stanceLeg = dir > 0 ? "LeftUpperLeg" : "RightUpperLeg";
  const legs = zeroLegs();
  legs[stepLeg] = { x: 0, y: 0, z: dir * out * 30 * DEG };
  legs[stanceLeg] = { x: 0, y: 0, z: dir * out * 12 * DEG };
  legs[dir > 0 ? "RightLowerLeg" : "LeftLowerLeg"] = { x: -out * 12 * DEG, y: 0, z: 0 };
  return {
    legs,
    hipsOffsetY: -out * 0.02,
    hipsLean: { x: 0, y: 0, z: dir * out * 4 * DEG }
  };
}

const BASE_FREQ_HZ = {
  idle: 0.15, walk: 1.0, run: 1.9, highKnee: 1.4,
  squat: 0.35, squatJump: 0.55, lateralLeft: 0.5, lateralRight: 0.5
};

const CROSSFADE_MS = 280;

export class LowerBodyAnimator {
  constructor() {
    this.current = "idle";
    this.previous = null;
    this.phase = 0;
    this.prevPhase = 0;
    this.crossfadeT = 1; // 1 = nincs átmenet folyamatban
    this.speedScale = 1;
  }

  /** A klasszifikátor minden frame-en frissítheti, mit szeretne látni. */
  setTarget(animName, speedScale = 1) {
    if (!CLIPS[animName]) return;
    if (animName !== this.current) {
      this.previous = this.current;
      this.prevPhase = this.phase;
      this.current = animName;
      this.phase = 0;
      this.crossfadeT = 0;
    }
    this.speedScale = speedScale;
  }

  update(dtSec) {
    const freq = (BASE_FREQ_HZ[this.current] || 1) * this.speedScale;
    this.phase = (this.phase + dtSec * freq) % 1;
    if (this.previous) {
      const prevFreq = (BASE_FREQ_HZ[this.previous] || 1) * this.speedScale;
      this.prevPhase = (this.prevPhase + dtSec * prevFreq) % 1;
      this.crossfadeT = Math.min(1, this.crossfadeT + dtSec * 1000 / CROSSFADE_MS);
      if (this.crossfadeT >= 1) this.previous = null;
    }

    const curPose = CLIPS[this.current](this.phase);
    if (!this.previous) return curPose;

    const prevPose = CLIPS[this.previous](this.prevPhase);
    return blendPoses(prevPose, curPose, this.crossfadeT);
  }

  /** Ráírja a kiszámolt pózt a VRM humanoid lábcsontjaira és a Hips-re. */
  apply(vrm, pose) {
    const hum = vrm.humanoid;
    if (!hum) return;
    for (const boneName of Object.keys(pose.legs)) {
      const lowerCamel = boneName[0].toLowerCase() + boneName.slice(1);
      const node = hum.getNormalizedBoneNode(lowerCamel);
      if (!node) continue;
      const r = pose.legs[boneName];
      node.rotation.set(r.x, r.y, r.z);
    }
    const hipsNode = hum.getNormalizedBoneNode("hips");
    if (hipsNode) {
      hipsNode.position.y = (hipsNode.userData._baseY ?? (hipsNode.userData._baseY = hipsNode.position.y)) + pose.hipsOffsetY;
    }
  }
}

function blendPoses(a, b, t) {
  const legs = {};
  for (const k of Object.keys(b.legs)) {
    legs[k] = {
      x: lerp(a.legs[k]?.x || 0, b.legs[k].x, t),
      y: lerp(a.legs[k]?.y || 0, b.legs[k].y, t),
      z: lerp(a.legs[k]?.z || 0, b.legs[k].z, t)
    };
  }
  return {
    legs,
    hipsOffsetY: lerp(a.hipsOffsetY, b.hipsOffsetY, t),
    hipsLean: {
      x: lerp(a.hipsLean.x, b.hipsLean.x, t),
      y: lerp(a.hipsLean.y, b.hipsLean.y, t),
      z: lerp(a.hipsLean.z, b.hipsLean.z, t)
    }
  };
}
function lerp(a, b, t) { return a + (b - a) * t; }
