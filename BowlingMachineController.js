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

    // Accuracy zones (slightly tightened)
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

    // Safety limits for tilt composition
    this.safety = {
      leftRightTilt: { min: 400, max: 2700 },
    };

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

  // Utility: round to 1 decimal (preserve subtle pan variance)
  round1(n) { return Math.round(n * 10) / 10; }

  // Clamp helper for LR tilt
  clampLRTilt(v) {
    const r = this.safety.leftRightTilt;
    return Math.max(r.min, Math.min(r.max, v));
  }

  // Load JSON
  async loadJsonData() {
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = new Promise(async (resolve, reject) => {
      try {
        const response = await fetch("bowling_data.json");
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        this.jsonData = await response.json();
        this.isDataLoaded = true;
        console.log("JSON data loaded successfully:", this.jsonData.generation_metadata);
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

  getCachedResult(cacheKey) {
    if (this.interpolationCache.has(cacheKey)) {
      const currentCount = this.cacheAccessCount.get(cacheKey) || 0;
      this.cacheAccessCount.set(cacheKey, currentCount + 1);
      this.metrics.cacheHits++;
      return this.interpolationCache.get(cacheKey);
    }
    return null;
  }

  setCachedResult(cacheKey, result) {
    if (this.interpolationCache.size >= this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }
    const now = Date.now();
    this.interpolationCache.set(cacheKey, result);
    this.cacheTimestamps.set(cacheKey, now);
    this.cacheAccessCount.set(cacheKey, 1);
    this.metrics.interpolations++;
  }

  // Region tolerance (tightened at bottom)
  getRegionTolerance(y) {
    if (y <= 15) return 12;
    if (y <= 35) return 16;
    if (y <= 60) return 22;
    return 20;
  }

  // Region multiplier (bias bottom references when Y is low vs high)
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

  // Confidence
  calculateConfidenceScore(points, tolerance) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const maxWeight = Math.max(...points.map((p) => p.weight));
    const distanceScore = Math.max(0, 100 - (avgDistance / tolerance) * 30);
    const weightScore = Math.min(100, maxWeight * 20);
    return Math.round((distanceScore + weightScore) / 2);
  }

  // Accuracy
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
      { y: 5,  m: 1500 }, // top
      { y: 25, m: 1400 }, // top-mid
      { y: 40, m: 1200 }, // centre/mid
      { y: 80, m: 800  }, // bottom
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

  // Anisotropic distance: heavier Y penalty at bottom
  anisotropicDistance(ax, ay, bx, by) {
    const yAvg = (ay + by) / 2;
    const yScale = yAvg >= 60 ? 1.5 : (yAvg >= 35 ? 1.2 : 1.0);
    const dx = ax - bx;
    const dy = (ay - by) * yScale;
    return Math.hypot(dx, dy);
  }

  // L/R from mid using ±20 per spin level; swing does not split L/R
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
    calcLeft = this.clampLRTilt(calcLeft);
    calcRight = this.clampLRTilt(calcRight);

    const baseLeftRPM = sums.leftRPM / totalWeight;
    const baseRightRPM = sums.rightRPM / totalWeight;

    const zeroSS = swingLevel === 0 && spinLevel === 0;
    const adjustedLeftRPM = zeroSS
      ? Math.round(baseLeftRPM)
      : this.applyRealisticSpeedRpmPattern(baseLeftRPM, speed, speedProfile, targetX, targetY);
    const adjustedRightRPM = zeroSS
      ? Math.round(baseRightRPM)
      : this.applyRealisticSpeedRpmPattern(baseRightRPM, speed, speedProfile, targetX, targetY);

    const result = {
      pan: this.round1(sums.pan / totalWeight),
      panActual: this.round1(sums.panActual / totalWeight),
      tilt: Math.round(sums.tilt / totalWeight),
      tiltActual: Math.round(sums.tiltActual / totalWeight),

      // Overwrite with calibrated L/R
      leftTilt: Math.round(calcLeft),
      leftTiltActual: Math.round((sums.midLRActual / totalWeight) + (calcLeft - finalMid)),
      rightTilt: Math.round(calcRight),
      rightTiltActual: Math.round((sums.midLRActual / totalWeight) + (calcRight - finalMid)),

      leftRPM: adjustedLeftRPM,
      rightRPM: adjustedRightRPM,
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, tolerance),
      avgDistance: bestPoints.reduce((sum, p) => sum + p.distance, 0) / bestPoints.length,
      speedProfile,
      rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
    };

    this.setCachedResult(cacheKey, result);
    return result;
  }

  // RPM pattern (unchanged behavior except for <=110 guard)
  applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, targetX, targetY) {
    const SAFETY_LIMITS = { min: 150, max: 550 };
    const referenceSpeed = this.speedRpmProfile.referenceSpeed;

    // Do not alter baselines for speeds <= reference
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

      return {
        speed, swingLevel, spinLevel,
        coordinates: { x, y },
        machineSettings: {
          pan: this.round1(closestPosition.data.Pan),
          panActual: this.round1(closestPosition.data.Pan_actual),
          tilt: Math.round(closestPosition.data.Tilt),
          tiltActual: Math.round(closestPosition.data.Tilt_actual),
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

  // Metrics/maintenance
  getPerformanceMetrics() {
    const cacheSize = this.interpolationCache.size;
    const totalOperations =
      this.metrics.cacheHits +
      this.metrics.interpolations +
      this.metrics.exactMatches;

    const topEntries = Array.from(this.cacheAccessCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      cache: {
        size: cacheSize,
        maxSize: this.cacheConfig.maxSize,
        utilizationRate: ((cacheSize / this.cacheConfig.maxSize) * 100).toFixed(2),
        memoryEstimate: `${(this.metrics.totalMemoryUsage / 1024).toFixed(2)} KB`,
        hitRate: totalOperations > 0
          ? ((this.metrics.cacheHits / totalOperations) * 100).toFixed(2)
          : 0,
        cleanupOperations: this.metrics.cacheCleanups,
        expiredEntries: this.metrics.expiredEntries,
        topAccessedEntries: topEntries,
      },
      performance: {
        exactMatchRate: totalOperations > 0
          ? ((this.metrics.exactMatches / totalOperations) * 100).toFixed(2)
          : 0,
        totalOperations,
        ...this.metrics,
      },
      speedProfile: this.speedRpmProfile,
    };
  }

  cleanupCache(forced = false) {
    const beforeSize = this.interpolationCache.size;

    if (forced) {
      this.interpolationCache.clear();
      this.cacheTimestamps.clear();
      this.cacheAccessCount.clear();
      this.metrics.totalMemoryUsage = 0;
    } else {
      this.manageCacheSize();
    }

    const afterSize = this.interpolationCache.size;
    return {
      removedEntries: beforeSize - afterSize,
      currentSize: afterSize,
      memoryFreed: `${(((beforeSize - afterSize) * 200) / 1024).toFixed(2)} KB`,
    };
  }

  getCacheHealth() {
    const currentSize = this.interpolationCache.size;
    const utilizationRate = (currentSize / this.cacheConfig.maxSize) * 100;

    let status = "HEALTHY";
    if (utilizationRate > 90) status = "CRITICAL";
    else if (utilizationRate > 75) status = "WARNING";
    else if (utilizationRate > 50) status = "GOOD";

    return {
      status,
      utilizationRate: utilizationRate.toFixed(2),
      recommendedAction: this.getRecommendedAction(utilizationRate),
    };
  }

  getRecommendedAction(utilization) {
    if (utilization > 90) return "Immediate cleanup recommended";
    if (utilization > 75) return "Consider cleanup soon";
    if (utilization > 50) return "Monitor usage";
    return "Cache performing optimally";
  }

  getSupportedConfigurations() {
    if (!this.isDataLoaded) return { error: "Data not loaded yet" };

    return {
      speeds: this.jsonData.dataset_parameters.speeds,
      swingLevels: this.jsonData.dataset_parameters.swing_levels,
      spinLevels: this.jsonData.dataset_parameters.spin_levels,
      positions: this.jsonData.dataset_parameters.positions,
      totalCombinations: this.jsonData.generation_metadata.total_combinations,
      appliedOffsets: this.jsonData.applied_offsets || this.jsonData.applied_settings,
    };
  }

  getCacheConfig() {
    return { ...this.cacheConfig };
  }

  setCacheConfig(newConfig) {
    this.cacheConfig = { ...this.cacheConfig, ...newConfig };
    if (this.interpolationCache.size > this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }
    return this.getCacheConfig();
  }
}
