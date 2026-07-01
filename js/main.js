// js/main.js
import { PoseEngine } from "./poseEngine.js";
import { TiltGate, TiltVerdict } from "./tiltGate.js";
import { PositionLock } from "./positionLock.js";
import { CapabilityScan } from "./capabilityScan.js";
import { PoseClassifier } from "./poseClassifier.js";
import { LowerBodyAnimator } from "./lowerBodyAnims.js";
import { UpperBodyRetargeter } from "./retarget.js";
import { VRMStage } from "./vrmStage.js";
import { HandLogger } from "./handLogger.js";
import { MeasurementSequencer } from "./measurementSession.js";

// ---- DOM ----
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const octx = overlay.getContext("2d");
const startBtn = document.getElementById("startBtn");
const phaseLabel = document.getElementById("phaseLabel");
const instructionText = document.getElementById("instructionText");
const instructionSub = document.getElementById("instructionSub");
const gateBar = document.getElementById("gateBar");
const distanceGuide = document.getElementById("distanceGuide");
const distanceFill = document.getElementById("distanceFill");
const distanceLabel = document.getElementById("distanceLabel");
const stageEl = document.getElementById("stage");
const vrmStageEl = document.getElementById("vrmStage");
const gingerAudio = document.getElementById("gingerAudio");
const vrmDebug = document.getElementById("vrmDebug");

// ---- Hangszintetizátor (ugyanaz a minta, mint az eredeti kalibrációs appban) ----
const synth = window.speechSynthesis;
let huVoice = null;
function pickHungarianVoice() {
  const voices = synth.getVoices();
  huVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith("hu")) || null;
}
if (synth) {
  pickHungarianVoice();
  synth.addEventListener("voiceschanged", pickHungarianVoice);
}
function speak(text) {
  if (!synth || !text) return;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (huVoice) utter.voice = huVoice;
  utter.lang = "hu-HU";
  utter.rate = 1.0;
  if (stage && stage.setAudioDucked) {
    utter.onstart = () => stage.setAudioDucked(true);
    utter.onend = () => stage.setAudioDucked(false);
  }
  synth.speak(utter);
}

let lastSpoken = "";
function speakOnce(text) {
  if (text && text !== lastSpoken) {
    speak(text);
    lastSpoken = text;
  }
}

// ---- Állapot ----
let stage = null;
let reliabilityProfile = null;
let optimalShoulderPx = null;

function setPhase(label, text, sub = "") {
  phaseLabel.textContent = label;
  instructionText.textContent = text;
  instructionSub.textContent = sub;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Betöltés...";
  setPhase("Indítás", "Pózfelismerő modell betöltése...", "Ez első alkalommal néhány másodpercig tarthat (CDN-ről tölt).");
  const engine = new PoseEngine(video);

  try {
    console.log("[main] PoseEngine.init() indul...");
    await engine.init();
    console.log("[main] PoseEngine.init() kész.");
  } catch (err) {
    console.error("[main] init() hiba:", err);
    setPhase("Hiba", "Nem sikerült betölteni a pózfelismerő modellt.", String(err && err.message || err));
    startBtn.disabled = false;
    startBtn.textContent = "Újra";
    return;
  }

  setPhase("Indítás", "Kamera-engedély kérése...", "Ha felugrik egy böngésző-kérdés, engedélyezd a kamerát.");
  try {
    console.log("[main] startCamera() indul...");
    await engine.startCamera();
    console.log("[main] startCamera() kész.", video.videoWidth, video.videoHeight);
  } catch (err) {
    console.error("[main] startCamera() hiba:", err);
    setPhase("Hiba", "Nem sikerült elindítani a kamerát.", String(err && err.message || err));
    startBtn.disabled = false;
    startBtn.textContent = "Újra";
    return;
  }

  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  startBtn.style.display = "none";
  engine.start();
  runTiltGate(engine);
});

// ---------- 1) DŐLÉSSZÖG-KAPU ----------
function runTiltGate(engine) {
  setPhase("Kamera dőlésszöge", "Állj kb. két lépésre a kamerától.", "A rendszer automatikusan méri, nem kell gombot nyomni.");
  const gate = new TiltGate(
    (state) => {
      gateBar.className = "";
      gateBar.classList.add(
        state.verdict === TiltVerdict.NO_PERSON ? "state-none" :
        state.verdict === TiltVerdict.SETTLING || state.verdict === TiltVerdict.OK ? (state.verdict === TiltVerdict.OK ? "state-ok" : "state-settling") :
        "state-bad"
      );
      instructionText.textContent = state.message;
      instructionSub.textContent = state.sub;
      speakOnce(state.message);
      drawOverlaySkeleton(); // a meglévő landmarkok továbbra is látszanak a felhasználónak
    },
    () => {
      off();
      setTimeout(() => runPositionLock(engine), 400);
    }
  );
  const off = engine.onFrame(({ landmarks }) => {
    gate.update(landmarks);
    drawOverlayFromLandmarks(landmarks);
  });
}

// ---------- 2) POZÍCIÓ-RÖGZÍTÉS ----------
function runPositionLock(engine) {
  setPhase("Pozicionálás", "Állj be a kényelmes edzőhelyedre.", "");
  const lock = new PositionLock(
    () => overlay.width, () => overlay.height,
    (state) => {
      instructionText.textContent = state.message;
      distanceGuide.style.display = "block";
      distanceFill.style.width = `${Math.round(state.progress * 100)}%`;
      distanceFill.style.background = state.progress >= 1 ? "#3fb950" : "#d29922";
      if (state.shoulderPx) distanceLabel.textContent = `Váll-szélesség: ${Math.round(state.shoulderPx)} px`;
    },
    (px) => {
      optimalShoulderPx = px;
      off();
      setTimeout(() => runCapabilityScan(engine), 300);
    }
  );
  const off = engine.onFrame(({ landmarks }) => {
    lock.update(landmarks);
    drawOverlayFromLandmarks(landmarks);
  });
}

// ---------- 3) KAPACITÁS-FELMÉRÉS ----------
function runCapabilityScan(engine) {
  setPhase("Felmérés", "Maradj ebben a pozícióban egy pillanatra...", "");
  const scan = new CapabilityScan(
    (state) => {
      instructionText.textContent = state.message;
      distanceFill.style.width = `${Math.round(state.progress * 100)}%`;
      distanceFill.style.background = "#8ab4f8";
    },
    (profile) => {
      reliabilityProfile = profile;
      off();
      logReliabilitySummary(profile);
      setTimeout(() => enterVrmStage(engine), 300);
    }
  );
  const off = engine.onFrame(({ landmarks }) => {
    scan.update(landmarks);
    drawOverlayFromLandmarks(landmarks);
  });
}

function logReliabilitySummary(profile) {
  const absent = Object.entries(profile).filter(([, v]) => v.band === "absent").map(([i]) => i);
  console.log("[capabilityScan] absent landmarkok (mindig procedurális lesz):", absent);
}

// ---------- 4) VRM SZÍNPAD ----------
const NO_PERSON_BANNER_DELAY_MS = 700; // ennyi ideig nem lát, mire kiírjuk (ne villogjon átmeneti frame-kihagyásra)

async function enterVrmStage(engine) {
  stageEl.style.display = "none";
  vrmStageEl.style.display = "block";
  setPhase("", "", "");

  stage = new VRMStage(vrmStageEl, gingerAudio);
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      vrmStageEl.requestFullscreen().catch(err => console.warn("Fullscreen nem engedélyezett:", err));
    } else {
      document.exitFullscreen();
    }
  });

  await Promise.all([
    stage.loadBackground("./assets/bm2.jpg"),
    stage.loadGinger("./assets/Ginger.vrm")
  ]);
  if (optimalShoulderPx) stage.applyOptimalDistanceHint(optimalShoulderPx);
  stage.startAmbientAudio();

  const classifier = new PoseClassifier();
  const animator = new LowerBodyAnimator();
  const retargeter = new UpperBodyRetargeter(reliabilityProfile || {});
  const noPersonBanner = document.getElementById("noPersonBanner");
  const frameIndicator = document.getElementById("frameIndicator");

  // --- Mérési rutin: 10 mp alapállás-várakozás után AUTOMATIKUSAN indul, nem kell
  // gombot nyomni (a felhasználó nem akar elmenni a helyéről kattintani) ---
  const handLogger = new HandLogger();
  const routineStartBtn = document.getElementById("routineStartBtn");
  const logStatus = document.getElementById("logStatus");
  const STAND_STILL_WAIT_MS = 10000;
  let countdownTimer = null;

  const sequencer = new MeasurementSequencer({
    onInstruction: (text) => speak(text),
    onPhaseChange: (phase, idx, total) => {
      handLogger.setPhase(phase.key);
      logStatus.textContent = `${phase.label} (${idx + 1}/${total})`;
    },
    onResetBaselines: () => {
      handLogger.setPhase("reset");
      classifier.reset();
      logStatus.textContent = "alapállás...";
    },
    onFinish: () => {
      routineStartBtn.textContent = "▶ Mérési rutin újraindítása";
      routineStartBtn.classList.remove("running");
      handLogger.stop();
      logStatus.textContent = `kész — ${handLogger.rawLog.length} rekord, mentés indul...`;
      speak("Kész vagyunk, mentem a mérési naplót.");
      handLogger.download();
      setTimeout(() => { logStatus.textContent = "készen áll"; }, 4000);
    }
  });

  function beginRoutine() {
    countdownTimer = null;
    handLogger.start();
    sequencer.start();
    routineStartBtn.textContent = "⏹ Rutin megszakítása";
    routineStartBtn.classList.add("running");
  }

  function startStandStillCountdownThenRoutine() {
    clearTimeout(countdownTimer);
    routineStartBtn.textContent = "⏹ Várakozás megszakítása";
    routineStartBtn.classList.add("running");
    logStatus.textContent = "állj alapállásba... indul 10 mp múlva";
    speak("Kezdődik a mérés. Állj alapállásba, tíz másodperc múlva indul a rögzítés.");
    countdownTimer = setTimeout(beginRoutine, STAND_STILL_WAIT_MS);
  }

  // automatikus indítás -- nem kell gombot nyomni
  startStandStillCountdownThenRoutine();

  routineStartBtn.addEventListener("click", () => {
    if (sequencer.running || countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
      sequencer.stop();
      handLogger.stop();
      routineStartBtn.textContent = "▶ Mérési rutin indítása";
      routineStartBtn.classList.remove("running");
      logStatus.textContent = "megszakítva";
    } else {
      startStandStillCountdownThenRoutine();
    }
  });

  // --- Keret-indikátor: mennyire vagy benne a kamera látómezejében ---
  // (külön #frameIndicator réteg, ld. CSS megjegyzés -- a #vrmStage-en nem látszott,
  // mert a canvas eltakarta a szülő box-shadow-ját)
  const FRAME_IDX = [0, 11, 12, 15, 16, 23, 24];
  function updateFrameIndicator(landmarks) {
    frameIndicator.classList.remove("frame-safe", "frame-warn", "frame-danger");
    if (!landmarks) { frameIndicator.classList.add("frame-danger"); return; }
    let minX = 1, maxX = 0, minY = 1, maxY = 0, seen = 0;
    for (const i of FRAME_IDX) {
      const p = landmarks[i];
      if (!p) continue;
      seen++;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (seen === 0) { frameIndicator.classList.add("frame-danger"); return; }
    const margin = Math.min(minX, 1 - maxX, minY, 1 - maxY);
    if (margin < 0.03) frameIndicator.classList.add("frame-danger");
    else if (margin < 0.12) frameIndicator.classList.add("frame-warn");
    else frameIndicator.classList.add("frame-safe");
  }

  let lastSeenAt = performance.now();
  engine.onFrame(({ landmarks, worldLandmarks, t }) => {
    // --- "nem lát a kamera" jelzés ---
    if (landmarks) {
      lastSeenAt = t;
      noPersonBanner.style.display = "none";
    } else if (t - lastSeenAt > NO_PERSON_BANNER_DELAY_MS) {
      noPersonBanner.style.display = "block";
    }

    if (landmarks) retargeter.computeTargets(landmarks, worldLandmarks);
    updateFrameIndicator(landmarks);

    const target = classifier.update(landmarks, t);
    animator.setTarget(target.anim, target.speedScale);
    updateDebugPanel(target, retargeter.lastRawArms);
    handLogger.log(t, retargeter.lastRawArms, landmarks, target.debug, target.anim);
  });

  function renderLoop() {
    if (stage.vrm) {
      const dt = stage.getDeltaSec();
      const pose = animator.update(dt);
      animator.apply(stage.vrm, pose);
      retargeter.applyToVRM(stage.vrm, dt);
      stage.vrm.update(dt);
    }
    stage.render();
    requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

function updateDebugPanel(target, rawArms) {
  const d = target.debug || {};
  const ra = rawArms || {};
  const fmt = (o) => o ? `x:${(o.x||0).toFixed(2)} y:${(o.y||0).toFixed(2)} z:${(o.z||0).toFixed(2)}` : "—";
  vrmDebug.textContent =
    `LÁB → ${target.anim} (${target.speedScale.toFixed(2)}x)\n` +
    `  fej-süllyedés: ${d.headDropHeadHeights ?? "—"} fejmagasság   guggol: ${d.wasSquatting ? "igen" : "nem"}\n` +
    `  csípő-oszcilláció: ${d.hipFreqHz ?? "—"} Hz, ampl. ${d.hipAmplitude ?? "—"}\n` +
    `  oldal-eltolás (dx): ${d.lateralDx ?? "—"}   aktív: ${d.lateralActive ? "igen" : "nem"}\n` +
    `KAR (nyers Kalidokit, csere/tükrözés ELŐTT):\n` +
    `  RightUpperArm  ${fmt(ra.RightUpperArm)}\n` +
    `  LeftUpperArm   ${fmt(ra.LeftUpperArm)}\n` +
    `  RightLowerArm  ${fmt(ra.RightLowerArm)}\n` +
    `  LeftLowerArm   ${fmt(ra.LeftLowerArm)}`;
}

// ---------- Overlay rajzolás (ugyanaz a vizuál, mint az eredeti kalibrációs appban) ----------
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [0, 11], [0, 12]
];
function confidenceColor(v) {
  if (v > 0.7) return "#3fb950";
  if (v > 0.3) return "#d29922";
  return "#f85149";
}
function drawOverlayFromLandmarks(lms) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lms) return;
  octx.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    const la = lms[a], lb = lms[b];
    if (!la || !lb) continue;
    const avgV = ((la.visibility ?? 0) + (lb.visibility ?? 0)) / 2;
    octx.strokeStyle = confidenceColor(avgV);
    octx.globalAlpha = Math.max(0.25, avgV);
    octx.beginPath();
    octx.moveTo(la.x * overlay.width, la.y * overlay.height);
    octx.lineTo(lb.x * overlay.width, lb.y * overlay.height);
    octx.stroke();
  }
  octx.globalAlpha = 1;
  lms.forEach((lm) => {
    const v = lm.visibility ?? 0;
    octx.fillStyle = confidenceColor(v);
    octx.beginPath();
    octx.arc(lm.x * overlay.width, lm.y * overlay.height, 5, 0, Math.PI * 2);
    octx.fill();
  });
}
function drawOverlaySkeleton() { /* no-op hook, ld. drawOverlayFromLandmarks hívásokat */ }
