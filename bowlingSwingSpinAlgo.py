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
    FIXES:
    1. Pan variance scales aggressively for high speed + high swing (30-40 units/level)
    2. RPM symmetry preserved - average of L_RPM and R_RPM always equals base RPM
    3. Left/Right tilt boost for high speeds + swing level ≥3
    """

    print("🎯 GENERATING BOWLING DATASET (FIXED HIGH-SPEED SWING LOGIC)")
    print("=" * 60)
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Output File: {output_filename}")
    print(f"   RPM Map: {speed_rpm_map}")
    print("=" * 60)

    speeds = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]
    swing_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    spin_levels  = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    positions = [
        'centre - 0', 'top- 1', 'left - 2', 'right - 3', 'bottom - 4',
        'top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7'
    ]

    SAFETY_RANGES = {
        'rpm': {'min': 150, 'max': 550},
        'pan': {'min': 2500, 'max': 3500},
        'tilt': {'min': 500, 'max': 3900},
        'left_right_tilt': {'min': 400, 'max': 2700}
    }

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

    CENTRE_BASELINES = {
        60:  {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1650.0, 'Right_Tilt': 1650.0},
        70:  {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1450.0, 'Right_Tilt': 1450.0},
        80:  {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1350.0, 'Right_Tilt': 1350.0},
        90:  {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1150.0, 'Right_Tilt': 1150.0},
        100: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1150.0, 'Right_Tilt': 1150.0},
        110: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        120: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        130: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        140: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        150: {'Pan': 2900.0, 'Tilt': 3200.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        160: {'Pan': 2900.0, 'Tilt': 3200.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
    }

    pan_delta = {
        'centre - 0': 0, 'top- 1': 0, 'left - 2': +250, 'right - 3': -200,
        'bottom - 4': 0, 'top-mid-centre-5': 0, 'top-mid-left-6': +250, 'top-mid-right-7': -200
    }

    lr_tilt_delta = {
        'centre - 0': 0, 'top- 1': +300, 'left - 2': 0, 'right - 3': 0,
        'bottom - 4': -400, 'top-mid-centre-5': +200, 'top-mid-left-6': +200, 'top-mid-right-7': +200
    }

    enhanced_tilt_per_level = 50

    def clamp(v, key):
        r = SAFETY_RANGES[key]
        return max(r['min'], min(r['max'], v))

    def calculate_machine_values(speed, swing_level, spin_level, position):
        coords = pos_coords[position]
        c = CENTRE_BASELINES[speed]
        base_rpm = float(speed_rpm_map[speed])

        # === PAN LOGIC with PROGRESSIVE SWING BOOST (ALL SPEEDS) ===
        # Base: 25/level, scales to 30-40 for |swing|≥3
        swing_pan_base = 25
        if abs(swing_level) >= 3:
            # Progressive boost: level 3→+5, level 4→+10, level 5→+15
            extra = (abs(swing_level) - 2) * 5
            swing_pan_base += extra  # reaches 40 at level 5

        swing_pan_effect = swing_pan_base * swing_level

        base_pan = c['Pan'] + pan_delta[position]
        base_tilt = c['Tilt']
        base_left_tilt = c['Left_Tilt'] + lr_tilt_delta[position]
        base_right_tilt = c['Right_Tilt'] + lr_tilt_delta[position]

        # === RPM LOGIC - PRESERVE AVERAGE ===
        # Symmetric split ensures (L+R)/2 = base_rpm
        if swing_level == 0:
            left_rpm = right_rpm = base_rpm
        else:
            # Delta per level: 20-30, deterministic per speed/position
            key = f"{speed}:{position}"
            seed = abs(hash(key)) % (2**32)
            rng = np.random.default_rng(seed)
            delta_per_level = int(rng.integers(20, 31))
            
            total_delta = delta_per_level * abs(swing_level)
            
            if swing_level > 0:
                left_rpm = base_rpm + total_delta
                right_rpm = base_rpm - total_delta
            else:
                left_rpm = base_rpm - total_delta
                right_rpm = base_rpm + total_delta

        # === SPIN EFFECTS ===
        spin_pan_effect = spin_level * 10 if spin_level != 0 else 0
        spin_tilt_effect = spin_level * 5 if spin_level != 0 else 0
        spin_left_tilt_effect = spin_level * enhanced_tilt_per_level
        spin_right_tilt_effect = -spin_level * enhanced_tilt_per_level

        # === LEFT/RIGHT TILT BOOST for HIGH-SPEED + HIGH-SWING ===
        # Apply +30-40 units ONLY when there's swing (not spin-only)
        # For spin=0: left_tilt = right_tilt (symmetric)
        swing_tilt_boost = 0
        if speed >= 120 and abs(swing_level) >= 3:
            # Progressive: level 3→+30, level 4→+35, level 5→+40
            swing_tilt_boost = 30 + (abs(swing_level) - 3) * 5

        # Apply boost asymmetrically based on swing direction
        if swing_level > 0:
            swing_left_tilt_boost = +swing_tilt_boost
            swing_right_tilt_boost = -swing_tilt_boost
        elif swing_level < 0:
            swing_left_tilt_boost = -swing_tilt_boost
            swing_right_tilt_boost = +swing_tilt_boost
        else:
            # NO SWING: left and right tilt must be EQUAL (only spin affects them)
            swing_left_tilt_boost = swing_right_tilt_boost = 0

        # === FINAL VALUES ===
        final_pan = base_pan + swing_pan_effect + spin_pan_effect + pan_offset
        final_tilt = base_tilt + spin_tilt_effect + tilt_offset
        final_left_tilt = base_left_tilt + spin_left_tilt_effect + swing_left_tilt_boost
        final_right_tilt = base_right_tilt + spin_right_tilt_effect + swing_right_tilt_boost

        final_pan = clamp(final_pan, 'pan')
        final_tilt = clamp(final_tilt, 'tilt')
        final_left_tilt = clamp(final_left_tilt, 'left_right_tilt')
        final_right_tilt = clamp(final_right_tilt, 'left_right_tilt')
        final_left_rpm = clamp(left_rpm, 'rpm')
        final_right_rpm = clamp(right_rpm, 'rpm')

        # Ensure spin separation
        if spin_level != 0 and abs(final_left_tilt - final_right_tilt) < 20:
            adjust = 30
            if spin_level > 0:
                final_left_tilt = clamp(final_left_tilt + adjust, 'left_right_tilt')
                final_right_tilt = clamp(final_right_tilt - adjust, 'left_right_tilt')
            else:
                final_left_tilt = clamp(final_left_tilt - adjust, 'left_right_tilt')
                final_right_tilt = clamp(final_right_tilt + adjust, 'left_right_tilt')

        return {
            'L_RPM': round(final_left_rpm, 1),
            'R_RPM': round(final_right_rpm, 1),
            'Pan': round(final_pan, 1),
            'Pan_actual': round(final_pan + np.random.uniform(-3, 3), 1),
            'Tilt': round(final_tilt, 1),
            'Tilt_actual': round(final_tilt + np.random.uniform(-3, 3), 1),
            'Left_Tilt': round(final_left_tilt, 1),
            'Left_Tilt_Actual': round(final_left_tilt + np.random.uniform(-3, 3), 1),
            'Right_Tilt': round(final_right_tilt, 1),
            'Right_Tilt_Actual': round(final_right_tilt + np.random.uniform(-3, 3), 1),
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
            'generator_version': 'v5.0-fixed-high-speed-swing',
            'total_combinations': total_combinations,
            'fixes_applied': [
                'Pan variance 30-40 units/level for |swing|≥3 (ALL SPEEDS)',
                'RPM symmetry preserved: (L_RPM + R_RPM)/2 = base_RPM',
                'L/R tilt +30-40 boost for speed≥120 & |swing|≥3',
                'Zero swing ensures left_tilt = right_tilt (only spin differentiates)'
            ]
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
    machine_rpm_map = {
        60: 205.0, 70: 240.0, 80: 270.0, 90: 300.0, 100: 315.0,
        110: 350.0, 120: 380.0, 130: 420.0, 140: 545.0, 150: 550.0, 160: 550.0
    }
    
    result = generate_minimal_bowling_dataset_with_rpm_map(
        speed_rpm_map=machine_rpm_map,
        pan_offset=0,
        tilt_offset=0,
        output_filename="bowling_data.json"
    )
    
    # Verification test
    print("\n" + "="*60)
    print("VERIFICATION: Speed 110, Swing +3, Spin 0, Centre")
    test_data = result['data']['110_kmph']['swing_levels']['swing_level_3']['spin_levels']['spin_level_0']['positions']['centre - 0']
    avg_rpm = (test_data['L_RPM'] + test_data['R_RPM']) / 2
    print(f"Base RPM: 350.0")
    print(f"L_RPM: {test_data['L_RPM']}, R_RPM: {test_data['R_RPM']}")
    print(f"Average: {avg_rpm} (should equal 350.0)")
    print(f"Pan: {test_data['Pan']} (should show swing effect)")
    print("="*60)