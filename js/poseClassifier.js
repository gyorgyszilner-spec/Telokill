// js/poseClassifier.js
// Mivel ez játék, nem vezetett bemelegítő-szkript: nem tudhatjuk előre, mit csinál a
// játékos. Ezért minden frame-en újraértékeljük a megbízható jeleket (váll, csípő, fej -
// vis. 0.85-1.0 az eredeti session alapján), és ebből VÁLASZTJUK a canned alsótest-
// animációt. A csukló/fej/gerinc 1:1 élőben megy (ld. retarget.js), a láb innen jön.
//
// MAI JAVÍTÁSOK:
// 1) GUGGOLÁS: a felhasználó pontos szabálya szerint -- "ha a fej kb. egy fejmagasságnyival
//    lejjebb van, mint eredetileg, az guggolás". A "fejmagasság" egységet a váll-szélesség
//    egy hányadosaként közelítjük (a fej és a váll mérete nagyjából arányos, a váll-szélesség
//    pedig már amúgy is mérve van, és távolság-invariáns).
// 2) OLDALLÉPÉS: a korábbi egyszeri küszöb+cooldown+lassú-EMA-alap helyett a guggoláséhoz
//    hasonló ENTER/EXIT hiszterézisre váltva (ez már bizonyítottan működik guggolásnál),
//    hogy szimmetrikusan, megbízhatóan induljon mindkét irányba.
// 3) REMEGÉS ELLEN: (a) minimális "dwell time" a jár/fut/magas-térd/állás közötti váltásnál,
//    hogy ne kapkodjon zajos frame-ről frame-re; (b) a speedScale simítva van (EMA), hogy a
//    láb-animáció tempója ne ugráljon.

const HIP_BUFFER_SEC = 1.6;
const MIN_PEAK_DISTANCE_SEC = 0.25;     // max ~4 Hz léphet be valódi lépésként
const ABS_NOISE_FLOOR = 0.012;          // normalizált y-egységben, jitter alatt ez van

const HEAD_HEIGHT_PER_SHOULDER_WIDTH = 0.55; // közelítés: "egy fejmagasság" ~ váll-szélesség 55%-a
const SQUAT_ENTER_HEAD_HEIGHTS = 1.0;   // a felhasználó szabálya: "egy fejjel lejjebb" = guggolás
const SQUAT_EXIT_HEAD_HEIGHTS = 0.4;    // hiszterézis, ne villogjon a küszöbön
const JUMP_RISE_WINDOW_MS = 350;

const LATERAL_ENTER = 0.16;             // váll-középpont eltolódása váll-szélesség arányában
                                         // (jelentősen csökkentve -- korábban 0.35 volt túl
                                         // szigorú, emiatt sosem indult el az oldallépés)
const LATERAL_EXIT = 0.06;

const SHOULDER_WIDTH_MIN = 0.09;        // abszolút alsó korlát -- a mérési naplóban láttuk,
                                         // hogy távolabb állva a nyers érték 0.048-ig is
                                         // leesett, ami osztóként katasztrofálisan felnagyítja
                                         // a zajt (lateralDx/headDrop 2-7-ig szaladt fel emiatt)
const SHOULDER_WIDTH_SMOOTH_FACTOR = 0.08; // EMA -- a nyers érték maga is ugrált frame-ről
                                         // frame-re (0.048 -> 0.132 -> 0.048), ez nem valódi
                                         // testmozgás volt, hanem mérési zaj

const CONTINUOUS_MIN_HOLD_MS = 350;     // idle/walk/highKnee/run közötti váltás min. ideje
const SPEED_SMOOTH_FACTOR = 0.15;       // 0..1, kisebb = simább (de lassabb reakció)
const HIGH_KNEE_AMPLITUDE = 0.06;       // csípő-y kilengés, ami fölött "nagy térdemelésnek" számít

export class PoseClassifier {
  constructor() {
    this.hipYBuffer = []; // {t, y}
    this.noseYRest = null; // EMA-val tanult "álló" fej-y pozíció
    this.wasSquatting = false;
    this.squatEnteredAt = null;
    this.lateralBaselineX = null;
    this.lateralActive = false;
    this.lateralDir = 0; // -1 bal, +1 jobb (a Ginger-oldal, már a tükrözés utáni értelemben)
    this.continuousAnim = "idle";
    this.continuousSince = 0;
    this.speedScaleSmooth = 1;
    this.shoulderWidthSmooth = null; // EMA -- NEM nullázódik reset()-nél, kameratávolság-jellemző, nem pózé
  }

  /** Gyakorlatok közötti "alapállás" pillanatában hívandó -- minden baseline/állapot
   *  frissen indul, hogy ne cipeljen tovább torzult referenciapontot az előző gyakorlatból. */
  reset() {
    this.hipYBuffer = [];
    this.noseYRest = null;
    this.wasSquatting = false;
    this.squatEnteredAt = null;
    this.lateralBaselineX = null;
    this.lateralActive = false;
    this.lateralDir = 0;
    this.continuousAnim = "idle";
    this.continuousSince = 0;
    this.speedScaleSmooth = 1;
  }

  /**
   * @param {Array} lm MediaPipe 2D landmarks (33 elem) vagy null
   * @returns {{anim:string, speedScale:number, debug:object}}
   */
  update(lm, nowMs) {
    if (!lm || !lm[0] || !lm[11] || !lm[12] || !lm[23] || !lm[24]) {
      return { anim: "idle", speedScale: 1, debug: { reason: "nincs landmark" } };
    }
    const noseY = lm[0].y;
    const shoulderY = (lm[11].y + lm[12].y) / 2;
    const shoulderX = (lm[11].x + lm[12].x) / 2;
    const hipY = (lm[23].y + lm[24].y) / 2;
    const shoulderWidthRaw = Math.abs(lm[11].x - lm[12].x) || 0.15;

    // EMA-simítás + alsó korlát -- a nyers érték önmagában zajos (távolabb állva a
    // pixel-felbontás alacsonyabb, ami a landmark-becslést pontatlanná teszi), és mivel
    // ez OSZTÓKÉNT szerepel lent, egy pillanatnyi kicsi/zajos érték katasztrofálisan
    // felnagyítaná a guggolás/oldallépés jeleit (ld. mérési napló: 2-7-es "fejmagasság"
    // értékek jöttek ki egy valós, kb. 1-es guggolásból, pusztán emiatt).
    if (this.shoulderWidthSmooth === null) this.shoulderWidthSmooth = shoulderWidthRaw;
    else this.shoulderWidthSmooth += (shoulderWidthRaw - this.shoulderWidthSmooth) * SHOULDER_WIDTH_SMOOTH_FACTOR;
    const shoulderWidth = Math.max(this.shoulderWidthSmooth, SHOULDER_WIDTH_MIN);

    const headHeightUnit = shoulderWidth * HEAD_HEIGHT_PER_SHOULDER_WIDTH;

    // --- rest fej-pozíció tanulása lassú EMA-val, csak ha épp nem guggolunk ---
    if (this.noseYRest === null) this.noseYRest = noseY;
    else if (!this.wasSquatting) {
      this.noseYRest += (noseY - this.noseYRest) * 0.01;
    }

    // --- guggolás / ugrás detekció: "egy fejmagasságnyival lejjebb van a fej" ---
    const headDropHeadHeights = Math.max(0, (noseY - this.noseYRest) / headHeightUnit);
    let result = null;

    if (!this.wasSquatting && headDropHeadHeights > SQUAT_ENTER_HEAD_HEIGHTS) {
      this.wasSquatting = true;
      this.squatEnteredAt = nowMs;
    } else if (this.wasSquatting && headDropHeadHeights < SQUAT_EXIT_HEAD_HEIGHTS) {
      const heldFor = nowMs - this.squatEnteredAt;
      this.wasSquatting = false;
      if (heldFor < JUMP_RISE_WINDOW_MS) {
        result = { anim: "squatJump", speedScale: 1.4 };
      }
    }
    if (!result && this.wasSquatting) {
      result = { anim: "squat", speedScale: 1 };
    }

    // --- oldallépés detekció: ENTER/EXIT hiszterézis, ugyanaz a minta mint a guggolásnál ---
    // FONTOS: a nyers MediaPipe-koordináták tükrözetlenek (mint egy fénykép szemből), tehát
    // ha a felhasználó a SAJÁT jobbjára lép, a kép-x koordinátája CSÖKKEN. Mivel Ginger
    // háttal áll ÉS a mozgása a retarget.js-ben tükrözve van (ld. ottani _mirror()), a
    // felhasználó valódi jobbra lépésének Ginger jobbra lépését kell kiváltania -- ezért itt
    // a dx előjelét meg kell fordítani a "magától értetődő" hozzárendeléshez képest.
    if (this.lateralBaselineX === null) this.lateralBaselineX = shoulderX;
    const dx = (shoulderX - this.lateralBaselineX) / shoulderWidth;

    if (!result) {
      if (!this.lateralActive && Math.abs(dx) > LATERAL_ENTER) {
        this.lateralActive = true;
        this.lateralDir = dx < 0 ? 1 : -1; // dx<0 -> felhasználó jobbra lépett -> Ginger jobbra
      } else if (this.lateralActive && Math.abs(dx) < LATERAL_EXIT) {
        this.lateralActive = false;
      }
      if (this.lateralActive) {
        result = { anim: this.lateralDir > 0 ? "lateralRight" : "lateralLeft", speedScale: 1 };
      } else {
        // csak nyugalmi állapotban kövesse lassan a baseline -- lépés KÖZBEN ne "szaladjon el"
        this.lateralBaselineX += (shoulderX - this.lateralBaselineX) * 0.01;
      }
    }

    // --- jár/fut/magas térd a csípő-y oszcillációból (mindig frissítve, debug célból is) ---
    this.hipYBuffer.push({ t: nowMs, y: hipY });
    const cutoff = nowMs - HIP_BUFFER_SEC * 1000;
    while (this.hipYBuffer.length && this.hipYBuffer[0].t < cutoff) this.hipYBuffer.shift();
    const { freq, amplitude } = this._detectCycles();

    if (!result) {
      let candidate;
      if (amplitude < ABS_NOISE_FLOOR || freq < 0.3) {
        candidate = { anim: "idle", speedScale: 1 };
      } else if (amplitude > HIGH_KNEE_AMPLITUDE) {
        // a magas térd jellemzően LASSABB tempójú, de NAGYOBB kilengésű, mint a sima séta --
        // ezért az amplitúdó dönt előbb, nem a frekvencia (az korábban "elnyelte" walk-ba)
        candidate = { anim: "highKnee", speedScale: freq / 1.4 };
      } else if (freq < 2.0) {
        candidate = { anim: "walk", speedScale: freq / 1.0 };
      } else {
        candidate = { anim: "run", speedScale: freq / 1.9 };
      }

      // --- dwell-time: csak akkor váltunk típust, ha az előzőt már elég ideje tartjuk,
      // VAGY ha a candidate ugyanaz, mint amit már úgyis mutatunk (nem "váltás") ---
      if (candidate.anim === this.continuousAnim) {
        result = candidate;
      } else if (nowMs - this.continuousSince > CONTINUOUS_MIN_HOLD_MS) {
        this.continuousAnim = candidate.anim;
        this.continuousSince = nowMs;
        result = candidate;
      } else {
        // maradunk a korábbi típusnál, de a candidate speedScale-jét azért figyelembe vesszük
        result = { anim: this.continuousAnim, speedScale: candidate.speedScale };
      }
    } else {
      // guggolás/ugrás/oldallépés esetén a "folyamatos" (jár/fut) állapotgép nem változik,
      // de a dwell-timer nullázódik, hogy visszatéréskor ne ugorjon azonnal másik típusba
      this.continuousSince = nowMs;
    }

    // --- speedScale simítása (EMA), hogy a láb-tempó ne ugráljon ---
    const rawSpeed = clamp(result.speedScale, 0.4, 2.5);
    this.speedScaleSmooth += (rawSpeed - this.speedScaleSmooth) * SPEED_SMOOTH_FACTOR;
    result.speedScale = this.speedScaleSmooth;

    result.debug = {
      headDropHeadHeights: +headDropHeadHeights.toFixed(2),
      wasSquatting: this.wasSquatting,
      lateralDx: +dx.toFixed(2),
      lateralActive: this.lateralActive,
      hipFreqHz: +freq.toFixed(2),
      hipAmplitude: +amplitude.toFixed(3)
    };
    return result;
  }

  _detectCycles() {
    const buf = this.hipYBuffer;
    if (buf.length < 6) return { freq: 0, amplitude: 0 };
    const ys = buf.map(p => p.y);
    const amplitude = Math.max(...ys) - Math.min(...ys);
    if (amplitude < ABS_NOISE_FLOOR) return { freq: 0, amplitude };

    let peaks = 0;
    let lastPeakT = -Infinity;
    const minVal = Math.min(...ys);
    for (let i = 1; i < buf.length - 1; i++) {
      const isLocalMax = ys[i] > ys[i - 1] && ys[i] >= ys[i + 1];
      const prominent = (ys[i] - minVal) > ABS_NOISE_FLOOR; // abszolút küszöb, NEM relatív %
      const farEnough = (buf[i].t - lastPeakT) > MIN_PEAK_DISTANCE_SEC * 1000;
      if (isLocalMax && prominent && farEnough) {
        peaks++;
        lastPeakT = buf[i].t;
      }
    }
    const durationSec = (buf[buf.length - 1].t - buf[0].t) / 1000;
    const freq = durationSec > 0 ? peaks / durationSec : 0;
    return { freq, amplitude };
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
