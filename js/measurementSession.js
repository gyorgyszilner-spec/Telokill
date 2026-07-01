// js/measurementSession.js
// "Induljon el a felvétel, mondja, hogy mit csináljak, a végén meg mentem. Mindig
// állítson vissza alapállásba két gyakorlat között. Minden gyakorlatot csináltass meg,
// amit mérni szeretnél."
//
// Teljesen kézmentes: egyetlen gombnyomás indítja, utána csak hangutasítás vezet végig
// minden mérendő gyakorlaton, a végén automatikusan letölti a naplót. Nem kell a
// képernyőt olvasni vagy gombokat nyomni menet közben (2 méterről sem).

export const MEASURE_PHASES = [
  { key: "stand", label: "Állás", instruction: "Állj nyugodtan, egyenesen.", duration: 6 },
  { key: "walk", label: "Séta helyben", instruction: "Járj helyben, kényelmes tempóban.", duration: 8 },
  { key: "run", label: "Futás helyben", instruction: "Válts helyben futásra.", duration: 8 },
  { key: "highknee", label: "Magas térd", instruction: "Emeld a térdeidet magasra, helyben járva.", duration: 8 },
  { key: "squat", label: "Guggolás", instruction: "Guggolj le és állj fel néhányszor, lassan.", duration: 10 },
  { key: "squat_jump", label: "Guggolás-ugrás", instruction: "Guggolj le, majd ugorj fel belőle, néhányszor.", duration: 10 },
  { key: "lateral_right", label: "Oldallépés jobbra", instruction: "Lépj jobbra egyet, állj meg, majd lépj vissza középre.", duration: 6 },
  { key: "lateral_left", label: "Oldallépés balra", instruction: "Lépj balra egyet, állj meg, majd lépj vissza középre.", duration: 6 },
  { key: "arm_forward", label: "Kar előre", instruction: "Nyújtsd mindkét karodat magad elé, előre.", duration: 6 },
  { key: "arm_up", label: "Kar fel", instruction: "Emeld mindkét karodat a fejed fölé.", duration: 6 },
  { key: "arm_side", label: "Kar oldalra", instruction: "Nyújtsd a karjaidat oldalra, T-alakban.", duration: 6 },
  { key: "arm_rest", label: "Kar nyugalomban", instruction: "Engedd le a karjaidat lazán magad mellé.", duration: 5 }
];

const RESET_INSTRUCTION = "Állj vissza alapállásba: nyugodtan, karok lazán az oldaladon.";
const RESET_DURATION_MS = 2600;

export class MeasurementSequencer {
  /**
   * @param {object} hooks
   *   onInstruction(text) - hangosan felolvasandó szöveg
   *   onPhaseChange(phase, idx, total) - fázisváltáskor (a "reset" nem számít fázisnak)
   *   onResetBaselines() - alapállás-visszaállításkor hívandó (klasszifikátor reset)
   *   onFinish() - a rutin végén
   */
  constructor(hooks) {
    this.onInstruction = hooks.onInstruction;
    this.onPhaseChange = hooks.onPhaseChange;
    this.onResetBaselines = hooks.onResetBaselines;
    this.onFinish = hooks.onFinish;
    this.index = -1;
    this.timer = null;
    this.currentKey = "reset";
    this.running = false;
  }

  start() {
    this.running = true;
    this._doReset();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  get currentPhaseKey() {
    return this.currentKey;
  }

  _doReset() {
    if (!this.running) return;
    this.currentKey = "reset";
    this.onResetBaselines && this.onResetBaselines();
    this.onInstruction && this.onInstruction(RESET_INSTRUCTION);
    this.timer = setTimeout(() => this._nextPhase(), RESET_DURATION_MS);
  }

  _nextPhase() {
    if (!this.running) return;
    this.index++;
    if (this.index >= MEASURE_PHASES.length) {
      this.running = false;
      this.onFinish && this.onFinish();
      return;
    }
    const phase = MEASURE_PHASES[this.index];
    this.currentKey = phase.key;
    this.onPhaseChange && this.onPhaseChange(phase, this.index, MEASURE_PHASES.length);
    this.onInstruction && this.onInstruction(phase.instruction);
    this.timer = setTimeout(() => this._doReset(), phase.duration * 1000);
  }
}
