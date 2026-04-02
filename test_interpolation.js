// Thorough test: check L/R tilt, Pan, Tilt interpolation across ALL speeds
// across a grid of x (0-300) and y (5-80) values

const fs = require('fs');

// Load the controller
const controllerCode = fs.readFileSync('BowlingMachineController.js', 'utf-8');
const BowlingMachineController = new Function(controllerCode + '\nreturn BowlingMachineController;')();

const jsonData = JSON.parse(fs.readFileSync('bowling_data.json', 'utf-8'));

const ctrl = new BowlingMachineController();
ctrl.jsonData = jsonData;
ctrl.isDataLoaded = true;

const allSpeeds = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
const swing = 0;
const spin = 0;

const xValues = [0, 30, 75, 100, 150, 200, 220, 244, 270, 300];
const yValues = [5, 15, 25, 30, 40, 50, 60, 70, 80];

let totalLrIssues = 0;
let totalPanIssues = 0;
let totalSpinIssues = 0;
let totalMonoIssues = 0;

for (const speed of allSpeeds) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SPEED: ${speed} kmph`);
  console.log(`${'='.repeat(70)}`);

  // --- L/R TILT X-INVARIANCE ---
  console.log('\n  [L/R Tilt x-invariance] Should be constant across x for same y');
  let speedLrIssues = 0;
  for (const y of yValues) {
    const results = [];
    for (const x of xValues) {
      const r = ctrl.calculateInterpolationFromJson(speed, x, y, swing, spin);
      results.push({ x, leftTilt: r.leftTilt, rightTilt: r.rightTilt });
    }

    const leftTilts = results.map(r => r.leftTilt);
    const rightTilts = results.map(r => r.rightTilt);
    const leftRange = Math.max(...leftTilts) - Math.min(...leftTilts);
    const rightRange = Math.max(...rightTilts) - Math.min(...rightTilts);

    const ok = leftRange <= 30 && rightRange <= 30;
    if (!ok) {
      speedLrIssues++;
      console.log(`    y=${String(y).padStart(2)} | LT range: ${leftRange.toFixed(0).padStart(4)} | RT range: ${rightRange.toFixed(0).padStart(4)} | ISSUE`);
      for (const r of results) {
        console.log(`           x=${String(r.x).padStart(3)}  LT=${r.leftTilt}  RT=${r.rightTilt}`);
      }
    }
  }
  if (speedLrIssues === 0) console.log('    ALL OK');
  totalLrIssues += speedLrIssues;

  // --- PAN MONOTONICITY ---
  console.log('\n  [Pan] Should decrease as x increases');
  let speedPanIssues = 0;
  for (const y of [5, 25, 40, 80]) {
    const results = [];
    for (const x of xValues) {
      const r = ctrl.calculateInterpolationFromJson(speed, x, y, swing, spin);
      results.push({ x, pan: r.pan });
    }
    let monotonic = true;
    for (let i = 1; i < results.length; i++) {
      if (results[i].pan > results[i-1].pan + 5) { monotonic = false; break; }
    }
    if (!monotonic) {
      speedPanIssues++;
      const line = results.map(r => `x=${String(r.x).padStart(3)}:${r.pan}`).join('  ');
      console.log(`    y=${String(y).padStart(2)} | ISSUE | ${line}`);
    }
  }
  if (speedPanIssues === 0) console.log('    ALL OK');
  totalPanIssues += speedPanIssues;

  // --- SPIN SEPARATION ---
  console.log('\n  [Spin] L/R tilt separation');
  let speedSpinIssues = 0;
  for (const spinLevel of [-3, 0, 3]) {
    for (const [x, y] of [[150, 40], [220, 40], [75, 25], [244, 40]]) {
      const r = ctrl.calculateInterpolationFromJson(speed, x, y, swing, spinLevel);
      const diff = r.leftTilt - r.rightTilt;
      const ok = (spinLevel > 0 && diff > 0) || (spinLevel < 0 && diff < 0) || (spinLevel === 0 && Math.abs(diff) < 50);
      if (!ok) {
        speedSpinIssues++;
        console.log(`    Spin=${spinLevel} x=${String(x).padStart(3)} y=${String(y).padStart(2)} | LT=${r.leftTilt} RT=${r.rightTilt} diff=${diff} | ISSUE`);
      }
    }
  }
  if (speedSpinIssues === 0) console.log('    ALL OK');
  totalSpinIssues += speedSpinIssues;

  // --- Y-MONOTONICITY ---
  console.log('\n  [Y-monotonicity] L/R tilt should decrease top→bottom at x=150');
  let speedMonoIssues = 0;
  const yFull = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
  const monoResults = [];
  for (const y of yFull) {
    const r = ctrl.calculateInterpolationFromJson(speed, 150, y, swing, spin);
    monoResults.push({ y, lt: r.leftTilt, rt: r.rightTilt });
  }
  for (let i = 1; i < monoResults.length; i++) {
    const r = monoResults[i];
    const prev = monoResults[i-1];
    const ltDrop = r.lt - prev.lt;
    if (ltDrop > 5) {
      speedMonoIssues++;
      console.log(`    y=${prev.y}→${r.y} | LT: ${prev.lt}→${r.lt} (Δ=+${ltDrop}) | ISSUE`);
    }
  }
  if (speedMonoIssues === 0) console.log('    ALL OK');
  totalMonoIssues += speedMonoIssues;
}

console.log(`\n${'='.repeat(70)}`);
console.log('  GRAND SUMMARY (all speeds)');
console.log(`${'='.repeat(70)}`);
console.log(`  L/R tilt x-invariance issues: ${totalLrIssues}`);
console.log(`  Pan monotonicity issues:      ${totalPanIssues}`);
console.log(`  Spin separation issues:       ${totalSpinIssues}`);
console.log(`  L/R tilt y-monotonicity:      ${totalMonoIssues}`);
console.log(`  TOTAL ISSUES: ${totalLrIssues + totalPanIssues + totalSpinIssues + totalMonoIssues}`);
