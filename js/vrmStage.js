// js/vrmStage.js
// A kalibráció/dőlés-kapu UTÁN váltunk erre a "színpadra": eltűnik a nyers kamerakép,
// helyette bm2.jpg a háttér, Ginger.vrm pedig háttal áll. FOTÓS-SZEMPONTÚ KERETEZÉS:
// nem ízületnél vágunk (az amputáltnak hat), hanem a COMB KÖZEPÉNÉL -- ez Ginger saját
// csontváz-arányaiból (csípő- és térd-csont középpontja) jön, ezért teljesen független
// attól, hogy a kamera mit lát élőben a felhasználóból. A vágási vonal a vászon ALJÁRA
// esik (nincs "padló-margó" alatta), a fej teteje pedig a felső harmadoló vonalig ér.
// A Ginger.mp3 ekkor indul, halkan (ne nyomja el a szóbeli (speechSynthesis) utasításokat).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const FOV_DEG = 30;
const HEAD_LINE_FRAC = 1 / 3; // felső harmadoló vonal
const CROP_NDC = -1;          // a vágási vonal (comb-közép) a vászon aljára essen

const BG_VOLUME = 0.22;     // "ne legyen olyan hangos, hogy zavarja az utasításokat"
const BG_VOLUME_DUCKED = 0.08;

export class VRMStage {
  constructor(containerEl, audioEl) {
    this.container = containerEl;
    this.audioEl = audioEl;
    this.vrm = null;
    this.clock = new THREE.Clock();
    this._initThree();
  }

  _initThree() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, w / h, 0.1, 20);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(0.6, 1.4, 1.2);
    this.scene.add(dir);

    window.addEventListener("resize", () => this._onResize());
    document.addEventListener("fullscreenchange", () => {
      // a fullscreen váltás nem mindig generál azonnali window resize eseményt minden böngészőben
      requestAnimationFrame(() => this._onResize());
    });
  }

  _onResize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.vrm) this._positionGinger();
  }

  async loadBackground(url) {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    // Hogy ne torzuljon, egy nagy, kamerát-fedő síkként is feltehetnénk, de a
    // scene.background egyszerűbb és a 16:9 stage-arány mellett jól teljesít.
  }

  async loadGinger(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (typeof VRMUtils.removeUnnecessaryVertices === "function") {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
    }
    if (typeof VRMUtils.removeUnnecessaryJoints === "function") {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
    }
    vrm.scene.rotation.y = Math.PI; // háttal a nézőnek
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    this._positionGinger();
    return vrm;
  }

  /** A vágási vonal (comb-közép) a vászon aljára, a fej teteje a felső harmadoló vonalra essen. */
  _positionGinger() {
    if (!this.vrm) return;
    // 4. pont javítása: Box3/csont-világpozíció mérése előtt explicit frissítés kell,
    // különben elavult (pl. skálázás/rotáció előtti) mátrixot olvashatunk vissza.
    this.vrm.scene.updateMatrixWorld(true);

    const hipBone = this.vrm.humanoid.getNormalizedBoneNode("leftUpperLeg");
    const kneeBone = this.vrm.humanoid.getNormalizedBoneNode("leftLowerLeg");
    if (!hipBone || !kneeBone) return;
    const hipPos = new THREE.Vector3();
    const kneePos = new THREE.Vector3();
    hipBone.getWorldPosition(hipPos);
    kneeBone.getWorldPosition(kneePos);
    const cropY = (hipPos.y + kneePos.y) / 2; // comb-közép világ-Y

    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const headTopY = box.max.y;

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const headNdc = 1 - 2 * HEAD_LINE_FRAC;
    const vh = (headTopY - cropY) / (headNdc - CROP_NDC);
    const cy = cropY - CROP_NDC * vh;
    const dist = vh / Math.tan(fovRad / 2);

    this.camera.position.set(0, cy, dist);
    this.camera.lookAt(0, cy, 0);
  }

  /** A felhasználó kalibrált váll-px optimumából durván becsüljük, mennyire "közel" álljon
   *  Ginger - ezzel a játék térérzete illeszkedik ahhoz, amit a kalibráció során mértünk. */
  applyOptimalDistanceHint(optimalShoulderPx, refShoulderPx = 245) {
    const scale = THREE.MathUtils.clamp(optimalShoulderPx / refShoulderPx, 0.75, 1.3);
    if (this.vrm) this.vrm.scene.scale.setScalar(1 / scale);
    this._positionGinger();
  }

  startAmbientAudio() {
    if (!this.audioEl) return;
    this.audioEl.volume = BG_VOLUME;
    this.audioEl.loop = true;
    this.audioEl.play().catch(() => {
      // autoplay policy -- ha a böngésző blokkolja, az első kattintásra/koppintásra induljon
      const resume = () => { this.audioEl.play(); window.removeEventListener("pointerdown", resume); };
      window.addEventListener("pointerdown", resume, { once: true });
    });
  }

  /** Szóbeli instrukció (speechSynthesis) alatt halkítsunk, utána vissza. */
  setAudioDucked(ducked) {
    if (!this.audioEl) return;
    this.audioEl.volume = ducked ? BG_VOLUME_DUCKED : BG_VOLUME;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  getDeltaSec() {
    return this.clock.getDelta();
  }
}
