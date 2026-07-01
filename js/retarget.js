// js/retarget.js
// Kalidokit a MediaPipe pose-landmarkokból humanoid csont-rotációkat számol. Mi ebből
// TUDATOSAN csak a felsőtestet (Hips rotáció, Spine, Chest, karok) visszük át a VRM-re -
// a lábcsontokat egyáltalán nem írjuk Kalidokit-ból (ld. lowerBodyAnims.js + poseClassifier.js).
//
// KÉT FONTOS JAVÍTÁS ebben a verzióban:
//
// 1) VALÓDI TÜKRÖZÉS (a felhasználó pontos specifikációja alapján, majd élő teszttel
//    finomítva): Ginger háttal áll (180°-ban elforgatva -- ld. vrmStage.js), ÉS a mozgása
//    a saját középpontjához képest tükrözve van. Egy tükrözés két részből áll: (a) a
//    bal/jobb végtag-hozzárendelés felcserélése, és (b) magának a rotáció-adatnak a
//    tükrözése. Élő teszt alapján kiderült, hogy ebből csak az Y-komponens megfordítása
//    volt helyes (ez javította az előre/hátra irányt) -- a Z-komponens megfordítása
//    ELRONTOTTA a fel/le irányt, ami előtte jó volt, úgyhogy azt visszavontuk. Ld. _mirror().
//
// 2) SMOOTH MOZGÁS: a célrotációk kiszámítása (Kalidokit.Pose.solve) csak akkor fut, amikor
//    új MediaPipe-detekció érkezik (a poseEngine saját, kamera/modell-sebességű hurkjában) --
//    de a tényleges csontra-írást (slerp) ELVÁLASZTJUK ettől, és minden render-frame-ben
//    futtatjuk (time-delta alapú simítással), a képernyő saját frissítési ütemén. Így a
//    mozgás akkor is folyamatos marad, ha a detekció lassabb/egyenetlenebb, mint a render.

// 3) "LOBOGÓ KÉZ" JAVÍTÁSA: ha a csukló kikerül a kamera látóteréből (alacsony
//    visibility), NEM frissítjük az adott kar célrotációját -- egyszerűen kihagyjuk azt a
//    frame-et. Mivel az applyToVRM mindig az utoljára beállított target felé közelít, ez
//    magától "befagyasztja" a kart az utolsó megbízható állásban (az alkarcsont
//    folytatásaként), és csak akkor "kel életre" újra, ha a csukló ismét látszik.

import * as THREE from "three";
import * as Kalidokit from "kalidokit";
import { isReliable } from "./capabilityScan.js";

const LANDMARK_IDX = {
  shoulder_l: 11, shoulder_r: 12, elbow_l: 13, elbow_r: 14,
  wrist_l: 15, wrist_r: 16, hip_l: 23, hip_r: 24
};

const SMOOTH_RATE_PER_SEC = 14; // nagyobb = gyorsabban követi a célt; time-delta alapú, frame-rate-független
const OFFSCREEN_VIS_THRESHOLD = 0.4; // ez alatt a csukló-vizibilitás alatt "nem látjuk" a kezet

const _euler = new THREE.Euler();
const _targetQuat = new THREE.Quaternion();

export class UpperBodyRetargeter {
  /** @param {object} reliabilityProfile a capabilityScan eredménye */
  constructor(reliabilityProfile) {
    this.profile = reliabilityProfile;
    this.armsReliable = isReliable(reliabilityProfile, LANDMARK_IDX.wrist_l) &&
                         isReliable(reliabilityProfile, LANDMARK_IDX.wrist_r);
    this.torsoReliable = isReliable(reliabilityProfile, LANDMARK_IDX.shoulder_l) &&
                          isReliable(reliabilityProfile, LANDMARK_IDX.hip_l);
    // boneName -> { x, y, z, dampener }  -- csak a CÉL, nincs benne csontmanipuláció
    this.targets = {};
    this.lastRawArms = {}; // debug: a Kalidokit nyers (swap/flip előtti) kar-értékei
  }

  /**
   * Új MediaPipe-detekció érkezésekor hívandó (a poseEngine saját hurkjában).
   * Csak a célrotációkat frissíti, NEM nyúl a VRM csontjaihoz.
   */
  computeTargets(landmarks2D, worldLandmarks) {
    if (!landmarks2D || !worldLandmarks || !this.torsoReliable) return;

    let riggedPose;
    try {
      riggedPose = Kalidokit.Pose.solve(worldLandmarks, landmarks2D, { runtime: "mediapipe", enableLegs: false });
    } catch (e) {
      return; // egy-egy hibás frame ne döntse el az egészet
    }
    if (!riggedPose) return;

    this.targets.hips = this._mirror(riggedPose.Hips.rotation, 0.6);
    this.targets.spine = this._mirror(riggedPose.Spine, 0.35);
    this.targets.chest = this._mirror(riggedPose.Spine, 0.2);

    // debug: a Kalidokit nyers (csere/tükrözés előtti) kar-értékei
    this.lastRawArms = {
      RightUpperArm: { ...riggedPose.RightUpperArm },
      LeftUpperArm: { ...riggedPose.LeftUpperArm },
      RightLowerArm: { ...riggedPose.RightLowerArm },
      LeftLowerArm: { ...riggedPose.LeftLowerArm }
    };

    if (this.armsReliable) {
      // bal/jobb felcserélve ÉS a rotáció Y-komponense tükrözve (ld. fejléc 1. pont).
      // A Kalidokit belső "r"/"l" számítása lm[11,13,15] (r) és lm[12,14,16] (l) párokból
      // épül -- mivel mi a Left*-ot Ginger jobb karjára tesszük, a HOZZÁ tartozó csukló a
      // lm[16] (ami a Kalidokit "l" oldalát táplálja), és fordítva a jobb oldalra lm[15].
      const rightArmVisible = landmarks2D[16] && (landmarks2D[16].visibility ?? 1) > OFFSCREEN_VIS_THRESHOLD;
      const leftArmVisible = landmarks2D[15] && (landmarks2D[15].visibility ?? 1) > OFFSCREEN_VIS_THRESHOLD;

      if (rightArmVisible) {
        this.targets.rightUpperArm = this._mirror(riggedPose.LeftUpperArm, 1);
        this.targets.rightLowerArm = this._mirror(riggedPose.LeftLowerArm, 1);
      } // else: nem frissítjük -- a kar "befagyva" marad az utolsó jó állásban

      if (leftArmVisible) {
        this.targets.leftUpperArm = this._mirror(riggedPose.RightUpperArm, 1);
        this.targets.leftLowerArm = this._mirror(riggedPose.RightLowerArm, 1);
      }
    }
  }

  /**
   * Tükrözés a karakter függőleges elölnézeti síkján. A visszajelzésből ("előre most jó,
   * de fel/le megfordult") kiderült, hogy csak az Y-komponens tükrözése volt helyes -- a Z
   * (fel/le, abdukció) tükrözése ELRONTOTTA azt, ami előtte jó volt. X és Z marad nyers.
   */
  _mirror(rotation, dampener) {
    return { x: rotation.x || 0, y: -(rotation.y || 0), z: rotation.z || 0, dampener };
  }

  /**
   * Minden render-frame-ben hívandó (nem csak új detekciónál!). Időalapú simítással
   * közelíti a csontokat az utoljára kiszámolt célrotáció felé.
   */
  applyToVRM(vrm, dtSec) {
    if (!vrm || !vrm.humanoid) return;
    const t = 1 - Math.exp(-SMOOTH_RATE_PER_SEC * dtSec); // frame-rate-független simítási faktor
    for (const boneName of Object.keys(this.targets)) {
      const target = this.targets[boneName];
      const node = vrm.humanoid.getNormalizedBoneNode(boneName);
      if (!node || !target) continue;
      _euler.set(
        (target.x || 0) * target.dampener,
        (target.y || 0) * target.dampener,
        (target.z || 0) * target.dampener,
        "XYZ"
      );
      _targetQuat.setFromEuler(_euler);
      node.quaternion.slerp(_targetQuat, t);
    }
  }
}
