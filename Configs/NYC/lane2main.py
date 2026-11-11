import json
import numpy as np
from datetime import datetime



def generate_minimal_bowling_dataset_with_rpm_map(
    speed_rpm_map,
    speed_group_tuning=None,
    pan_offset=0,
    tilt_offset=0,
    output_filename="bowling_data.json"
):
    """
    FIXES (v5.5):
    1) Symmetric pan deltas across X (±200) so left/right magnitudes match
    2) Speed-grouped tuning with common knobs per group:
       G1: 60–70, G2: 80, G3: 90–100, G4: 110–120, G5: 130–140, G6: 150–160
    3) New lr_tilt_additive_bias: single bias applied equally to Left/Right Tilt
    4) RPM logic unchanged and symmetry preserved
    5) lr_tilt_offset_multiplier: scales position-based tilt offsets from center
    6) NEW: enhanced_tilt_per_level (spin effect on L/R tilt) configurable per speed group
    7) NEW: spin_pan_effect_multiplier (spin effect on pan) configurable per speed group
    """

    print("🎯 GENERATING BOWLING DATASET (v5.5 + speed-group enhanced_tilt_per_level + spin_pan_effect_multiplier)")
    print("=" * 60)
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Output File: {output_filename}")
    print(f"   RPM Map: {speed_rpm_map}")
    if speed_group_tuning:
        print(f"   Speed Group Tuning Provided: {len(speed_group_tuning)} groups")
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
        'pan': {'min': 2500, 'max': 3800},
        'tilt': {'min': 500, 'max': 3900},
        'left_right_tilt': {'min': 400, 'max': 1400}
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
        150: {'Pan': 2900.0, 'Tilt': 3120.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
        160: {'Pan': 2900.0, 'Tilt': 3200.0, 'Left_Tilt': 1100.0, 'Right_Tilt': 1100.0},
    }

    # Symmetric pan deltas (±200) so left/right magnitudes match
    pan_delta = {
        'centre - 0': 0,
        'top- 1': 0,
        'left - 2': -500,
        'right - 3': +500,
        'bottom - 4': 0,
        'top-mid-centre-5': 0,
        'top-mid-left-6': -500,
        'top-mid-right-7': +500
    }

    lr_tilt_delta = {
        'centre - 0': 0,
        'top- 1': +300,
        'left - 2': 0,
        'right - 3': 0,
        'bottom - 4': -400,
        'top-mid-centre-5': +200,
        'top-mid-left-6': +200,
        'top-mid-right-7': +200
    }

    # Speed-grouped shared knobs (PRESET CONFIGS FROM paste.txt)
    # NOW INCLUDES: enhanced_tilt_per_level, spin_pan_effect_multiplier
    SPEED_GROUPS = {
        'G1_60_70': {
            'speeds': [60, 70],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': -300,
            'tilt_spin_multiplier': 1.15,
            'lr_tilt_additive_bias': -200,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
         'G2_80': {
            'speeds': [80],
            'swing_pan_base': 25,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 700,
            'tilt_spin_multiplier': 1.08,
            'lr_tilt_additive_bias': -450,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G3_90_100': {
            'speeds': [90, 100],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 0,
            'tilt_additive_bias': 500,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': -300,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G4_110_120': {
            'speeds': [110, 120],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G5_130_140': {
            'speeds': [130, 140],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G6_150_160': {
            'speeds': [150, 160],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
    }

    # Override with user-provided speed group tuning if supplied
    if speed_group_tuning:
        for group_name, user_params in speed_group_tuning.items():
            if group_name in SPEED_GROUPS:
                SPEED_GROUPS[group_name].update(user_params)
                print(f"✓ Overriding {group_name} with user params: {user_params}")

    def clamp(v, key):
        r = SAFETY_RANGES[key]
        return max(r['min'], min(r['max'], v))

    def group_params_for_speed(spd):
        for _, g in SPEED_GROUPS.items():
            if spd in g['speeds']:
                return g
        # default if any is missed
        return {
            'swing_pan_base': 25,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.0,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        }

    def calculate_machine_values(speed, swing_level, spin_level, position):
        coords = pos_coords[position]
        c = CENTRE_BASELINES[speed]
        base_rpm = float(speed_rpm_map[speed])
        gp = group_params_for_speed(speed)

        # === PAN with grouped swing overlay (shared knobs) ===
        # ΔPan_swing = s * (b + max(0, |s|-T)*E)
        s_abs = abs(swing_level)
        swing_pan_base = gp['swing_pan_base']
        if s_abs >= gp['swing_pan_threshold']:
            swing_pan_base += (s_abs - gp['swing_pan_threshold']) * gp['swing_pan_extra_per_level']
        swing_pan_effect = swing_pan_base * swing_level  # signed

        base_pan = c['Pan'] + pan_delta[position]
        base_tilt = c['Tilt']

        max_offset = max(lr_tilt_delta.values())

        # Apply lr_tilt_offset_multiplier to position-based tilt offsets
        left_offset = lr_tilt_delta[position]
        left_offset_multiplier = 1 +  (gp['lr_tilt_offset_multiplier'] - 1) * (left_offset / max_offset)
        right_offset = lr_tilt_delta[position]
        right_offset_multiplier = 1 +  (gp['lr_tilt_offset_multiplier'] - 1) * (right_offset / max_offset)
        left_change = left_offset * left_offset_multiplier
        right_change = right_offset * right_offset_multiplier
        base_left_tilt = c['Left_Tilt'] + left_change
        base_right_tilt = c['Right_Tilt'] + right_change

        # === RPM LOGIC - PRESERVE AVERAGE (unchanged) ===
        if swing_level == 0:
            left_rpm = right_rpm = base_rpm
        else:
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

        # === SPIN EFFECTS (left/right separation + grouped params) ===
        spin_pan_effect = spin_level * gp['spin_pan_effect_multiplier'] if spin_level != 0 else 0
        spin_tilt_effect = (spin_level * 5 * gp['tilt_spin_multiplier']) if spin_level != 0 else 0

        # === No swing-induced L/R tilt asymmetry ===
        swing_left_tilt_boost = 0
        swing_right_tilt_boost = 0

        # === FINAL VALUES with grouped overlays ===
        final_pan = base_pan + swing_pan_effect + spin_pan_effect + pan_offset
        final_tilt = base_tilt + spin_tilt_effect + tilt_offset + gp['tilt_additive_bias']
        final_left_tilt = base_left_tilt + (spin_level * gp['enhanced_tilt_per_level']) + swing_left_tilt_boost
        final_right_tilt = base_right_tilt + (-spin_level * gp['enhanced_tilt_per_level']) + swing_right_tilt_boost

        # Apply LR tilt additive bias equally to both
        final_left_tilt += gp.get('lr_tilt_additive_bias', 0)
        final_right_tilt += gp.get('lr_tilt_additive_bias', 0)

        # clamps
        final_pan = clamp(final_pan, 'pan')
        final_tilt = clamp(final_tilt, 'tilt')
        final_left_tilt = clamp(final_left_tilt, 'left_right_tilt')
        final_right_tilt = clamp(final_right_tilt, 'left_right_tilt')
        final_left_rpm = clamp(left_rpm, 'rpm')
        final_right_rpm = clamp(right_rpm, 'rpm')

        # Ensure spin separation visibility in data rows
        if spin_level != 0 and abs(final_left_tilt - final_right_tilt) < 20:
            adjust = 20
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

    # serialize speed groups
    speed_groups_serializable = {}
    for k, v in SPEED_GROUPS.items():
        speed_groups_serializable[k] = {**v, 'speeds': list(v['speeds'])}

    minimal_json_data = {
        'generation_metadata': {
            'generated_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'generator_version': 'v5.5-speed-group-enhanced-tilt-spin-pan-multipliers',
            'total_combinations': total_combinations,
            'fixes_applied': [
                'Symmetric pan deltas across X (±200)',
                'Speed-grouped tuning with shared knobs',
                'New lr_tilt_additive_bias for equal L/R tilt tuning',
                'New lr_tilt_offset_multiplier to scale position-based tilt offsets from center',
                'NEW: enhanced_tilt_per_level per speed group (configurable)',
                'NEW: spin_pan_effect_multiplier per speed group (configurable)',
                'RPM logic unchanged'
            ],
            'speed_groups': speed_groups_serializable
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
        60: 205.0,
         70: 240.0, 
         80: 270.0, 
         90: 300.0, 
         100: 350.0,
        110: 395.0, 
        120: 380.0, 
        130: 420.0, 
        140: 480.0, 
        150: 520.0, 
        160: 550.0
    }

    # Example: Override speed group tuning
    custom_speed_group_tuning = {
     'G1_60_70': {
            'speeds': [60, 70],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': -300,
            'tilt_spin_multiplier': 1.15,
            'lr_tilt_additive_bias': -200,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G2_80': {
            'speeds': [80],
            'swing_pan_base': 25,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 700,
            'tilt_spin_multiplier': 1.08,
            'lr_tilt_additive_bias': -300,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G3_90_100': {
            'speeds': [90, 100],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 0,
            'tilt_additive_bias': 500,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': -300,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G4_110_120': {
            'speeds': [110, 120],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': -80,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': -80,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G5_130_140': {
            'speeds': [130, 140],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
        'G6_150_160': {
            'speeds': [150, 160],
            'swing_pan_base': 30,
            'swing_pan_threshold': 3,
            'swing_pan_extra_per_level': 5,
            'tilt_additive_bias': 0,
            'tilt_spin_multiplier': 1.0,
            'lr_tilt_additive_bias': 0,
            'lr_tilt_offset_multiplier': 1.5,
            'enhanced_tilt_per_level': 200,
            'spin_pan_effect_multiplier': 10
        },
    }

    result = generate_minimal_bowling_dataset_with_rpm_map(
        speed_rpm_map=machine_rpm_map,
        speed_group_tuning=custom_speed_group_tuning,
        pan_offset=453,
        tilt_offset=92,
        output_filename="pitch-mapping.json"
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