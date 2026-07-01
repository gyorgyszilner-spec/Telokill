// js/poseEngine.js
// Felelőssége: kamera megnyitása, MediaPipe PoseLandmarker betöltése, és minden
// videoframe-re meghívja a feliratkozott listenereket a friss detekciós eredménnyel.
// Ugyanazt a modellt és beállítást használja, mint az eredeti warmup-calibrationv3.html.

import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

export const TRACK_INDICES = {
  0: "nose", 11: "shoulder_l", 12: "shoulder_r", 13: "elbow_l", 14: "elbow_r",
  15: "wrist_l", 16: "wrist_r", 23: "hip_l", 24: "hip_r", 25: "knee_l", 26: "knee_r",
  27: "ankle_l", 28: "ankle_r"
};

export class PoseEngine {
  constructor(videoEl) {
    this.video = videoEl;
    this.landmarker = null;
    this.running = false;
    this.listeners = [];
    this._lastResult = null;
  }

  onFrame(cb) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 } }, audio: false
    });
    this.video.srcObject = stream;
    await new Promise(res => this.video.onloadedmetadata = res);
    await this.video.play();
  }

  start() {
    if (!this.landmarker) throw new Error("PoseEngine.init() előbb kell, mint a start()");
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= 2) {
      const result = this.landmarker.detectForVideo(this.video, now);
      this._lastResult = result;
      const landmarks = (result.landmarks && result.landmarks[0]) || null;
      const worldLandmarks = (result.worldLandmarks && result.worldLandmarks[0]) || null;
      for (const cb of this.listeners) {
        cb({ landmarks, worldLandmarks, t: now });
      }
    }
    requestAnimationFrame(() => this._loop());
  }

  get lastResult() { return this._lastResult; }
}
