import json
import numpy as np
from datetime import datetime



def generate_minimal_bowling_dataset_with_rpm_map(
    speed_rpm_map,
    pan_offset=0,
    tilt_offset=0,
    output_filename="bowling_data.json"
):
    """
    Generates the machine-setting dataset for BLR lane 1 (new machine).

    Value for each (speed, swing, spin, position):
      Pan        = measured centre pan + line offset + swing pan offset + pan_offset
      Tilt       = measured centre tilt + length offset + SWING_TILT_BOOST (swing != 0) + tilt_offset
      Left Tilt  = speed base + spin * SPIN_LR_TILT_PER_LEVEL
      Right Tilt = speed base - spin * SPIN_LR_TILT_PER_LEVEL
      L/R RPM    = speed RPM +/- swing * SWING_RPM_PER_LEVEL, plus SPIN_RPM_BOOST on both wheels
    Everything is clamped to SAFETY_RANGES.
    """

    print("🎯 GENERATING BOWLING DATASET (BLR lane 1, new machine)")
    print("=" * 60)
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Output File: {output_filename}")
    print(f"   RPM Map: {speed_rpm_map}")
    print("=" * 60)

    speeds = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150]  # 160 removed: not measured on the new machine
    swing_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    spin_levels  = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    positions = [
        'centre - 0', 'top- 1', 'left - 2', 'right - 3', 'bottom - 4',
        'top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7'
    ]

    # NEW MACHINE (measured): pan 50 (left edge) - 900 (right edge), tilt 50 (60 kph good length) - 950 safety limit (10 m at 110 kph measured 850),
    # L/R tilt 100-950 (straight-ball base 500, 600 at 60/70 kph; only spin moves it). RPM limit unchanged.
    SAFETY_RANGES = {
        'rpm': {'min': 150, 'max': 700},
        'pan': {'min': 50, 'max': 900},
        'tilt': {'min': 50, 'max': 950},
        'left_right_tilt': {'min': 100, 'max': 950}
    }

    # Spin ON. With spin off (False) every spin level produces the spin-0 settings and L/R tilt never moves.
    SPIN_ENABLED = True

    # Spin -> L/R tilt: each spin level moves L/R tilt by this much from the speed's base.
    # Negative spin lowers Left and raises Right (spin -1: 400/600, -2: 300/700 at base 500);
    # positive spin is the reverse (spin +1: 600/400). Only spin moves L/R tilt.
    SPIN_LR_TILT_PER_LEVEL = 100

    # Spin -> RPM: added to BOTH wheels, by |spin level| (flat per band: levels 1-2 +10, levels 3-5 +20)
    SPIN_RPM_BOOST = {0: 0, 1: 10, 2: 10, 3: 20, 4: 20, 5: 20}

    # Swing: each level moves one wheel up and the other down by this many RPM
    SWING_RPM_PER_LEVEL = 20

    # Swing -> pan: this much per swing level, opposite to the swing's sign
    # (level -1: +80 ... -5: +400; level +1: -80 ... +5: -400)
    SWING_PAN_PER_LEVEL = 150

    # Swing -> machine tilt: flat amount added for any non-zero swing level (swing balls pitched slightly fuller)
    SWING_TILT_BOOST = 25

    pos_coords = {
        'centre - 0': {'x': 150, 'y': 40},
        'top- 1': {'x': 150, 'y': 5},
        'left - 2': {'x': 0, 'y': 40},
        'right - 3': {'x': 300, 'y': 40},
        'bottom - 4': {'x': 150, 'y': 80},
        'top-mid-centre-5': {'x': 150, 'y': 25},
        'top-mid-left-6': {'x': 0, 'y': 25},
        'top-mid-right-7': {'x': 300, 'y': 25}
    }

    # Measured on the new machine: good length, stump line (centre X150/Y40), straight ball
    CENTRE_BASELINES = {
        60:  {'Pan': 500.0, 'Tilt': 50.0,  'Left_Tilt': 600.0, 'Right_Tilt': 600.0},
        70:  {'Pan': 500.0, 'Tilt': 50.0,  'Left_Tilt': 600.0, 'Right_Tilt': 600.0},
        80:  {'Pan': 500.0, 'Tilt': 200.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        90:  {'Pan': 500.0, 'Tilt': 300.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        100: {'Pan': 500.0, 'Tilt': 400.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        110: {'Pan': 500.0, 'Tilt': 525.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        120: {'Pan': 500.0, 'Tilt': 550.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        130: {'Pan': 500.0, 'Tilt': 650.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        140: {'Pan': 500.0, 'Tilt': 700.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
        150: {'Pan': 500.0, 'Tilt': 750.0, 'Left_Tilt': 500.0, 'Right_Tilt': 500.0},
    }

    # Line: measured at 110 kph good length -> left edge (X0) pan 50, stump (X150) 500, right edge (X300) 900
    pan_delta = {
        'centre - 0': 0,
        'top- 1': 0,
        'left - 2': -450,
        'right - 3': +400,
        'bottom - 4': 0,
        'top-mid-centre-5': 0,
        'top-mid-left-6': -450,
        'top-mid-right-7': +400
    }

    # Length: measured at 110 kph stump line -> 1 m (Y8) tilt 150, good (Y40) 525, 10 m (Y80) 850.
    # Y = 8 x metres from the batsman. Piecewise-linear through the three measured points
    # (11.72 tilt per Y unit fuller than good, 8.125 per Y unit shorter). Same offsets applied at every speed.
    tilt_delta = {
        'centre - 0': 0,
        'top- 1': -410.2,          # Y5  (0.6 m) - extrapolated slightly past the 1 m measurement
        'left - 2': 0,
        'right - 3': 0,
        'bottom - 4': +325.0,      # Y80 (10 m)
        'top-mid-centre-5': -175.8,  # Y25 (3.1 m)
        'top-mid-left-6': -175.8,
        'top-mid-right-7': -175.8
    }

    def clamp(v, key):
        r = SAFETY_RANGES[key]
        return max(r['min'], min(r['max'], v))

    def calculate_machine_values(speed, swing_level, spin_level, position):
        if not SPIN_ENABLED:
            spin_level = 0
        coords = pos_coords[position]
        c = CENTRE_BASELINES[speed]
        base_rpm = float(speed_rpm_map[speed])

        # Pan: line offset, then swing (negative swing adds, positive swing subtracts)
        final_pan = c['Pan'] + pan_delta[position] - swing_level * SWING_PAN_PER_LEVEL + pan_offset

        # Machine tilt: length offset, plus a flat boost for swing balls
        final_tilt = c['Tilt'] + tilt_delta[position] + tilt_offset
        if swing_level != 0:
            final_tilt += SWING_TILT_BOOST

        # L/R tilt: constant per speed; only spin moves it.
        # Negative spin: Left down, Right up. Positive spin: Left up, Right down.
        final_left_tilt = c['Left_Tilt'] + spin_level * SPIN_LR_TILT_PER_LEVEL
        final_right_tilt = c['Right_Tilt'] - spin_level * SPIN_LR_TILT_PER_LEVEL

        # RPM: swing splits the wheels (positive swing: Left up, Right down), average stays at base;
        # spin adds the same boost to both wheels
        swing_rpm = swing_level * SWING_RPM_PER_LEVEL
        spin_rpm_boost = SPIN_RPM_BOOST[abs(spin_level)]
        left_rpm = base_rpm + swing_rpm + spin_rpm_boost
        right_rpm = base_rpm - swing_rpm + spin_rpm_boost

        # clamps
        final_pan = clamp(final_pan, 'pan')
        final_tilt = clamp(final_tilt, 'tilt')
        final_left_tilt = clamp(final_left_tilt, 'left_right_tilt')
        final_right_tilt = clamp(final_right_tilt, 'left_right_tilt')
        final_left_rpm = clamp(left_rpm, 'rpm')
        final_right_rpm = clamp(right_rpm, 'rpm')

        return {
            'L_RPM': round(final_left_rpm, 1),
            'R_RPM': round(final_right_rpm, 1),
            'Pan': round(final_pan, 1),
            'Pan_actual': round(final_pan + np.random.uniform(-1.85, 1.85), 1),
            'Tilt': round(final_tilt, 1),
            'Tilt_actual': round(final_tilt + np.random.uniform(-0.71, 0.71), 1),
            'Left_Tilt': round(final_left_tilt, 1),
            'Left_Tilt_Actual': round(final_left_tilt, 1),   # no noise: L/R tilt is exact
            'Right_Tilt': round(final_right_tilt, 1),
            'Right_Tilt_Actual': round(final_right_tilt, 1),  # no noise: L/R tilt is exact
            'X': coords['x'],
            'Y': coords['y']
        }

    print("Generating dataset...")
    np.random.seed(42)

    structured_data = {}
    total_combinations = len(speeds) * len(swing_levels) * len(spin_levels)
    processed = 0

    for speed in speeds:
        speed_key = f"{speed}_kmph"
        structured_data[speed_key] = {'swing_levels': {}}
        for swing_level in swing_levels:
            swing_key = f"swing_level_{swing_level}"
            structured_data[speed_key]['swing_levels'][swing_key] = {'spin_levels': {}}
            for spin_level in spin_levels:
                spin_key = f"spin_level_{spin_level}"
                position_data = {}
                for position in positions:
                    position_data[position] = calculate_machine_values(speed, swing_level, spin_level, position)
                structured_data[speed_key]['swing_levels'][swing_key]['spin_levels'][spin_key] = {
                    'positions': position_data
                }
                processed += 1
                if processed % 300 == 0:
                    print(f"Progress: {processed}/{total_combinations} combinations")

    minimal_json_data = {
        'generation_metadata': {
            'generated_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'generator_version': 'v6-new-machine',
            'total_combinations': total_combinations,
            'safety_ranges': SAFETY_RANGES,
            'spin_enabled': SPIN_ENABLED,
            'spin_lr_tilt_per_level': SPIN_LR_TILT_PER_LEVEL,
            'spin_rpm_boost': SPIN_RPM_BOOST,
            'swing_rpm_per_level': SWING_RPM_PER_LEVEL,
            'swing_pan_per_level': SWING_PAN_PER_LEVEL,
            'swing_tilt_boost': SWING_TILT_BOOST
        },
        'applied_settings': {
            'rpm_map_default_used': False,
            'pan_offset': pan_offset,
            'tilt_offset': tilt_offset,
        },
        'dataset_parameters': {
            'speeds': speeds,
            'swing_levels': swing_levels,
            'spin_levels': spin_levels,
            'positions': positions
        },
        'data': structured_data
    }

    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(minimal_json_data, f, ensure_ascii=False, separators=(',', ':'))

    import os
    size_mb = os.path.getsize(output_filename) / (1024 * 1024)
    print(f"✅ Dataset generated: {output_filename} | Size: {size_mb:.2f} MB")

    return minimal_json_data



if __name__ == "__main__":
    # Measured on the new machine (straight ball, centre): left RPM = right RPM
    machine_rpm_map = {
        60: 269.0,
        70: 320.0,
        80: 340.0,
        90: 360.0,
        100: 380.0,
        110: 400.0,
        120: 430.0,
        130: 465.0,
        140: 500.0,
        150: 530.0,
    }

    result = generate_minimal_bowling_dataset_with_rpm_map(
        speed_rpm_map=machine_rpm_map,
        pan_offset=0,
        tilt_offset=0,
        output_filename="pitch-mapping.json"
    )

    # Verification test
    print("\n" + "="*60)
    print("VERIFICATION: Speed 110, Swing +3, Spin 0, Centre")
    test_data = result['data']['110_kmph']['swing_levels']['swing_level_3']['spin_levels']['spin_level_0']['positions']['centre - 0']
    avg_rpm = (test_data['L_RPM'] + test_data['R_RPM']) / 2
    print(f"Base RPM: {machine_rpm_map[110]}")
    print(f"L_RPM: {test_data['L_RPM']}, R_RPM: {test_data['R_RPM']}")
    print(f"Average: {avg_rpm} (should equal {machine_rpm_map[110]})")
    print(f"Pan: {test_data['Pan']} (should show swing effect)")
    print("="*60)
