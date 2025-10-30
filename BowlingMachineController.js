class BowlingMachineController {
  constructor() {
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    // Conservative cache configuration
    this.cacheConfig = {
      maxSize: 5000,
      cleanupThreshold: 4500,
      cleanupBatchSize: 1000,
      maxAge: 3600000,
    };

    // Accuracy zones
    this.accuracyZones = {
      ULTRA_PRECISION: { yMin: 5, yMax: 15, tolerance: 12 },
      HIGH_PRECISION: { yMin: 15, yMax: 35, tolerance: 16 },
      MEDIUM_PRECISION: { yMin: 35, yMax: 60, tolerance: 22 },
      STANDARD_PRECISION: { yMin: 60, yMax: 80, tolerance: 20 },
    };

    // Speed-dependent RPM tolerance profile
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
        160: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 }
      }
    };

    // Safety limits
    this.safety = {
      leftRightTilt: { min: 400, max: 2700 },
      pan: { min: 2500, max: 3500 },
      tilt: { min: 500, max: 3900 },
    };

    // Speed groups with shared knobs (defaults = neutral; will import from JSON)
    this.speedGroups = [
      { name: 'G1_60_70',   speeds: new Set([60, 70]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G2_80',      speeds: new Set([80]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G3_90_100',  speeds: new Set([90, 100]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G4_110_120', speeds: new Set([110, 120]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G5_130_140', speeds: new Set([130, 140]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G6_150_160', speeds: new Set([150, 160]),
        params: { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
    ];

    // Caches
    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheAccessCount = new Map();

    // Metrics
    this.metrics = {
      cacheHits: 0,
      interpolations: 0,
      exactMatches: 0,
      cacheCleanups: 0,
      expiredEntries: 0,
      totalMemoryUsage: 0,
    };

    this.loadJsonData();
  }

  // Utility
  round1(n) { return Math.round(n * 10) / 10; }

  clampRange(key, v) {
    const r = this.safety[key];
    return Math.max(r.min, Math.min(r.max, v));
  }

  clampLRTilt(v) {
    const r = this.safety.leftRightTilt;
    return Math.max(r.min, Math.min(r.max, v));
  }

  // Speed-group helpers
  getGroupParams(speed) {
    for (const g of this.speedGroups) if (g.speeds.has(speed)) return g.params;
    return { swingPanBase: 0, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 };
  }

  setGroupParams(groupName, newParams) {
    const g = this.speedGroups.find(x => x.name === groupName);
    if (!g) return false;
    g.params = { ...g.params, ...newParams };
    return true;
  }

  // Import generator speed-group params (maps JSON -> controller fields)
  importSpeedGroupsFromJson(metadata) {
    const sg = metadata?.speed_groups;
    if (!sg) return;

    const mapKeys = {
      swingPanBase: 'swing_pan_base',
      swingPanThreshold: 'swing_pan_threshold',
      swingPanExtraPerLevel: 'swing_pan_extra_per_level',
      tiltBias: 'tilt_additive_bias',
      tiltSpinMultiplier: 'tilt_spin_multiplier',
      lrTiltBias: 'lr_tilt_additive_bias',
    };

    for (const g of this.speedGroups) {
      const src = sg[g.name];
      if (!src) continue;
      const newParams = {
        swingPanBase: src[mapKeys.swingPanBase] ?? g.params.swingPanBase,
        swingPanThreshold: src[mapKeys.swingPanThreshold] ?? g.params.swingPanThreshold,
        swingPanExtraPerLevel: src[mapKeys.swingPanExtraPerLevel] ?? g.params.swingPanExtraPerLevel,
        tiltBias: src[mapKeys.tiltBias] ?? g.params.tiltBias,
        tiltSpinMultiplier: src[mapKeys.tiltSpinMultiplier] ?? g.params.tiltSpinMultiplier,
        lrTiltBias: src[mapKeys.lrTiltBias] ?? g.params.lrTiltBias,
      };
      this.setGroupParams(g.name, newParams);
    }
  }

  applyPanSwingOverlay(pan, swingLevel, p) {
    // ΔPan_swing = s * (b + max(0, |s|-T)*E)
    const a = Math.abs(swingLevel);
    let base = p.swingPanBase;
    if (a >= p.swingPanThreshold) base += (a - p.swingPanThreshold) * p.swingPanExtraPerLevel;
    const out = pan + (swingLevel * base);
    return this.clampRange('pan', out);
  }

  applyLowSpeedTiltOverlay(tilt, spinLevel, p) {
    const spinAdj = spinLevel === 0 ? 0 : (p.tiltSpinMultiplier - 1) * 5 * spinLevel;
    const out = tilt + p.tiltBias + spinAdj;
    return this.clampRange('tilt', out);
  }

  applyLRTiltOverlay(left, right, p) {
    const bias = p.lrTiltBias || 0;
    return {
      left: this.clampLRTilt(left + bias),
      right: this.clampLRTilt(right + bias),
    };
  }

  // Load JSON
  async loadJsonData() {
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = new Promise(async (resolve, reject) => {
      try {
        const response = await fetch("bowling_data.json");
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        this.jsonData = await response.json();
        // Import generator speed-group params for overlays
        this.importSpeedGroupsFromJson(this.jsonData.generation_metadata);
        this.isDataLoaded = true;
        console.log("JSON data loaded successfully:", this.jsonData.generation_metadata, this.speedGroups);
        resolve(this.jsonData);
      } catch (error) {
        console.error("Error loading JSON data:", error);
        this.isDataLoaded = false;
        reject(error);
      }
    });

    return this.loadingPromise;
  }

  async ensureDataLoaded() {
    if (this.isDataLoaded) return this.jsonData;
    return await this.loadJsonData();
  }

  getSpeedRpmProfile(speed) {
    const profile = this.speedRpmProfile.toleranceProfile[speed];
    if (profile) return profile;

    const referenceSpeed = this.speedRpmProfile.referenceSpeed;
    const distanceFromReference = Math.abs(speed - referenceSpeed);

    const rpmTolerance = 5 + Math.pow(distanceFromReference / 8, 1.8);
    const interpolationWeight = Math.max(0.3, 1.0 - (distanceFromReference / 80));
    const patternMultiplier = 1.0 + (distanceFromReference / 50);

    return {
      rpmTolerance: Math.min(50, rpmTolerance),
      interpolationWeight,
      patternMultiplier
    };
  }

  // Cache management
  manageCacheSize() {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.cacheConfig.maxAge) {
        this.interpolationCache.delete(key);
        this.cacheTimestamps.delete(key);
        this.cacheAccessCount.delete(key);
        removedCount++;
        this.metrics.expiredEntries++;
      }
    }

    if (this.interpolationCache.size >= this.cacheConfig.cleanupThreshold) {
      const sortedByUsage = Array.from(this.cacheAccessCount.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.cacheConfig.cleanupBatchSize);

      sortedByUsage.forEach(([key]) => {
        this.interpolationCache.delete(key);
        this.cacheTimestamps.delete(key);
        this.cacheAccessCount.delete(key);
        removedCount++;
      });

      this.metrics.cacheCleanups++;
    }

    this.metrics.totalMemoryUsage = this.interpolationCache.size * 200;
    return removedCount;
  }

  getRegionTolerance(y) {
    if (y <= 15) return 12;
    if (y <= 35) return 16;
    if (y <= 60) return 22;
    return 20;
  }

  calculateRegionMultiplier(targetY, point) {
    let m = 1.0;
    if (targetY <= 30) {
      if (point.name.includes("top")) m = 1.6;
      else if (point.name.includes("mid")) m = 1.35;
    } else if (targetY <= 60) {
      if (point.name.includes("centre")) m = 1.45;
      else if (point.name.includes("left") || point.name.includes("right")) m = 1.3;
    } else {
      if (point.name.includes("bottom")) m = 1.9;
      else if (point.name.includes("centre")) m = 1.4;
    }
    return m;
  }

  calculateConfidenceScore(points, tolerance) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const maxWeight = Math.max(...points.map((p) => p.weight));
    const distanceScore = Math.max(0, 100 - (avgDistance / tolerance) * 30);
    const weightScore = Math.min(100, maxWeight * 20);
    return Math.round((distanceScore + weightScore) / 2);
  }

  calculateAccuracyScore(points, targetX, targetY) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const regionTolerance = this.getRegionTolerance(targetY);
    const baseAccuracy = Math.max(0, 100 - (avgDistance / regionTolerance) * 15);
    const pointBonus = Math.min(10, points.length * 2);
    return Math.min(100, baseAccuracy + pointBonus);
  }

  getRegionName(y) {
    if (y <= 15) return "ULTRA_PRECISION_TOP_EDGE";
    if (y <= 35) return "HIGH_PRECISION_TOP";
    if (y <= 60) return "MEDIUM_PRECISION_MIDDLE";
    return "STANDARD_PRECISION_BOTTOM";
  }

  // Piecewise-linear mid tilt anchor from Y
  midTiltAnchor(y) {
    const pts = [
      { y: 5,  m: 1500 },
      { y: 25, m: 1400 },
      { y: 40, m: 1200 },
      { y: 80, m: 800  },
    ];
    if (y <= pts[0].y) return pts[0].m;
    if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].m;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (y >= a.y && y <= b.y) {
        const t = (y - a.y) / (b.y - a.y);
        return a.m + t * (b.m - a.m);
      }
    }
    return 1200;
  }

  // Anisotropic distance
  anisotropicDistance(ax, ay, bx, by) {
    const yAvg = (ay + by) / 2;
    const yScale = yAvg >= 60 ? 1.5 : (yAvg >= 35 ? 1.2 : 1.0);
    const dx = ax - bx;
    const dy = (ay - by) * yScale;
    return Math.hypot(dx, dy);
  }

  // L/R from mid using ±20 per spin level
  lrFromMid(mid, spinLevel) {
    const step = 20;
    const delta = step * Math.abs(spinLevel);
    if (spinLevel > 0) return { left: mid + delta, right: mid - delta };
    if (spinLevel < 0) return { left: mid - delta, right: mid + delta };
    return { left: mid, right: mid };
  }

  // Interpolation
  calculateInterpolationFromJson(speed, targetX, targetY, swingLevel, spinLevel) {
    const cacheKey = `${speed}-${targetX}-${targetY}-${swingLevel}-${spinLevel}`;

    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) return cachedResult;

    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;
    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];

    const tolerance = this.getRegionTolerance(targetY);
    const positions = levelData.positions;

    const speedProfile = this.getSpeedRpmProfile(speed);

    const relevantPoints = Object.entries(positions).map(
      ([positionName, positionData]) => {
        const distance = this.anisotropicDistance(
          positionData.X, positionData.Y, targetX, targetY
        );

        let regionMultiplier = this.calculateRegionMultiplier(targetY, { name: positionName });
        let proximityBonus = distance < tolerance ? 1.2 : 1.0;
        regionMultiplier *= speedProfile.patternMultiplier;

        return {
          name: positionName,
          distance,
          weight: (regionMultiplier * proximityBonus) / (distance + 0.5),
          isRelevant: distance <= tolerance * 2.0,
          data: positionData,
        };
      }
    );

    const pointCount = Math.min(6, relevantPoints.length);
    const bestPoints = relevantPoints.sort((a, b) => a.distance - b.distance).slice(0, pointCount);

    let totalWeight = 0;
    const sums = {
      pan: 0, panActual: 0, tilt: 0, tiltActual: 0,
      midLR: 0, midLRActual: 0,
      leftRPM: 0, rightRPM: 0,
    };

    bestPoints.forEach((point) => {
      const w = 1.0 / (point.distance + 0.1);
      totalWeight += w;

      const mid = (point.data.Left_Tilt + point.data.Right_Tilt) / 2;
      const midAct = (point.data.Left_Tilt_Actual + point.data.Right_Tilt_Actual) / 2;

      sums.pan += point.data.Pan * w;
      sums.panActual += point.data.Pan_actual * w;
      sums.tilt += point.data.Tilt * w;
      sums.tiltActual += point.data.Tilt_actual * w;
      sums.midLR += mid * w;
      sums.midLRActual += midAct * w;
      sums.leftRPM += point.data.L_RPM * w;
      sums.rightRPM += point.data.R_RPM * w;
    });

    const weightedMid = sums.midLR / totalWeight;
    const anchoredMid = this.midTiltAnchor(targetY);
    const downBias = targetY >= 60 ? 0.7 : (targetY >= 35 ? 0.4 : 0.2);
    const finalMid = (1 - downBias) * weightedMid + downBias * anchoredMid;

    // Compose LR from anchored mid with spin-only separation
    let { left: calcLeft, right: calcRight } = this.lrFromMid(finalMid, spinLevel);

    // Apply LR bias equally to both and clamp
    const p = this.getGroupParams(speed);
    ({ left: calcLeft, right: calcRight } = this.applyLRTiltOverlay(calcLeft, calcRight, p));

    const baseLeftRPM = sums.leftRPM / totalWeight;
    const baseRightRPM = sums.rightRPM / totalWeight;

    const speedProfileOut = this.getSpeedRpmProfile(speed);
    const zeroSS = swingLevel === 0 && spinLevel === 0;
    const adjustedLeftRPM = zeroSS
      ? Math.round(baseLeftRPM)
      : this.applyRealisticSpeedRpmPattern(baseLeftRPM, speed, speedProfileOut, targetX, targetY);
    const adjustedRightRPM = zeroSS
      ? Math.round(baseRightRPM)
      : this.applyRealisticSpeedRpmPattern(baseRightRPM, speed, speedProfileOut, targetX, targetY);

    // Base outputs (before overlays)
    let panOut   = this.round1(sums.pan / totalWeight);
    let panAct   = this.round1(sums.panActual / totalWeight);
    let tiltOut  = Math.round(sums.tilt / totalWeight);
    let tiltAct  = Math.round(sums.tiltActual / totalWeight);

    // Apply group overlays to pan/tilt
    panOut  = this.applyPanSwingOverlay(panOut,  swingLevel, p);
    panAct  = this.applyPanSwingOverlay(panAct,  swingLevel, p);
    tiltOut = Math.round(this.applyLowSpeedTiltOverlay(tiltOut, spinLevel, p));
    tiltAct = Math.round(this.applyLowSpeedTiltOverlay(tiltAct, spinLevel, p));

    const result = {
      pan: panOut,
      panActual: panAct,
      tilt: tiltOut,
      tiltActual: tiltAct,
      leftTilt: Math.round(calcLeft),
      leftTiltActual: Math.round((sums.midLRActual / totalWeight) + (calcLeft - finalMid)),
      rightTilt: Math.round(calcRight),
      rightTiltActual: Math.round((sums.midLRActual / totalWeight) + (calcRight - finalMid)),
      leftRPM: adjustedLeftRPM,
      rightRPM: adjustedRightRPM,
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, this.getRegionTolerance(targetY)),
      avgDistance: bestPoints.reduce((sum, p) => sum + p.distance, 0) / bestPoints.length,
      speedProfile: speedProfileOut,
      rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
    };

    this.setCachedResult(cacheKey, result);
    return result;
  }

  // RPM pattern (unchanged except for <=110 guard)
  applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, targetX, targetY) {
    const SAFETY_LIMITS = { min: 150, max: 550 };
    const referenceSpeed = this.speedRpmProfile.referenceSpeed;

    if (speed <= referenceSpeed) {
      let finalRPM = baseRPM;
      finalRPM = Math.max(SAFETY_LIMITS.min, Math.min(SAFETY_LIMITS.max, finalRPM));
      return Math.round(finalRPM);
    }

    let rpmAdjustment = 0;

    const highSpeedBoost = {
      120: 15, 130: 35, 140: 55, 150: 75, 160: 95
    };

    const speedDeviation = speed - referenceSpeed;
    let speedBoost = highSpeedBoost[speed];
    if (!speedBoost) {
      const boostFactor = (speed - referenceSpeed) / 10;
      speedBoost = Math.pow(boostFactor, 1.4) * 20;
    }

    const deviationFactor = Math.abs(speedDeviation) / 25;
    const patternMultiplier = 1 + Math.pow(deviationFactor, 1.5) * speedProfile.patternMultiplier;

    let positionVariance = 1.0;
    if (targetX < 75 || targetX > 225) positionVariance = 1.3;
    if (targetY < 20 || targetY > 60) positionVariance *= 1.2;

    rpmAdjustment = speedBoost + (speedDeviation * 0.8 * patternMultiplier * positionVariance);

    const toleranceVariance = (Math.random() - 0.5) * speedProfile.rpmTolerance;
    rpmAdjustment += toleranceVariance;

    const patternNoise = (Math.random() - 0.5) * 10 * speedProfile.patternMultiplier;
    rpmAdjustment += patternNoise;

    let finalRPM = baseRPM + rpmAdjustment;

    if (speedProfile.interpolationWeight < 1.0) {
      const confidenceAdjustment = rpmAdjustment * speedProfile.interpolationWeight;
      const variancePreservation = rpmAdjustment * (1 - speedProfile.interpolationWeight) * 0.5;
      finalRPM = baseRPM + confidenceAdjustment + variancePreservation;
    }

    finalRPM = Math.max(SAFETY_LIMITS.min, Math.min(SAFETY_LIMITS.max, finalRPM));

    const distanceFromReference = Math.abs(speed - referenceSpeed);
    if (distanceFromReference <= 10) {
      return Math.round(finalRPM * 2) / 2;
    } else if (distanceFromReference <= 30) {
      return Math.round(finalRPM);
    } else {
      return Math.round(finalRPM / 2) * 2;
    }
  }

  // Main entry
  async getMachineConfig(speed, x, y, swingLevel, spinLevel) {
    // Validation
    if (
      !Number.isFinite(speed) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(swingLevel) ||
      !Number.isFinite(spinLevel)
    ) {
      return { error: `Invalid input parameters. Speed: ${speed}, X: ${x}, Y: ${y}, Swing: ${swingLevel}, Spin: ${spinLevel}` };
    }

    if (x < 0 || x > 300 || y < 5 || y > 80) {
      return { error: `Coordinates out of bounds. X: ${x} (0-300), Y: ${y} (5-80)` };
    }

    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5) {
      return { error: `Levels out of bounds. Swing: ${swingLevel} (-5 to +5), Spin: ${spinLevel} (-5 to +5)` };
    }

    try {
      await this.ensureDataLoaded();
    } catch (error) {
      return { error: `Failed to load data: ${error.message}` };
    }

    if (!this.jsonData.data[`${speed}_kmph`]) {
      const availableSpeeds = Object.keys(this.jsonData.data).map(key => key.replace('_kmph', '')).join(", ");
      return { error: `Speed ${speed} km/h not supported. Available: ${availableSpeeds}` };
    }

    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;

    if (!speedData.swing_levels[swingKey]) {
      return { error: `Swing level ${swingLevel} not supported` };
    }
    if (!speedData.swing_levels[swingKey].spin_levels[spinKey]) {
      return { error: `Spin level ${spinLevel} not supported` };
    }

    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];

    // Nearest position
    const positions = levelData.positions;
    let closestPosition = null;
    let minDistance = Infinity;

    for (const [positionName, positionData] of Object.entries(positions)) {
      const distance = Math.sqrt(
        Math.pow(positionData.X - x, 2) + Math.pow(positionData.Y - y, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestPosition = { name: positionName, data: positionData };
      }
    }

    const speedProfile = this.getSpeedRpmProfile(speed);
    const exactMatchThreshold = speed === 110 ? 3 : 5;

    if (minDistance < exactMatchThreshold) {
      this.metrics.exactMatches++;

      // Zero swing/spin preserves dataset RPMs
      const zeroSS = swingLevel === 0 && spinLevel === 0;
      const adjustedLeftRPM = zeroSS
        ? Math.round(closestPosition.data.L_RPM)
        : this.applyRealisticSpeedRpmPattern(closestPosition.data.L_RPM, speed, speedProfile, x, y);
      const adjustedRightRPM = zeroSS
        ? Math.round(closestPosition.data.R_RPM)
        : this.applyRealisticSpeedRpmPattern(closestPosition.data.R_RPM, speed, speedProfile, x, y);

      // Compose calibrated L/R even for exact to ensure swing-only L=R if data drifts
      const anchoredMid = this.midTiltAnchor(y);
      const swingOnly = spinLevel === 0;
      let leftTilt = Math.round(closestPosition.data.Left_Tilt);
      let rightTilt = Math.round(closestPosition.data.Right_Tilt);
      if (swingOnly) {
        leftTilt = rightTilt = Math.round(anchoredMid);
      }

      // Group overlays
      const p = this.getGroupParams(speed);
      let panOut   = this.round1(closestPosition.data.Pan);
      let panAct   = this.round1(closestPosition.data.Pan_actual);
      let tiltOut  = Math.round(closestPosition.data.Tilt);
      let tiltAct  = Math.round(closestPosition.data.Tilt_actual);
      panOut  = this.applyPanSwingOverlay(panOut,  swingLevel, p);
      panAct  = this.applyPanSwingOverlay(panAct,  swingLevel, p);
      tiltOut = Math.round(this.applyLowSpeedTiltOverlay(tiltOut, spinLevel, p));
      tiltAct = Math.round(this.applyLowSpeedTiltOverlay(tiltAct, spinLevel, p));

      // Apply LR tilt bias equally and clamp AFTER anchoring to reflect bias
      ({ left: leftTilt, right: rightTilt } = this.applyLRTiltOverlay(leftTilt, rightTilt, p));

      return {
        speed, swingLevel, spinLevel,
        coordinates: { x, y },
        machineSettings: {
          pan: panOut,
          panActual: panAct,
          tilt: tiltOut,
          tiltActual: tiltAct,
          leftTilt,
          leftTiltActual: leftTilt,
          rightTilt,
          rightTiltActual: rightTilt,
          leftRPM: adjustedLeftRPM,
          rightRPM: adjustedRightRPM,
        },
        matchType: "exact",
        referencePoint: closestPosition.name,
        accuracy: 100,
        confidence: 100,
        distance: minDistance,
        speedProfile,
        rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
      };
    }

    const interpolated = this.calculateInterpolationFromJson(speed, x, y, swingLevel, spinLevel);

    return {
      speed, swingLevel, spinLevel,
      coordinates: { x, y },
      machineSettings: {
        pan: interpolated.pan,
        panActual: interpolated.panActual,
        tilt: interpolated.tilt,
        tiltActual: interpolated.tiltActual,
        leftTilt: interpolated.leftTilt,
        leftTiltActual: interpolated.leftTiltActual,
        rightTilt: interpolated.rightTilt,
        rightTiltActual: interpolated.rightTiltActual,
        leftRPM: interpolated.leftRPM,
        rightRPM: interpolated.rightRPM,
      },
      matchType: "interpolated",
      interpolationData: {
        usedPoints: interpolated.usedPoints,
        accuracy: Math.round(interpolated.accuracy),
        confidence: interpolated.confidence,
        region: this.getRegionName(y),
        tolerance: this.getRegionTolerance(y),
        avgDistance: Math.round(interpolated.avgDistance * 10) / 10,
        speedProfile: interpolated.speedProfile,
        rpmVariance: interpolated.rpmVariance,
      },
    };
  }

  // Metrics/maintenance and other helpers remain unchanged ...
}
