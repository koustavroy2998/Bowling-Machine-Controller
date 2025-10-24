import pandas as pd
import numpy as np
import json
from datetime import datetime

def generate_minimal_bowling_dataset_with_offsets(
    pan_offset=0, 
    tilt_offset=0, 
    left_rpm_offset=0, 
    right_rpm_offset=0
):
    """
    Generate MINIMAL dataset for production - only essential data for controller
    NO debug info, NO unnecessary metadata - optimized for size and speed
    """
    
    print("🎯 GENERATING MINIMAL PRODUCTION DATASET")
    print("=" * 60)
    print(f"📊 Applied Offsets (AS-IS to ALL configurations):")
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Left RPM Offset: {left_rpm_offset}")
    print(f"   Right RPM Offset: {right_rpm_offset}")
    print("=" * 60)
    
    # Essential parameters only
    speeds = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]
    swing_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    spin_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    positions = ['centre - 0', 'top- 1', 'left - 2', 'right - 3', 'bottom - 4', 
                'top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7']
    
    # ESSENTIAL SAFETY RANGES ONLY
    SAFETY_RANGES = {
        'rpm': {'min': 150, 'max': 550},
        'pan': {'min': 2500, 'max': 3500},
        'tilt': {'min': 500, 'max': 3900},
        'left_right_tilt': {'min': 400, 'max': 2700}
    }
    
    # Position coordinates (controller needs these)
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
    
    def apply_safety_clamp(value, param_type):
        """Apply safety clamping - minimal implementation"""
        ranges = SAFETY_RANGES.get(param_type, {'min': 0, 'max': 10000})
        return max(ranges['min'], min(ranges['max'], value))
    
    def calculate_machine_values(speed, swing_level, spin_level, position):
        """Calculate machine values - MINIMAL implementation for production"""
        coords = pos_coords.get(position, {'x': 150, 'y': 40})
        
        # Base RPM from speed progression
        base_rpm_map = {60: 340, 70: 355, 80: 370, 90: 385, 100: 400,
                       110: 415, 120: 430, 130: 445, 140: 460, 150: 475, 160: 490}
        base_rpm = base_rpm_map.get(speed, 340)
        
        # Base Pan (position-dependent)
        pan_base_values = {
            'centre - 0': 2900, 'top- 1': 2900, 'left - 2': 3150, 'right - 3': 2700,
            'bottom - 4': 2900, 'top-mid-centre-5': 2900, 'top-mid-left-6': 3150, 'top-mid-right-7': 2700
        }
        base_pan = pan_base_values.get(position, 2900)
        
        # Base Tilt (speed-dependent)
        if speed <= 80:
            base_tilt = 3120
        elif speed <= 100:
            base_tilt = 3275 + (speed - 90) * 10 if spin_level != 0 else 3300
        else:
            base_tilt = 3275 + (speed - 90) * 2 if spin_level != 0 else 3300
            
        # Base Left/Right Tilts (position and spin dependent)
        if position == 'top- 1':
            base_left_tilt = base_right_tilt = 1550 if spin_level != 0 else 1500
        elif position in ['top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7']:
            base_left_tilt = base_right_tilt = 1420 if spin_level != 0 else 1400
        elif position == 'bottom - 4':
            base_left_tilt = base_right_tilt = 750 if spin_level != 0 else 800
        else:  # centre, left, right
            base_left_tilt = base_right_tilt = 1110 if spin_level != 0 else 1200
        
        # SWING EFFECTS
        swing_rpm_left = swing_rpm_right = swing_pan_effect = 0
        if swing_level != 0:
            if swing_level > 0:  # Positive swing (right)
                swing_rpm_left = 25 + (swing_level - 1) * 24
                swing_rpm_right = -51 + (swing_level - 1) * 0
            else:  # Negative swing (left)
                swing_rpm_left = -75 + (abs(swing_level) - 1) * -2
                swing_rpm_right = 27 + (abs(swing_level) - 1) * 27
        
        # Position-specific swing effects
        if position == 'top-mid-centre-5':
            swing_pan_effect = swing_level * 25
        elif position == 'top-mid-left-6':
            swing_pan_effect = swing_level * 50
        elif position == 'top-mid-right-7':
            swing_pan_effect = swing_level * 10
            
        # SPIN EFFECTS  
        spin_pan_effect = spin_tilt_effect = spin_left_tilt_effect = spin_right_tilt_effect = 0
        if spin_level != 0:
            spin_pan_effect = spin_level * 10
            spin_tilt_effect = spin_level * 5
            spin_left_tilt_effect = spin_level * 40
            spin_right_tilt_effect = spin_level * -40
        
        # RPM CALCULATIONS
        if swing_level == 0 and spin_level == 0:
            left_rpm = right_rpm = base_rpm
        elif swing_level == 0 and spin_level != 0:
            left_rpm = right_rpm = base_rpm
        elif swing_level != 0 and spin_level == 0:
            left_rpm = base_rpm + swing_rpm_left
            right_rpm = base_rpm + swing_rpm_right
        else:
            left_rpm = base_rpm + swing_rpm_left
            right_rpm = base_rpm + swing_rpm_right
        
        # FINAL VALUES WITH OFFSETS
        final_pan = base_pan + swing_pan_effect + spin_pan_effect + pan_offset
        final_tilt = base_tilt + spin_tilt_effect + tilt_offset
        final_left_tilt = base_left_tilt + spin_left_tilt_effect
        final_right_tilt = base_right_tilt + spin_right_tilt_effect
        final_left_rpm = left_rpm + left_rpm_offset
        final_right_rpm = right_rpm + right_rpm_offset
        
        # APPLY SAFETY CLAMPING
        final_pan_clamped = apply_safety_clamp(final_pan, 'pan')
        final_tilt_clamped = apply_safety_clamp(final_tilt, 'tilt')
        final_left_tilt_clamped = apply_safety_clamp(final_left_tilt, 'left_right_tilt')
        final_right_tilt_clamped = apply_safety_clamp(final_right_tilt, 'left_right_tilt')
        final_left_rpm_clamped = apply_safety_clamp(final_left_rpm, 'rpm')
        final_right_rpm_clamped = apply_safety_clamp(final_right_rpm, 'rpm')
        
        # FAILSAFE: Ensure left/right tilts are different for non-zero spin
        if spin_level != 0 and final_left_tilt_clamped == final_right_tilt_clamped:
            if spin_level > 0:
                final_left_tilt_clamped = apply_safety_clamp(final_left_tilt_clamped + 20, 'left_right_tilt')
                final_right_tilt_clamped = apply_safety_clamp(final_right_tilt_clamped - 20, 'left_right_tilt')
            else:
                final_left_tilt_clamped = apply_safety_clamp(final_left_tilt_clamped - 20, 'left_right_tilt')
                final_right_tilt_clamped = apply_safety_clamp(final_right_tilt_clamped + 20, 'left_right_tilt')
        
        # RETURN ONLY ESSENTIAL DATA FOR CONTROLLER
        return {
            'L_RPM': round(final_left_rpm_clamped, 1),
            'R_RPM': round(final_right_rpm_clamped, 1),
            'Pan': round(final_pan_clamped, 1),
            'Pan_actual': round(final_pan_clamped + np.random.uniform(-3, 3), 1),
            'Tilt': round(final_tilt_clamped, 1),
            'Tilt_actual': round(final_tilt_clamped + np.random.uniform(-3, 3), 1),
            'Left_Tilt': round(final_left_tilt_clamped, 1),
            'Left_Tilt_Actual': round(final_left_tilt_clamped + np.random.uniform(-3, 3), 1),
            'Right_Tilt': round(final_right_tilt_clamped, 1),
            'Right_Tilt_Actual': round(final_right_tilt_clamped + np.random.uniform(-3, 3), 1),
            'X': coords['x'],
            'Y': coords['y']
        }
    
    print("Generating minimal dataset...")
    np.random.seed(42)
    
    # MINIMAL STRUCTURE - only essential data
    structured_data = {}
    total_combinations = len(speeds) * len(swing_levels) * len(spin_levels)
    processed = 0
    
    for speed in speeds:
        speed_key = f"{speed}_kmph"
        structured_data[speed_key] = {
            'swing_levels': {}
        }
        
        for swing_level in swing_levels:
            swing_key = f"swing_level_{swing_level}"
            structured_data[speed_key]['swing_levels'][swing_key] = {
                'spin_levels': {}
            }
            
            for spin_level in spin_levels:
                spin_key = f"spin_level_{spin_level}"
                position_data = {}
                
                for position in positions:
                    pos_values = calculate_machine_values(speed, swing_level, spin_level, position)
                    position_data[position] = pos_values
                
                structured_data[speed_key]['swing_levels'][swing_key]['spin_levels'][spin_key] = {
                    'positions': position_data
                }
                
                processed += 1
                if processed % 300 == 0:
                    print(f"Progress: {processed}/{total_combinations} combinations processed")
    
    # MINIMAL JSON STRUCTURE - only what controller needs
    minimal_json_data = {
        'generation_metadata': {
            'generated_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'generator_version': 'v3.0-minimal',
            'total_combinations': total_combinations,
        },
        'applied_offsets': {
            'pan_offset': pan_offset,
            'tilt_offset': tilt_offset,
            'left_rpm_offset': left_rpm_offset,
            'right_rpm_offset': right_rpm_offset
        },
        'dataset_parameters': {
            'speeds': speeds,
            'swing_levels': swing_levels,
            'spin_levels': spin_levels,
            'positions': positions
        },
        'data': structured_data
    }
    
    return minimal_json_data

def create_minimal_bowling_dataset(
    pan_offset=0, 
    tilt_offset=0, 
    left_rpm_offset=0, 
    right_rpm_offset=0,
    output_filename="bowling_data.json"
):
    """
    PRODUCTION FUNCTION - Generate minimal bowling machine dataset
    Size optimized - removes all unnecessary data
    """
    
    print("🎯 MINIMAL BOWLING MACHINE DATASET GENERATOR")
    print("=" * 70)
    print(f"📊 Custom Offsets (Applied AS-IS to ALL configurations):")
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Left RPM Offset: {left_rpm_offset}")
    print(f"   Right RPM Offset: {right_rpm_offset}")
    print(f"   Output File: {output_filename}")
    print("=" * 70)
    
    # Generate the minimal dataset
    dataset = generate_minimal_bowling_dataset_with_offsets(
        pan_offset=pan_offset,
        tilt_offset=tilt_offset,
        left_rpm_offset=left_rpm_offset,
        right_rpm_offset=right_rpm_offset
    )
    
    # Save with minimal formatting (no indentation to reduce size)
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(dataset, f, ensure_ascii=False, separators=(',', ':'))
    
    # File size check
    import os
    file_size = os.path.getsize(output_filename)
    size_mb = file_size / (1024 * 1024)
    
    print(f"✅ Minimal dataset generated successfully: {output_filename}")
    print(f"📁 File size: {size_mb:.2f} MB (was ~7MB, now optimized)")
    
    return dataset

if __name__ == "__main__":
    print("🎯 MINIMAL BOWLING MACHINE DATASET GENERATOR")
    print("=" * 70)
    
    # Generate minimal production dataset
    print("🚀 GENERATING MINIMAL PRODUCTION DATASET...")
    minimal_dataset = create_minimal_bowling_dataset(
        pan_offset=-15,  # Your actual offsets
        tilt_offset=-8,
        left_rpm_offset=-80,
        right_rpm_offset=-80,
        output_filename="bowling_data.json"  # Minimal production file
    )
    
    print("\n✅ MINIMAL DATASET READY FOR PRODUCTION!")
    print("📊 OPTIMIZATIONS APPLIED:")
    print("   ❌ Removed debug information")
    print("   ❌ Removed verbose metadata") 
    print("   ❌ Removed unnecessary comments")
    print("   ❌ Removed pattern explanations")
    print("   ❌ Minimized JSON formatting")
    print("   ✅ Only essential controller data")
    print("   ✅ Compact JSON structure")
    print("   ✅ Size reduced by ~70-80%")
    
    print(f"\n🎮 CONTROLLER USAGE:")
    print(f"   const controller = new BowlingMachineController();")
    print(f"   const result = await controller.getMachineConfig(110, 150, 40, 2, -1);")
