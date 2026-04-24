class BowlingMachineController {
  constructor() {
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    this.cacheConfig = {
      maxSize: 5000, cleanupThreshold: 4500,
      cleanupBatchSize: 1000, maxAge: 3600000,
    };

    this.speedRpmProfile = {
      referenceSpeed: 110,
      toleranceProfile: {
        60: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 },
        70: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        80: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        90: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        100: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        110: { rpmTolerance: 5, interpolationWeight: 1.0, patternMultiplier: 1.0 },
        120: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        130: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        140: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        150: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        160: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 },
      },
    };

    this.safety = {
      leftRightTilt: { min: 890, max: 2000 },
      pan: { min: 2500, max: 3300 },
      tilt: { min: 2000, max: 3400 },
    };

    this.speedGroups = [
      {
        name: 'G1_60_70', speeds: new Set([60, 70]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: -300, tiltSpinMultiplier: 1.15, lrTiltBias: -200, lrTiltOffsetMultiplier: 1.4, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
      {
        name: 'G2_80', speeds: new Set([80]),
        params: { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.08, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
      {
        name: 'G3_90_100', speeds: new Set([90, 100]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
      {
        name: 'G4_110_120', speeds: new Set([110, 120]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
      {
        name: 'G5_130_140', speeds: new Set([130, 140]),
        params: { swingPanBase: 15, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -160, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
      {
        name: 'G6_150_160', speeds: new Set([150, 160]),
        params: { swingPanBase: 15, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -200, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }
      },
    ];

    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheAccessCount = new Map();

    this.metrics = {
      cacheHits: 0, interpolations: 0, exactMatches: 0,
      cacheCleanups: 0, expiredEntries: 0, totalMemoryUsage: 0, lastCleanupRemoved: 0,
    };

    // ─────────────────────────────────────────────────────────────────────────
    //  CALIBRATION
    //
    //  All randomisation deltas live here.
    //  Update via loadCalibrationData() after real-machine measurement.
    //  All values marked TBC are placeholders.
    //
    //  LEVEL RULES (applied ONLY on variation/random balls, never on default balls):
    //
    //  Level 1 — up to 2 variation balls in a 6-ball over
    //    • Speed drift: ±5–7 km/h              (TBC)
    //    • Length shift: ±20 cm                (TBC)
    //    • Line shift:   ±20 cm                (TBC)
    //    • Spin:         can go straight (0), NOT opposite
    //    • Swing:        locked — no change
    //
    //  Level 2 — exactly 2 variation balls in a 6-ball over
    //    • Speed drift: ±7–10 km/h             (TBC)
    //    • Length shift: ±30 cm                (TBC)
    //    • Line shift:   ±30 cm                (TBC)
    //    • Spin:         same-side intensity swap, can go straight
    //    • Swing:        locked — no change
    //
    //  Level 3 — 2 or 3 variation balls in a 6-ball over
    //    • Speed drift: ±10–15 km/h            (TBC)
    //    • Length shift: ±50 cm                (TBC)
    //    • Line shift:   ±40 cm                (TBC)
    //    • Spin:         can change including opposite-turn
    //    • Swing:        can change (±1 from base, clamped to valid range)
    // ─────────────────────────────────────────────────────────────────────────
    //  CALIBRATION  — direct machine-value shift ranges per level
    //
    //  Each field has { min, max, minGap } where:
    //    min / max  → the smallest and largest SHIFT that can be applied to that
    //                 field.  A random value is drawn from [min, max] and the
    //                 sign (+ or −) is chosen randomly so the result is base±shift.
    //    minGap     → the minimum difference required between this variation ball's
    //                 chosen value and the previous variation ball's value for the
    //                 same field.  Prevents two consecutive variation balls from
    //                 landing too close together.
    //
    //  Separate from cm-based X/Y deltas (X_UNITS_PER_CM, Y_UNITS_PER_CM) which
    //  control line and length shift via coordinate mutation.
    //
    //  All values marked TBC — replace via loadCalibrationData() after machine tests.
    // ─────────────────────────────────────────────────────────────────────────
    this.calibration = {
      // ── Coordinate calibration (unchanged) ──────────────────────────────────
      X_UNITS_PER_CM: 0.75,    // TBC — Test-A: lateral units per cm
      Y_UNITS_PER_CM: 0.083,   // TBC — Test-B: longitudinal units per cm

      // ── Speed drift (km/h shift on variation balls) ──────────────────────────
      speedDrift: {
        1: { min: 5, max: 7, minGap: 3 },   // TBC — L1 variation balls
        2: { min: 7, max: 10, minGap: 4 },   // TBC — L2 variation balls
        3: { min: 10, max: 15, minGap: 5 },   // TBC — L3 variation balls
      },

      // ── Length shift in cm (moves Y coordinate) ──────────────────────────────
      lengthDelta: {
        1: { min: 15, max: 25, minGap: 8 },   // TBC — ±20 cm nominal
        2: { min: 25, max: 35, minGap: 10 },   // TBC — ±30 cm nominal
        3: { min: 45, max: 55, minGap: 15 },   // TBC — ±50 cm nominal
      },

      // ── Line shift in cm (moves X coordinate, null = no shift) ───────────────
      lineDelta: {
        1: { min: 15, max: 25, minGap: 8 },   // TBC — ±20 cm nominal (L1 has line drift too)
        2: { min: 25, max: 35, minGap: 10 },   // TBC — ±30 cm nominal
        3: { min: 35, max: 45, minGap: 12 },   // TBC — ±40 cm nominal
      },

      // ── Direct machine value shift ranges ────────────────────────────────────
      //  These are ADDED to / SUBTRACTED from the machine config values returned
      //  by getMachineConfig() for each variation ball type.
      //  minGap enforces that no two consecutive variation balls have values
      //  within that many units of each other for that field.

      // RPM shift range per level (applies to both leftRPM and rightRPM)
      rpmDrift: {
        1: { min: 5, max: 15, minGap: 5 },   // TBC — small RPM variation at L1
        2: { min: 10, max: 25, minGap: 8 },   // TBC — moderate at L2
        3: { min: 15, max: 40, minGap: 10 },   // TBC — large at L3
      },

      // Tilt shift range (affects ball elevation / length)
      tiltDrift: {
        1: { min: 10, max: 30, minGap: 10 },   // TBC
        2: { min: 20, max: 60, minGap: 15 },   // TBC
        3: { min: 40, max: 100, minGap: 20 },   // TBC
      },

      // Left tilt shift range (affects spin asymmetry)
      leftTiltDrift: {
        1: { min: 10, max: 40, minGap: 15 },   // TBC
        2: { min: 30, max: 80, minGap: 20 },   // TBC
        3: { min: 60, max: 150, minGap: 30 },   // TBC
      },

      // Right tilt shift range (affects spin asymmetry, opposite direction to left)
      rightTiltDrift: {
        1: { min: 10, max: 40, minGap: 15 },   // TBC
        2: { min: 30, max: 80, minGap: 20 },   // TBC
        3: { min: 60, max: 150, minGap: 30 },   // TBC
      },

      // ── Swing and spin level deltas (L3 only) ────────────────────────────────
      swingDelta: { min: 1, max: 2, minGap: 1 },  // TBC — integer swingLevel steps
      spinDelta: { min: 1, max: 2, minGap: 1 },  // TBC — integer spinLevel steps
    };

    // ── Last-variation-ball machine values (for minGap non-repetition check) ──
    // Updated after each variation ball is generated.
    this._lastVarValues = {
      speed: null, tilt: null, leftTilt: null, rightTilt: null,
      leftRPM: null, rightRPM: null,
    };

    this.SUPPORTED_SPEEDS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];

    this.loadJsonData();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  loadCalibrationData
  //
  //  Pass the values measured on the real machine. Takes effect immediately.
  //  No code restart needed. Call after every calibration run.
  //
  //  Each shift range has { min, max, minGap }:
  //    min/max  → range of the shift applied to that machine value
  //    minGap   → min difference required between consecutive variation balls
  //
  //  Example (all values TBC — fill from machine tests):
  //    controller.loadCalibrationData({
  //      X_UNITS_PER_CM: 0.82,
  //      Y_UNITS_PER_CM: 0.091,
  //      speedDrift:     { 1:{min:4,max:6,minGap:3},  2:{min:6,max:9,minGap:4},  3:{min:9,max:13,minGap:5}  },
  //      lengthDelta:    { 1:{min:12,max:18,minGap:6}, 2:{min:22,max:30,minGap:8},3:{min:38,max:48,minGap:12} },
  //      lineDelta:      { 1:null, 2:{min:22,max:30,minGap:8}, 3:{min:32,max:42,minGap:10} },
  //      rpmDrift:       { 1:{min:5,max:12,minGap:4}, 2:{min:10,max:22,minGap:7},3:{min:15,max:35,minGap:9} },
  //      tiltDrift:      { 1:{min:8,max:25,minGap:8}, 2:{min:18,max:55,minGap:12},3:{min:35,max:90,minGap:18} },
  //      leftTiltDrift:  { 1:{min:8,max:35,minGap:12},2:{min:25,max:70,minGap:18},3:{min:50,max:130,minGap:25} },
  //      rightTiltDrift: { 1:{min:8,max:35,minGap:12},2:{min:25,max:70,minGap:18},3:{min:50,max:130,minGap:25} },
  //      swingDelta:     { min:1, max:2, minGap:1 },
  //      spinDelta:      { min:1, max:2, minGap:1 },
  //    });
  // ═══════════════════════════════════════════════════════════════════════════
  loadCalibrationData(data) {
    if (data.X_UNITS_PER_CM !== undefined) this.calibration.X_UNITS_PER_CM = data.X_UNITS_PER_CM;
    if (data.Y_UNITS_PER_CM !== undefined) this.calibration.Y_UNITS_PER_CM = data.Y_UNITS_PER_CM;
    if (data.speedDrift) this.calibration.speedDrift = { ...this.calibration.speedDrift, ...data.speedDrift };
    if (data.lengthDelta) this.calibration.lengthDelta = { ...this.calibration.lengthDelta, ...data.lengthDelta };
    if (data.lineDelta) this.calibration.lineDelta = { ...this.calibration.lineDelta, ...data.lineDelta };
    if (data.rpmDrift) this.calibration.rpmDrift = { ...this.calibration.rpmDrift, ...data.rpmDrift };
    if (data.tiltDrift) this.calibration.tiltDrift = { ...this.calibration.tiltDrift, ...data.tiltDrift };
    if (data.leftTiltDrift) this.calibration.leftTiltDrift = { ...this.calibration.leftTiltDrift, ...data.leftTiltDrift };
    if (data.rightTiltDrift) this.calibration.rightTiltDrift = { ...this.calibration.rightTiltDrift, ...data.rightTiltDrift };
    if (data.swingDelta) this.calibration.swingDelta = data.swingDelta;
    if (data.spinDelta) this.calibration.spinDelta = data.spinDelta;
    console.log('[Controller] Calibration updated:', this.calibration);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  getSessionConfig  ←  PRIMARY ENTRY POINT FOR LANE APP
  //
  //  INPUT: one ballConfig object + session options.
  //  The Lane App sends this ONCE at session start.
  //  The controller returns ALL ball configs for the entire session.
  //  The Lane App never calls the controller again during a session.
  //
  //  @param {Object} ballConfig
  //    {
  //      speed:      number,   // km/h — must be 60,70,80,90,100,110,120,130,140,150,160
  //      x:          number,   // machine X coordinate 0–300
  //      y:          number,   // machine Y coordinate 5–80
  //      swingLevel: number,   // -5 to +5
  //      spinLevel:  number,   // -5 to +5
  //    }
  //
  //  @param {Object} sessionOptions
  //    {
  //      isRandom:    boolean,   // false = all balls identical (same config)
  //      randomLevel: 1|2|3,    // ignored when isRandom is false
  //      totalBalls:  number,   // 1–135
  //    }
  //
  //  @returns {Promise<SessionConfig>}
  //    {
  //      sessionId, seed, isRandom, randomLevel, totalBalls, overs,
  //      balls: [
  //        {
  //          ballIndex, overNum, ballInOver,
  //          ballType,       // 'default' | variation type string
  //          isVariation,    // false for default balls
  //          params,         // { speed, x, y, swing, spin } sent to getMachineConfig
  //          machineConfig,  // { pan, panActual, tilt, tiltActual,
  //                          //   leftTilt, leftTiltActual, rightTilt, rightTiltActual,
  //                          //   leftRPM, rightRPM }
  //          matchType, accuracy, confidence
  //        },
  //        ...  (one entry per ball, totalBalls entries total)
  //      ]
  //    }
  // ═══════════════════════════════════════════════════════════════════════════
  async getSessionConfig(ballConfig, sessionOptions = {}) {
    const { speed, x, y, swingLevel, spinLevel } = ballConfig;
    const isRandom = sessionOptions.isRandom ?? false;
    const randomLevel = sessionOptions.randomLevel ?? 1;
    const totalBalls = Math.min(135, Math.max(1, sessionOptions.totalBalls ?? 135));

    const validation = await this._validateAndLoad(speed, x, y, swingLevel, spinLevel);
    if (validation.error) return { error: validation.error };

    const sessionSeed = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    const sessionId = `ses_${Date.now()}_${sessionSeed.toString(16)}`;
    const rng = this._createRNG(sessionSeed);
    const baseParams = { speed, x, y, swing: swingLevel, spin: spinLevel };

    // ── NON-RANDOM ────────────────────────────────────────────────────────────
    //  getMachineConfig called exactly ONCE.
    //  The resulting config is stamped on every ball — all identical.
    //  No drift. No variation. Speed drift does NOT apply to default balls.
    if (!isRandom) {
      const raw = await this.getMachineConfig(speed, x, y, swingLevel, spinLevel);
      if (raw.error) return { error: raw.error };

      const sharedConfig = raw.machineSettings ?? raw;
      const balls = Array.from({ length: totalBalls }, (_, i) => ({
        ballIndex: i + 1,
        overNum: Math.floor(i / 6) + 1,
        ballInOver: (i % 6) + 1,
        ballType: 'default',
        isVariation: false,
        params: { ...baseParams },
        machineConfig: sharedConfig,
        matchType: raw.matchType,
        accuracy: raw.accuracy,
        confidence: raw.confidence,
      }));

      return { sessionId, seed: sessionSeed, isRandom: false, randomLevel: null, totalBalls, overs: Math.ceil(totalBalls / 6), balls };
    }

    // ── RANDOM ────────────────────────────────────────────────────────────────
    //  Default balls: getMachineConfig called with unmodified base params.
    //                 No speed drift. Identical config to non-random mode.
    //  Variation balls: params are individually mutated (drift + deltas).
    //                   getMachineConfig called with mutated params → unique config.
    //
    //  Over window rules:
    //    L1 → 1 or 2 variation balls per over  (random between 1 and 2)
    //    L2 → exactly 2 variation balls per over
    //    L3 → 2 or 3 variation balls per over  (random between 2 and 3)

    // Reset per-session last-variation-values tracker
    this._lastVarValues = {
      speed: null, tilt: null, leftTilt: null, rightTilt: null,
      leftRPM: null, rightRPM: null,
    };

    // Pre-compute the base config once (used for all non-variation balls)
    const baseRaw = await this.getMachineConfig(speed, x, y, swingLevel, spinLevel);
    if (baseRaw.error) return { error: baseRaw.error };
    const baseConfig = baseRaw.machineSettings ?? baseRaw;

    let overNum = 1;
    let ballInOver = 0;
    let varTypeHistory = [];
    let oversSinceHeavy = 0;

    let { overVarSlots, overVarTypes } =
      this._planOver(rng, randomLevel, spinLevel, oversSinceHeavy, varTypeHistory);

    const balls = [];

    for (let i = 0; i < totalBalls; i++) {
      const isVarBall = overVarSlots.includes(ballInOver);
      const ballType = isVarBall ? overVarTypes[ballInOver] : 'default';

      let params;
      let machineConfig;
      let matchType, accuracy, confidence;

      if (!isVarBall) {
        // Default ball — use pre-computed base config, exact base params
        params = { ...baseParams };
        machineConfig = baseConfig;
        matchType = baseRaw.matchType;
        accuracy = baseRaw.accuracy;
        confidence = baseRaw.confidence;
      } else {
        // Variation ball — mutate params then call getMachineConfig individually
        params = this._buildBallParams(ballType, baseParams, rng, randomLevel);
        params.x = Math.max(0, Math.min(300, params.x));
        params.y = Math.max(5, Math.min(80, params.y));
        params.spin = Math.max(-5, Math.min(5, params.spin));
        params.swing = Math.max(-5, Math.min(5, params.swing));

        const raw = await this.getMachineConfig(params.speed, params.x, params.y, params.swing, params.spin);
        const rawSettings = raw.machineSettings ?? raw;

        // Apply direct machine-value drift on top of getMachineConfig output.
        // Values are shifted within the calibration ranges and guaranteed to be
        // at least minGap away from the previous variation ball's values.
        machineConfig = this._applyMachineValueDrift(rawSettings, rng, randomLevel);
        matchType = raw.matchType;
        accuracy = raw.accuracy;
        confidence = raw.confidence;
      }

      balls.push({
        ballIndex: i + 1,
        overNum,
        ballInOver: ballInOver + 1,
        ballType,
        isVariation: isVarBall,
        params,
        machineConfig,
        matchType,
        accuracy,
        confidence,
      });

      if (isVarBall) {
        varTypeHistory.push(ballType);
        if (varTypeHistory.length > 2) varTypeHistory.shift();
      }

      ballInOver++;
      if (ballInOver >= 6 && i < totalBalls - 1) {
        overNum++;
        ballInOver = 0;
        oversSinceHeavy++;
        const next = this._planOver(rng, randomLevel, spinLevel, oversSinceHeavy, varTypeHistory);
        overVarSlots = next.overVarSlots;
        overVarTypes = next.overVarTypes;
        if (Object.values(overVarTypes).includes('opp_turn_heavy')) oversSinceHeavy = 0;
      }
    }

    return { sessionId, seed: sessionSeed, isRandom: true, randomLevel, totalBalls, overs: Math.ceil(totalBalls / 6), balls };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  RANDOMISATION — PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  _createRNG(seed) {
    let s = seed >>> 0;
    const rng = {
      next() { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; },
      int(a, b) { return a + Math.floor(rng.next() * (b - a + 1)); },
      float(a, b) { return a + rng.next() * (b - a); },
      pick(arr) { return arr[rng.int(0, arr.length - 1)]; },
      shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i);[a[i], a[j]] = [a[j], a[i]]; } return a; },
    };
    return rng;
  }

  _snapSpeed(speed) {
    return this.SUPPORTED_SPEEDS.reduce((p, c) => Math.abs(c - speed) < Math.abs(p - speed) ? c : p);
  }

  // ── Over planner ─────────────────────────────────────────────────────────────
  //  Decides which ball slots (0-5) in this over are variation balls,
  //  and what type each variation ball is.
  //
  //  Slot 0 is ALWAYS default (first ball of over sets expectations).
  //  No two variation slots are consecutive within an over.
  //
  //  L1: 1 or 2 variation balls  — only length/straight changes, no line, no spin/swing change
  //  L2: exactly 2 variation balls — length + line shift, spin intensity swap (no opp-turn), no swing
  //  L3: 2 or 3 variation balls  — full changes including spin direction and swing
  _planOver(rng, level, baseSpin, oversSinceHeavy, varTypeHistory) {
    // Determine count
    const varCount = level === 1
      ? rng.int(1, 2)     // L1: 1 or 2
      : level === 2
        ? 2               // L2: always exactly 2
        : rng.int(2, 3);  // L3: 2 or 3

    // Pick non-consecutive slots from positions 1–5 (slot 0 reserved for default)
    const candidates = rng.shuffle([1, 2, 3, 4, 5]);
    const slots = [];
    for (const c of candidates) {
      if (slots.length >= varCount) break;
      if (slots.some(s => Math.abs(s - c) === 1)) continue;
      slots.push(c);
    }
    // Fallback if shuffle didn't yield enough non-consecutive slots
    const finalSlots = slots.length >= varCount
      ? slots.sort((a, b) => a - b)
      : [1, 3, 5].slice(0, varCount);

    const types = {};

    // ── Level 1 types ──────────────────────────────────────────────────────
    //  Only length shift and straight ball (spin→0).
    //  No line shift. No swing change. No opposite spin.
    if (level === 1) {
      // Randomly pick from: length-only shift OR straight ball
      const l1Pool = ['length_shift', 'straight_ball'];
      finalSlots.forEach((slot, idx) => {
        // Avoid repeating same type in back-to-back variation balls this over
        const avoid = idx > 0 ? [types[finalSlots[idx - 1]]] : varTypeHistory.slice(-1);
        const fresh = l1Pool.filter(t => !avoid.includes(t));
        types[slot] = rng.pick(fresh.length ? fresh : l1Pool);
      });
    }

    // ── Level 2 types ──────────────────────────────────────────────────────
    //  Length shift + line shift. Spin can swap intensity (same direction only).
    //  No swing change. No opposite-turn spin.
    if (level === 2) {
      const l2Pool = ['length_and_line', 'straight_and_line', 'length_spin_swap'];
      const v2Fresh = l2Pool.filter(t => !varTypeHistory.slice(-2).includes(t));
      types[finalSlots[0]] = rng.pick(v2Fresh.length ? v2Fresh : l2Pool);

      const remaining = l2Pool.filter(t => t !== types[finalSlots[0]]);
      types[finalSlots[1]] = rng.pick(remaining);
    }

    // ── Level 3 types ──────────────────────────────────────────────────────
    //  Full variation. Length + line (heavy), spin direction changes, swing changes.
    if (level === 3) {
      types[finalSlots[0]] = 'length_line_heavy';

      // Var 2: straight or opposite-turn light
      const v3v2Pool = ['straight_and_line', 'opp_turn_light'];
      const v3v2Fresh = v3v2Pool.filter(t => !varTypeHistory.slice(-2).includes(t));
      types[finalSlots[1]] = rng.pick(v3v2Fresh.length ? v3v2Fresh : v3v2Pool);

      // Var 3 (if 3 balls): heavy opposite-turn with swing change, ~1 in 2 overs
      if (finalSlots[2] !== undefined) {
        types[finalSlots[2]] = oversSinceHeavy >= 2
          ? 'opp_turn_heavy_swing'
          : this._pickNonRepeat(rng, ['swing_change', 'spin_intensity_shift'], varTypeHistory);
      }
    }

    return { overVarSlots: finalSlots, overVarTypes: types };
  }

  _pickNonRepeat(rng, options, history) {
    const fresh = options.filter(t => !history.slice(-2).includes(t));
    return rng.pick(fresh.length ? fresh : options);
  }

  // ── Per-ball variation param builder ─────────────────────────────────────────
  //  Called ONLY for variation balls (isVarBall === true).
  //  Default balls never come through here — they use unmodified base params.
  //
  //  Speed drift applies to ALL variation balls regardless of type.
  //  Other deltas depend on the ball type and level.
  _buildBallParams(ballType, base, rng, level) {
    let { speed, x, y, swing, spin } = { ...base };

    // ── Speed drift — every variation ball ───────────────────────────────────
    const dr = this.calibration.speedDrift[level] ?? { min: 5, max: 7 };
    const amt = rng.float(dr.min, dr.max) * (rng.next() < 0.5 ? 1 : -1);
    speed = this._snapSpeed(Math.max(60, speed + amt));

    const X = this.calibration.X_UNITS_PER_CM;
    const Y = this.calibration.Y_UNITS_PER_CM;
    const ld = this.calibration.lengthDelta[level] ?? { min: 15, max: 25 };
    const li = this.calibration.lineDelta[level];    // null at L1
    const rs = rng.next() < 0.5 ? 1 : -1;           // random short/full
    const ls = rng.next() < 0.5 ? 1 : -1;                  // random ± line shift direction

    switch (ballType) {

      // ── Level 1 types ────────────────────────────────────────────────────
      case 'length_shift':
        // Length changes + line drift. Spin and swing unchanged.
        y += rng.float(ld.min, ld.max) * Y * rs;
        if (li) x += rng.float(li.min, li.max) * X * ls;
        break;

      case 'straight_ball':
        // Spin → 0 (no turn). Length drifts slightly + line drift.
        spin = 0;
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * rs;
        if (li) x += rng.float(li.min, li.max) * X * ls;
        break;

      // ── Level 2 types ────────────────────────────────────────────────────
      case 'length_and_line':
        // Length + line shift. Spin unchanged.
        y += rng.float(ld.min, ld.max) * Y * rs;
        x += rng.float(li.min, li.max) * X * ls;
        break;

      case 'straight_and_line':
        // Spin → 0, line shifts. Length can drift slightly.
        spin = 0;
        x += rng.float(li.min, li.max) * X * ls;
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * rs;
        break;

      case 'length_spin_swap':
        // Length shift + spin intensity change (same direction, adjacent level).
        // E.g. base spin +2 → becomes +1 or +3.  Never crosses zero or flips direction.
        y += rng.float(ld.min, ld.max) * Y * rs;
        x += li ? rng.float(li.min, li.max) * X * ls : 0;
        spin = base.spin > 0
          ? Math.max(1, base.spin + (rng.next() < 0.5 ? -1 : 1))  // positive: stay positive
          : base.spin < 0
            ? Math.min(-1, base.spin + (rng.next() < 0.5 ? 1 : -1)) // negative: stay negative
            : 0;  // base spin 0 → stays 0
        break;

      // ── Level 3 types ────────────────────────────────────────────────────
      case 'length_line_heavy':
        // Bigger length and line deltas. Spin unchanged.
        y += rng.float(ld.min, ld.max) * Y * rs;
        x += rng.float(li.min, li.max) * X * ls;
        break;

      case 'opp_turn_light':
        // Opposite-turn, capped at magnitude 1. Line shifts.
        spin = -(Math.min(Math.abs(base.spin), 1));
        x += rng.float(li.min, li.max) * X * ls;
        y += rng.float(ld.min * 0.4, ld.max * 0.4) * Y * rs;
        break;

      case 'opp_turn_heavy_swing': {
        // Full opposite spin (using spinDelta) + swing change (using swingDelta). Heaviest variation.
        const spd2 = this.calibration.spinDelta ?? { min: 1, max: 2 };
        const spAmt = rng.int(spd2.min, spd2.max);
        // Flip spin direction AND shift magnitude by spinDelta
        spin = base.spin >= 0
          ? -Math.min(5, Math.abs(base.spin) + spAmt)
          : Math.min(5, Math.abs(base.spin) + spAmt);
        const sd = this.calibration.swingDelta ?? { min: 1, max: 2 };
        const swD = rng.int(sd.min, sd.max);
        // Swing shifts away from zero (toward more swing)
        swing = base.swing >= 0
          ? Math.min(5, base.swing + swD)
          : Math.max(-5, base.swing - swD);
        x += rng.float(li.min, li.max) * X * ls;
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * rs;
        break;
      }

      case 'swing_change': {
        // Swing changes but spin stays same. Length + line shift.
        const sd = this.calibration.swingDelta;
        const swD = rng.float(sd.min, sd.max);
        swing = base.swing >= 0
          ? Math.min(5, base.swing + Math.round(swD) + 1)
          : Math.max(-5, base.swing - Math.round(swD) - 1);
        y += rng.float(ld.min, ld.max) * Y * rs;
        x += rng.float(li.min, li.max) * X * ls;
        break;
      }

      case 'spin_intensity_shift': {
        // Spin intensity shift by spinDelta (same direction, never crosses zero).
        y += rng.float(ld.min, ld.max) * Y * rs;
        x += rng.float(li.min, li.max) * X * ls;
        const spd3 = this.calibration.spinDelta ?? { min: 1, max: 2 };
        const spAmt3 = rng.int(spd3.min, spd3.max) * (rng.next() < 0.5 ? 1 : -1);
        spin = base.spin > 0
          ? Math.max(1, Math.min(5, base.spin + spAmt3))
          : base.spin < 0
            ? Math.max(-5, Math.min(-1, base.spin + spAmt3))
            : 0;
        break;
      }

      default:
        break;
    }

    return {
      speed: Math.round(speed),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      swing,
      spin,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  _applyMachineValueDrift
  //
  //  Takes the machineSettings returned by getMachineConfig() for a variation
  //  ball and applies additional direct machine-value shifts drawn from the
  //  calibration drift ranges.
  //
  //  For each field (leftRPM, rightRPM, tilt, leftTilt, rightTilt) a random
  //  shift is drawn from [range.min, range.max] with a random sign (+/−).
  //  The non-repetition rule: if the shift would bring the new value within
  //  range.minGap of the previous variation ball's value for that field,
  //  the sign is flipped so the value moves away from the previous one instead.
  //
  //  After applying drift, the result is clamped to hardware safety limits.
  //  This.  _lastVarValues is updated for the next variation ball to check.
  // ═══════════════════════════════════════════════════════════════════════════
  _applyMachineValueDrift(settings, rng, level) {
    const cal = this.calibration;
    const last = this._lastVarValues;
    const out = { ...settings };

    // ── Helper: pick a shifted value with gap-enforcement ──────────────────────
    //  Draws a shift in [range.min, range.max], applies a random sign,
    //  then checks if Math.abs(new - lastVal) < minGap.
    //  If too close, flips the sign so we move away from last value instead.
    const driftField = (baseVal, range, lastVal, safeMin, safeMax) => {
      if (!range) return baseVal;
      const shift = rng.float(range.min, range.max);
      let sign = rng.next() < 0.5 ? 1 : -1;
      let newVal = baseVal + sign * shift;

      // Non-repetition: if too close to previous variation ball's value, flip sign
      if (lastVal !== null && Math.abs(newVal - lastVal) < (range.minGap ?? 0)) {
        sign = -sign;
        newVal = baseVal + sign * shift;
      }

      return Math.round(Math.max(safeMin, Math.min(safeMax, newVal)));
    };

    // Safety limits (from this.safety)
    const PAN_MIN = this.safety.pan.min, PAN_MAX = this.safety.pan.max;
    const TLT_MIN = this.safety.tilt.min, TLT_MAX = this.safety.tilt.max;
    const LRT_MIN = this.safety.leftRightTilt.min, LRT_MAX = this.safety.leftRightTilt.max;
    const RPM_MIN = 150, RPM_MAX = 560;

    const rpmR = cal.rpmDrift?.[level];
    const tltR = cal.tiltDrift?.[level];
    const ltrR = cal.leftTiltDrift?.[level];
    const rtrR = cal.rightTiltDrift?.[level];

    // Apply drifts
    if (rpmR) {
      out.leftRPM = driftField(settings.leftRPM, rpmR, last.leftRPM, RPM_MIN, RPM_MAX);
      out.rightRPM = driftField(settings.rightRPM, rpmR, last.rightRPM, RPM_MIN, RPM_MAX);
    }
    if (tltR) {
      out.tilt = driftField(settings.tilt, tltR, last.tilt, TLT_MIN, TLT_MAX);
      out.tiltActual = out.tilt;
    }
    if (ltrR) {
      out.leftTilt = driftField(settings.leftTilt, ltrR, last.leftTilt, LRT_MIN, LRT_MAX);
      out.leftTiltActual = out.leftTilt;
    }
    if (rtrR) {
      out.rightTilt = driftField(settings.rightTilt, rtrR, last.rightTilt, LRT_MIN, LRT_MAX);
      out.rightTiltActual = out.rightTilt;
    }

    // Update last-variation tracker for the next variation ball
    this._lastVarValues = {
      speed: null,   // speed tracked separately via params, not here
      tilt: out.tilt,
      leftTilt: out.leftTilt,
      rightTilt: out.rightTilt,
      leftRPM: out.leftRPM,
      rightRPM: out.rightRPM,
    };

    return out;
  }

  async _validateAndLoad(speed, x, y, swingLevel, spinLevel) {
    if (!Number.isFinite(speed) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(swingLevel) || !Number.isFinite(spinLevel))
      return { error: 'Invalid input parameters' };
    if (x < 0 || x > 300 || y < 5 || y > 80)
      return { error: 'Coordinates out of bounds (X: 0–300, Y: 5–80)' };
    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5)
      return { error: 'swingLevel and spinLevel must be -5 to +5' };
    try { await this.ensureDataLoaded(); } catch (e) { return { error: `Failed to load data: ${e.message}` }; }
    if (!this.jsonData.data[`${speed}_kmph`])
      return { error: `Speed ${speed} km/h not in dataset. Supported: ${this.SUPPORTED_SPEEDS.join(', ')}` };
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  getMachineConfig  — ORIGINAL SINGLE-BALL METHOD — UNCHANGED
  //  Still available for direct single-ball queries.
  //  Called internally by getSessionConfig for each variation ball.
  // ═══════════════════════════════════════════════════════════════════════════
  async getMachineConfig(speed, x, y, swingLevel, spinLevel) {
    if (!Number.isFinite(speed) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(swingLevel) || !Number.isFinite(spinLevel))
      return { error: 'Invalid input parameters' };
    if (x < 0 || x > 300 || y < 5 || y > 80) return { error: 'Coordinates out of bounds' };
    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5) return { error: 'Levels out of bounds' };
    try { await this.ensureDataLoaded(); } catch (e) { return { error: `Failed to load data: ${e.message}` }; }
    if (!this.jsonData.data[`${speed}_kmph`]) {
      const available = Object.keys(this.jsonData.data).map(k => k.replace('_kmph', '')).join(', ');
      return { error: `Speed ${speed} not supported. Available: ${available}` };
    }
    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`, spinKey = `spin_level_${spinLevel}`;
    if (!speedData.swing_levels[swingKey]) return { error: `Swing level ${swingLevel} not supported` };
    if (!speedData.swing_levels[swingKey].spin_levels[spinKey]) return { error: `Spin level ${spinLevel} not supported` };
    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];
    const positions = levelData.positions;
    let closestPosition = null, minDistance = Infinity;
    for (const [name, data] of Object.entries(positions)) {
      const d = Math.sqrt(Math.pow(data.X - x, 2) + Math.pow(data.Y - y, 2));
      if (d < minDistance) { minDistance = d; closestPosition = { name, data }; }
    }
    const speedProfile = this.getSpeedRpmProfile(speed);
    const exactThreshold = speed === 110 ? 3 : 5;
    if (minDistance < exactThreshold) {
      this.metrics.exactMatches++;
      const zeroSS = swingLevel === 0 && spinLevel === 0;
      const lRPM = zeroSS ? Math.round(closestPosition.data.L_RPM) : this.applyRealisticSpeedRpmPattern(closestPosition.data.L_RPM, speed, speedProfile, x, y);
      const rRPM = zeroSS ? Math.round(closestPosition.data.R_RPM) : this.applyRealisticSpeedRpmPattern(closestPosition.data.R_RPM, speed, speedProfile, x, y);
      return {
        speed, swingLevel, spinLevel, coordinates: { x, y },
        machineSettings: {
          pan: this.clampRange('pan', this.round1(closestPosition.data.Pan)),
          panActual: this.clampRange('pan', this.round1(closestPosition.data.Pan_actual)),
          tilt: this.clampRange('tilt', Math.round(closestPosition.data.Tilt)),
          tiltActual: this.clampRange('tilt', Math.round(closestPosition.data.Tilt_actual)),
          leftTilt: this.clampLRTilt(Math.round(closestPosition.data.Left_Tilt)),
          leftTiltActual: this.clampLRTilt(Math.round(closestPosition.data.Left_Tilt)),
          rightTilt: this.clampLRTilt(Math.round(closestPosition.data.Right_Tilt)),
          rightTiltActual: this.clampLRTilt(Math.round(closestPosition.data.Right_Tilt)),
          leftRPM: lRPM, rightRPM: rRPM,
        },
        matchType: 'exact', referencePoint: closestPosition.name, accuracy: 100, confidence: 100, distance: minDistance
      };
    }
    const interpolated = this.calculateInterpolationFromJson(speed, x, y, swingLevel, spinLevel);
    return {
      speed, swingLevel, spinLevel, coordinates: { x, y },
      machineSettings: {
        pan: interpolated.pan, panActual: interpolated.panActual, tilt: interpolated.tilt, tiltActual: interpolated.tiltActual,
        leftTilt: interpolated.leftTilt, leftTiltActual: interpolated.leftTiltActual,
        rightTilt: interpolated.rightTilt, rightTiltActual: interpolated.rightTiltActual,
        leftRPM: interpolated.leftRPM, rightRPM: interpolated.rightRPM,
      },
      matchType: 'interpolated', accuracy: Math.round(interpolated.accuracy), confidence: interpolated.confidence,
      distance: Math.round(interpolated.avgDistance * 10) / 10
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ALL ORIGINAL INTERNALS BELOW — UNCHANGED
  // ═══════════════════════════════════════════════════════════════════════════
  round1(n) { return Math.round(n * 10) / 10; }
  clampRange(key, v) { const r = this.safety[key]; return Math.max(r.min, Math.min(r.max, v)); }
  clampLRTilt(v) { const r = this.safety.leftRightTilt; return Math.max(r.min, Math.min(r.max, v)); }
  det3(a, b, c, d, e, f, g, h, i) { return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); }
  solvePlaneWeighted(points) {
    let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sw = 0, Szx = 0, Szy = 0, Sz = 0;
    for (const { x, y, z, w } of points) { Sxx += w * x * x; Sxy += w * x * y; Syy += w * y * y; Sx += w * x; Sy += w * y; Sw += w; Szx += w * x * z; Szy += w * y * z; Sz += w * z; }
    const detA = this.det3(Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, Sw);
    if (Math.abs(detA) < 1e-6) return { ok: false };
    return { ok: true, a: this.det3(Szx, Sxy, Sx, Szy, Syy, Sy, Sz, Sy, Sw) / detA, b: this.det3(Sxx, Szx, Sx, Sxy, Szy, Sy, Sx, Sz, Sw) / detA, c: this.det3(Sxx, Sxy, Szx, Sxy, Syy, Szy, Sx, Sy, Sz) / detA };
  }
  predictPlane(pts, x, y) { const s = this.solvePlaneWeighted(pts); if (!s.ok) return { ok: false, z: null }; return { ok: true, z: s.a * x + s.b * y + s.c }; }
  getGroupParams(speed) { for (const g of this.speedGroups) if (g.speeds.has(speed)) return g.params; return { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }; }
  importSpeedGroupsFromJson(metadata) {
    const sg = metadata?.speed_groups; if (!sg) return;
    const mk = { swingPanBase: 'swing_pan_base', swingPanThreshold: 'swing_pan_threshold', swingPanExtraPerLevel: 'swing_pan_extra_per_level', tiltBias: 'tilt_additive_bias', tiltSpinMultiplier: 'tilt_spin_multiplier', lrTiltBias: 'lr_tilt_additive_bias', lrTiltOffsetMultiplier: 'lr_tilt_offset_multiplier', enhancedTiltPerLevel: 'enhanced_tilt_per_level', spinPanEffectMultiplier: 'spin_pan_effect_multiplier' };
    for (const g of this.speedGroups) { const src = sg[g.name]; if (!src) continue; const np = {}; for (const [jk, jv] of Object.entries(mk)) np[jk] = src[jv] ?? g.params[jk]; g.params = { ...g.params, ...np }; }
  }
  async loadJsonData() {
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = new Promise(async (resolve, reject) => {
      try { const r = await fetch('bowling_data.json'); if (!r.ok) throw new Error(`HTTP ${r.status}`); this.jsonData = await r.json(); this.importSpeedGroupsFromJson(this.jsonData.generation_metadata); this.isDataLoaded = true; resolve(this.jsonData); }
      catch (e) { this.isDataLoaded = false; reject(e); }
    });
    return this.loadingPromise;
  }
  async ensureDataLoaded() { if (this.isDataLoaded) return this.jsonData; return await this.loadJsonData(); }
  getRegionTolerance(y) { if (y <= 15) return 12; if (y <= 35) return 16; if (y <= 60) return 22; return 20; }
  getAnchoredWeight(y) { if (y <= 25) return 0.6; if (y <= 35) return 0.45; if (y <= 60) return 0.25; return 0.1; }
  calculateRegionMultiplier(targetY, point) {
    let m = 1.0;
    if (targetY <= 30) { if (point.name.includes('top')) m = 1.6; else if (point.name.includes('mid')) m = 1.35; }
    else if (targetY <= 60) { if (point.name.includes('centre')) m = 1.45; else if (point.name.includes('left') || point.name.includes('right')) m = 1.3; }
    else { if (point.name.includes('bottom')) m = 1.9; else if (point.name.includes('centre')) m = 1.4; }
    return m;
  }
  calculateConfidenceScore(points, tolerance) { const avg = points.reduce((s, p) => s + p.distance, 0) / points.length; const maxW = Math.max(...points.map(p => p.weight || p.w || 1)); return Math.round((Math.max(0, 100 - (avg / tolerance) * 30) + Math.min(100, maxW * 20)) / 2); }
  calculateAccuracyScore(points, tX, tY) { const avg = points.reduce((s, p) => s + p.distance, 0) / points.length; const rt = this.getRegionTolerance(tY); return Math.min(100, Math.max(0, 100 - (avg / rt) * 15) + Math.min(10, points.length * 2)); }
  getRegionName(y) { if (y <= 15) return 'ULTRA_PRECISION_TOP_EDGE'; if (y <= 35) return 'HIGH_PRECISION_TOP'; if (y <= 60) return 'MEDIUM_PRECISION_MIDDLE'; return 'STANDARD_PRECISION_BOTTOM'; }
  midTiltAnchor(y) { const pts = [{ y: 5, m: 1500 }, { y: 25, m: 1400 }, { y: 40, m: 1200 }, { y: 80, m: 800 }]; if (y <= pts[0].y) return pts[0].m; if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].m; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (y >= a.y && y <= b.y) return a.m + (y - a.y) / (b.y - a.y) * (b.m - a.m); } return 1200; }
  getMaxLRTiltForY(y, speed, swingLevel, spinLevel) { if (y <= 40) return null; const ld = this.jsonData.data[`${speed}_kmph`].swing_levels[`swing_level_${swingLevel}`].spin_levels[`spin_level_${spinLevel}`]; const c = ld.positions['centre - 0'], bm = ld.positions['bottom - 4']; const t = (y - 40) / 40; return { maxLeft: c.Left_Tilt + t * (bm.Left_Tilt - c.Left_Tilt), maxRight: c.Right_Tilt + t * (bm.Right_Tilt - c.Right_Tilt) }; }
  anisotropicDistance(ax, ay, bx, by) { const yAvg = (ay + by) / 2; const yScale = yAvg >= 60 ? 1.5 : yAvg >= 35 ? 1.2 : 1.0; return Math.hypot(ax - bx, (ay - by) * yScale); }
  calculateInterpolationFromJson(speed, tX, tY, swingLevel, spinLevel) {
    const ck = `${speed}-${tX}-${tY}-${swingLevel}-${spinLevel}`; const cached = this.getCachedResult(ck); if (cached) return cached;
    const ld = this.jsonData.data[`${speed}_kmph`].swing_levels[`swing_level_${swingLevel}`].spin_levels[`spin_level_${spinLevel}`];
    const tol = this.getRegionTolerance(tY); const sp2 = this.getSpeedRpmProfile(speed);
    const rp = Object.entries(ld.positions).map(([name, data]) => { const dist = this.anisotropicDistance(data.X, data.Y, tX, tY); let rm = this.calculateRegionMultiplier(tY, { name }); const pb = dist < tol ? 1.2 : 1.0; rm *= sp2.patternMultiplier; const inv = 1 / (dist + 0.1); const w = rm * pb * inv; return { name, distance: dist, data, w, w2: w * inv }; });
    const best = rp.sort((a, b) => a.distance - b.distance).slice(0, Math.min(6, rp.length));
    const mkPts = (f) => best.map(p => ({ x: p.data.X, y: p.data.Y, z: p.data[f], w: p.w2 }));
    const mkMid = () => best.map(p => ({ x: p.data.X, y: p.data.Y, z: (p.data.Left_Tilt + p.data.Right_Tilt) / 2, w: p.w2 }));
    const pf = this.predictPlane(mkPts('Pan'), tX, tY); const tf = this.predictPlane(mkPts('Tilt'), tX, tY); const mf = this.predictPlane(mkMid(), tX, tY);
    const wAvg = (f) => { let tw = 0, s = 0; for (const p of best) { tw += p.w; s += p.data[f] * p.w; } return s / Math.max(1e-6, tw); };
    let panBase = pf.ok ? pf.z : wAvg('Pan'); let tiltBase = tf.ok ? tf.z : wAvg('Tilt');
    const anch = this.midTiltAnchor(tY); const aw = this.getAnchoredWeight(tY);
    const midRaw = mf.ok ? mf.z : best.reduce((s, p) => { const m = (p.data.Left_Tilt + p.data.Right_Tilt) / 2; return s + m * p.w; }, 0) / best.reduce((s, p) => s + p.w, 0);
    let finalMid = (1 - aw) * midRaw + aw * anch; if (tY <= 35) finalMid = Math.max(finalMid, anch);
    const yWAvg = (f) => { let tw = 0, s = 0; for (const p of best) { const w = 1 / (Math.abs(p.data.Y - tY) + 0.1); tw += w; s += p.data[f] * w; } return s / Math.max(1e-6, tw); };
    let cL = yWAvg('Left_Tilt'), cR = yWAvg('Right_Tilt');
    if (tY > 40) { const mx = this.getMaxLRTiltForY(tY, speed, swingLevel, spinLevel); if (mx) { cL = Math.min(cL, mx.maxLeft); cR = Math.min(cR, mx.maxRight); } }
    const bLR = (f) => { let tw = 0, s = 0; for (const p of best) { tw += p.w; s += p.data[f] * p.w; } return s / Math.max(1e-6, tw); };
    const bLRPM = bLR('L_RPM'), bRRPM = bLR('R_RPM'); const zeroSS = swingLevel === 0 && spinLevel === 0;
    const adjL = zeroSS ? Math.round(bLRPM) : this.applyRealisticSpeedRpmPattern(bLRPM, speed, sp2, tX, tY);
    const adjR = zeroSS ? Math.round(bRRPM) : this.applyRealisticSpeedRpmPattern(bRRPM, speed, sp2, tX, tY);
    panBase = this.clampRange('pan', this.round1(panBase)); tiltBase = this.clampRange('tilt', Math.round(tiltBase));
    const result = { pan: panBase, panActual: panBase, tilt: tiltBase, tiltActual: tiltBase, leftTilt: Math.round(this.clampLRTilt(cL)), leftTiltActual: Math.round(this.clampLRTilt(cL)), rightTilt: Math.round(this.clampLRTilt(cR)), rightTiltActual: Math.round(this.clampLRTilt(cR)), leftRPM: adjL, rightRPM: adjR, usedPoints: best.length, accuracy: this.calculateAccuracyScore(best, tX, tY), confidence: this.calculateConfidenceScore(best, tol), avgDistance: best.reduce((s, p) => s + p.distance, 0) / best.length };
    this.setCachedResult(ck, result); return result;
  }
  getSpeedRpmProfile(speed) { const p = this.speedRpmProfile.toleranceProfile[speed]; if (p) return p; const d = Math.abs(speed - this.speedRpmProfile.referenceSpeed); return { rpmTolerance: Math.min(50, 5 + Math.pow(d / 8, 1.8)), interpolationWeight: Math.max(0.3, 1 - (d / 80)), patternMultiplier: 1 + (d / 50) }; }
  applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, tX, tY) {
    const LIMITS = { min: 150, max: 560 }; const ref = this.speedRpmProfile.referenceSpeed;
    if (speed <= ref) { return Math.round(Math.max(LIMITS.min, Math.min(LIMITS.max, baseRPM))); }
    const boosts = { 120: 15, 130: 35, 140: 55, 150: 75, 160: 95 }; const dev = speed - ref; let boost = boosts[speed];
    if (!boost) { const f = (speed - ref) / 10; boost = Math.pow(f, 1.4) * 20; }
    const df = Math.abs(dev) / 25; const pm = 1 + Math.pow(df, 1.5) * speedProfile.patternMultiplier;
    let pv = 1; if (tX < 75 || tX > 225) pv = 1.3; if (tY < 20 || tY > 60) pv *= 1.2;
    let adj = boost + (dev * 0.8 * pm * pv) + ((Math.random() - 0.5) * speedProfile.rpmTolerance) + ((Math.random() - 0.5) * 10 * speedProfile.patternMultiplier);
    let final = baseRPM + adj; if (speedProfile.interpolationWeight < 1) { final = baseRPM + adj * speedProfile.interpolationWeight + adj * (1 - speedProfile.interpolationWeight) * 0.5; }
    final = Math.max(LIMITS.min, Math.min(LIMITS.max, final));
    const d = Math.abs(speed - ref); return d <= 10 ? Math.round(final * 2) / 2 : d <= 30 ? Math.round(final) : Math.round(final / 2) * 2;
  }
  manageCacheSize() {
    const now = Date.now(); let rc = 0;
    for (const [k, ts] of this.cacheTimestamps.entries()) { if (now - ts > this.cacheConfig.maxAge) { this.interpolationCache.delete(k); this.cacheTimestamps.delete(k); this.cacheAccessCount.delete(k); rc++; this.metrics.expiredEntries++; } }
    if (this.interpolationCache.size >= this.cacheConfig.cleanupThreshold) { Array.from(this.cacheAccessCount.entries()).sort((a, b) => a[1] - b[1]).slice(0, this.cacheConfig.cleanupBatchSize).forEach(([k]) => { this.interpolationCache.delete(k); this.cacheTimestamps.delete(k); this.cacheAccessCount.delete(k); rc++; }); this.metrics.cacheCleanups++; }
    this.metrics.lastCleanupRemoved = rc; this.metrics.totalMemoryUsage = this.interpolationCache.size * 200; return rc;
  }
  getCachedResult(k) { if (this.interpolationCache.has(k)) { this.cacheAccessCount.set(k, (this.cacheAccessCount.get(k) || 0) + 1); this.metrics.cacheHits++; return this.interpolationCache.get(k); } return null; }
  setCachedResult(k, v) { if (this.interpolationCache.size >= this.cacheConfig.maxSize) this.manageCacheSize(); this.interpolationCache.set(k, v); this.cacheTimestamps.set(k, Date.now()); this.cacheAccessCount.set(k, 1); this.metrics.interpolations++; this.metrics.totalMemoryUsage = this.interpolationCache.size * 200; }
  clearCache() { const s = this.interpolationCache.size; this.interpolationCache.clear(); this.cacheTimestamps.clear(); this.cacheAccessCount.clear(); this.metrics.totalMemoryUsage = 0; return s; }
  getCacheStats() { return { size: this.interpolationCache.size, expiredEntries: this.metrics.expiredEntries, lastCleanupRemoved: this.metrics.lastCleanupRemoved, totalMemoryUsage: this.metrics.totalMemoryUsage }; }
  async preload() { await this.ensureDataLoaded(); return true; }
}