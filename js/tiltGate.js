// js/tiltGate.js
// A kamera dőlésszögének ELLENŐRZÉSE: nem checkbox/gomb dönt, hanem mért, stabil állapot.
// Ld. a beszélgetésben lefektetett szabályokat:
//  - ha nincs detektált ember -> külön, "állítsd át teljesen" üzenet
//  - ha headSpaceNorm a tartományon kívül -> irányspecifikus instrukció (lent/fent néz a kamera)
//  - ha a tartományon belül van, de nem stabil -> "tartsd mozdulatlanul" üzenet
//  - csak stabil, tartós, tartományon belüli állapot után enged tovább (auto_confirmed_ok)

const IDEAL_MIN = 0.08;
const IDEAL_MAX = 0.20;
const STABLE_HOLD_MS = 1300;       // ennyi ideig kell folyamatosan jónak lennie
const NO_PERSON_TIMEOUT_MS = 4000; // ha ennyi ideig nincs detekció, külön üzenet jön
const STALE_DETECTION_MS = 600;    // ha ennyi ideje nem jött friss landmark, "nincs detekció"-nak vesszük
const HELP_AFTER_MS = 25000;       // ha ennyi ideig nem sikerül, extra türelmetlen tipp is megjelenik

export const TiltVerdict = {
  NO_PERSON: "no_person_detected",
  TOO_LOW: "too_low_or_tilted_down",
  TOO_HIGH: "too_high_or_tilted_up",
  SETTLING: "settling",
  OK: "auto_confirmed_ok"
};

export class TiltGate {
  /**
   * @param {(state: {verdict:string, message:string, sub:string, headSpaceNorm:number|null, progress:number}) => void} onUpdate
   * @param {() => void} onPassed - akkor hívódik meg EGYSZER, amikor a kapu kinyílik
   */
  constructor(onUpdate, onPassed) {
    this.onUpdate = onUpdate;
    this.onPassed = onPassed;
    this.startedAt = performance.now();
    this.lastSeenAt = 0;
    this.goodSince = null; // mikortól van folyamatosan a tartományon belül
    this.passed = false;
    this.lastHeadSpace = null;
  }

  /** Minden pose-frame-re hívandó. landmarks lehet null, ha nincs detekció. */
  update(landmarks) {
    if (this.passed) return;
    const now = performance.now();

    if (!landmarks || !landmarks[0]) {
      this._handleNoPerson(now);
      return;
    }
    this.lastSeenAt = now;

    const head = landmarks[0];
    const headSpaceNorm = head.y; // mennyi hely van a fej fölött (0 = a kép tetejénél van a fej)
    this.lastHeadSpace = headSpaceNorm;

    if (headSpaceNorm < IDEAL_MIN) {
      this.goodSince = null;
      this._emit(TiltVerdict.TOO_LOW,
        "Túl sok üres hely van a fejed fölött a képen — a kamera valószínűleg alacsonyan van vagy lefelé néz.",
        "Döntsd lejjebb a kamera tetejét / billentsd felfelé a lencsét.",
        headSpaceNorm, 0, now);
      return;
    }
    if (headSpaceNorm > IDEAL_MAX) {
      this.goodSince = null;
      this._emit(TiltVerdict.TOO_HIGH,
        "A fejed nem fér be rendesen a képbe, vagy túl közel van a kép tetejéhez — a kamera valószínűleg túl magasan van vagy felfelé néz.",
        "Döntsd lejjebb a lencsét, vagy állítsd a kamerát alacsonyabbra.",
        headSpaceNorm, 0, now);
      return;
    }

    // Tartományon belül vagyunk -- de stabilnak is kell lennie.
    if (this.goodSince === null) this.goodSince = now;
    const heldFor = now - this.goodSince;
    const progress = Math.min(1, heldFor / STABLE_HOLD_MS);

    if (heldFor < STABLE_HOLD_MS) {
      this._emit(TiltVerdict.SETTLING,
        "Majdnem jó a beállítás, de még mozog/ingadozik a kép.",
        "Állj/rögzítsd a kamerát egy helyben kb. 1-2 másodpercre, amíg a rendszer megerősíti.",
        headSpaceNorm, progress, now);
      return;
    }

    // Stabil, tartományon belüli állapot -> kapu nyit.
    this._emit(TiltVerdict.OK,
      "✅ Jó a fejed feletti hely, a beállítás stabil.",
      "",
      headSpaceNorm, 1, now);
    this.passed = true;
    this.onPassed && this.onPassed();
  }

  _handleNoPerson(now) {
    this.goodSince = null;
    const sinceSeen = this.lastSeenAt ? (now - this.lastSeenAt) : (now - this.startedAt);
    if (sinceSeen < STALE_DETECTION_MS && this.lastSeenAt !== 0) {
      // csak egy múló frame-kihagyás, ne villogtassunk üzenetet emiatt
      return;
    }
    let sub = "Ellenőrizd, hogy ráirányítod-e a kamerát magadra, és van-e elég fény a helyiségben.";
    if (now - this.startedAt > HELP_AFTER_MS) {
      sub += " Ha sokáig nem sikerül: próbáld a laptopot/telefont egy könyvre, asztal szélére állítani, szemmagasságban.";
    }
    this._emit(TiltVerdict.NO_PERSON, "Nem látlak a képen.", sub, null, 0, now);
  }

  _emit(verdict, message, sub, headSpaceNorm, progress, now) {
    if (now - this.startedAt > HELP_AFTER_MS && verdict !== TiltVerdict.OK && !sub.includes("könyvre")) {
      sub = sub ? sub + " Ha sokáig nem sikerül: próbáld a laptopot/telefont egy könyvre, asztal szélére állítani, szemmagasságban." : sub;
    }
    this.onUpdate({ verdict, message, sub, headSpaceNorm, progress });
  }
}
