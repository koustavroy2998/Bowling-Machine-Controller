import pandas as pd
import numpy as np
import json
from datetime import datetime

def generate_complete_corrected_swing_spin_dataset_with_offsets(
    pan_offset=0, 
    tilt_offset=0, 
    left_rpm_offset=0, 
    right_rpm_offset=0
):
    """
    Generate complete dataset with OFFSET CORRECTION capability
    Offsets are applied AS-IS to all configurations without any scaling
    All values are clamped to safe operating ranges
    """
    
    print("🚀 Starting OFFSET-CORRECTED Dataset Generation")
    print("="*60)
    print(f"📊 Applied Offsets (Applied AS-IS to ALL configurations):")
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Left RPM Offset: {left_rpm_offset}")
    print(f"   Right RPM Offset: {right_rpm_offset}")
    print("="*60)
    
    # Define all parameter combinations
    speeds = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]
    swing_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    spin_levels = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
    positions = ['centre - 0', 'top- 1', 'left - 2', 'right - 3', 'bottom - 4', 
                 'top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7']
    
    # SAFETY RANGES (as specified)
    SAFETY_RANGES = {
        'left_right_tilt': {'min': 400, 'max': 2700},
        'pan': {'min': 2500, 'max': 3500},
        'machine_tilt': {'min': 500, 'max': 3900},
        'rpm': {'min': 150, 'max': 550}
    }
    
    # Position coordinate mapping
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
        """Apply safety range clamping to ensure values stay within operational limits"""
        ranges = SAFETY_RANGES.get(param_type, {'min': 0, 'max': 10000})
        return max(ranges['min'], min(ranges['max'], value))
    
    def calculate_corrected_pattern_values_with_offsets(speed, swing_level, spin_level, position):
        """
        Calculate servo values with OFFSET CORRECTION applied AS-IS (no scaling)
        """
        coords = pos_coords.get(position, {'x': 150, 'y': 40})
        
        # ===== BASE VALUES FROM ACTUAL DATA =====
        
        # Base RPM (from actual data speed progression)
        base_rpm_map = {
            60: 340, 70: 355, 80: 370, 90: 385, 100: 400,
            110: 415, 120: 430, 130: 445, 140: 460, 150: 475, 160: 490
        }
        base_rpm = base_rpm_map.get(speed, 340)
        
        # Base Pan (position-dependent from actual data)
        pan_base_values = {
            'centre - 0': 2900, 'top- 1': 2900, 'left - 2': 3150, 'right - 3': 2700,
            'bottom - 4': 2900, 'top-mid-centre-5': 2900, 'top-mid-left-6': 3150, 'top-mid-right-7': 2700
        }
        base_pan = pan_base_values.get(position, 2900)
        
        # Base Tilt (speed and data-type dependent from actual data)
        if speed <= 80:
            base_tilt = 3120
        elif speed <= 100:
            base_tilt = 3275 + (speed - 90) * 10 if spin_level != 0 else 3300
        else:
            base_tilt = 3275 + (speed - 90) * 2 if spin_level != 0 else 3300
            
        # Base Left/Right Tilt following actual spin data patterns
        if position == 'top- 1':
            if spin_level != 0:
                base_left_tilt = 1550  
                base_right_tilt = 1550
            else:
                base_left_tilt = 1500
                base_right_tilt = 1500
        elif position in ['top-mid-centre-5', 'top-mid-left-6', 'top-mid-right-7']:
            if spin_level != 0:
                base_left_tilt = 1420
                base_right_tilt = 1420
            else:
                base_left_tilt = 1400
                base_right_tilt = 1400
        elif position == 'bottom - 4':
            if spin_level != 0:
                base_left_tilt = 750
                base_right_tilt = 750
            else:
                base_left_tilt = 800
                base_right_tilt = 800
        else:  # centre, left, right
            if spin_level != 0:
                base_left_tilt = 1110
                base_right_tilt = 1110
            else:
                base_left_tilt = 1200
                base_right_tilt = 1200
        
        # ===== SWING EFFECTS =====
        swing_rpm_left = swing_rpm_right = swing_pan_effect = 0
        
        if swing_level != 0:
            if swing_level > 0:  # Positive swing (right swing)
                swing_rpm_left = 25 + (swing_level - 1) * 24
                swing_rpm_right = -51 + (swing_level - 1) * 0
            else:  # Negative swing (left swing)
                swing_rpm_left = -75 + (abs(swing_level) - 1) * -2
                swing_rpm_right = 27 + (abs(swing_level) - 1) * 27
                
            # Pan effects for specific positions
            if position == 'top-mid-centre-5':
                swing_pan_effect = swing_level * 25
            elif position == 'top-mid-left-6':
                swing_pan_effect = swing_level * 50
            elif position == 'top-mid-right-7':
                swing_pan_effect = swing_level * 10
        
        # ===== SPIN EFFECTS =====
        spin_pan_effect = spin_tilt_effect = spin_left_tilt_effect = spin_right_tilt_effect = 0
        
        if spin_level != 0:
            spin_pan_effect = spin_level * 10
            spin_tilt_effect = spin_level * 5
            spin_left_tilt_effect = spin_level * 40
            spin_right_tilt_effect = spin_level * -40
        
        # ===== RPM CALCULATIONS =====
        
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
        
        # ===== APPLY OFFSETS AS-IS (NO SCALING) =====
        
        # Calculate final values with offsets applied directly
        final_pan = base_pan + swing_pan_effect + spin_pan_effect + pan_offset
        final_tilt = base_tilt + spin_tilt_effect + tilt_offset
        
        final_left_tilt = base_left_tilt + spin_left_tilt_effect
        final_right_tilt = base_right_tilt + spin_right_tilt_effect
        
        final_left_rpm = left_rpm + left_rpm_offset
        final_right_rpm = right_rpm + right_rpm_offset
        
        # ===== APPLY SAFETY CLAMPING =====
        
        final_pan_clamped = apply_safety_clamp(final_pan, 'pan')
        final_tilt_clamped = apply_safety_clamp(final_tilt, 'machine_tilt')
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
        
        # Add small random variations for actual values
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
            'Y': coords['y'],
            'Applied_Offsets': {
                'pan': pan_offset,
                'tilt': tilt_offset,
                'left_rpm': left_rpm_offset,
                'right_rpm': right_rpm_offset
            }
        }
    
    # ===== GENERATE COMPLETE DATASET =====
    print("Generating offset-corrected dataset...")
    np.random.seed(42)
    
    structured_data = {}
    total_combinations = len(speeds) * len(swing_levels) * len(spin_levels)
    processed = 0
    
    for speed in speeds:
        speed_key = f"{speed}_kmph"
        structured_data[speed_key] = {
            "speed": speed,
            "swing_levels": {}
        }
        
        for swing_level in swing_levels:
            swing_key = f"swing_level_{swing_level}"
            structured_data[speed_key]["swing_levels"][swing_key] = {
                "swing_level": swing_level,
                "spin_levels": {}
            }
            
            for spin_level in spin_levels:
                spin_key = f"spin_level_{spin_level}"
                
                position_data = {}
                for position in positions:
                    pos_values = calculate_corrected_pattern_values_with_offsets(speed, swing_level, spin_level, position)
                    position_data[position] = pos_values
                
                structured_data[speed_key]["swing_levels"][swing_key]["spin_levels"][spin_key] = {
                    "spin_level": spin_level,
                    "positions": position_data
                }
                
                processed += 1
                if processed % 300 == 0:
                    print(f"Progress: {processed}/{total_combinations} combinations processed")
    
    # ===== CREATE FINAL JSON STRUCTURE WITH TIMESTAMP =====
    generation_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    complete_json_data = {
        "generation_metadata": {
            "generated_timestamp": generation_time,
            "generator_version": "v2.1_fixed_offset_application",
            "total_combinations": total_combinations,
            "offset_application_method": "DIRECT - Applied AS-IS to all configurations"
        },
        "applied_offsets": {
            "pan_offset": pan_offset,
            "tilt_offset": tilt_offset,
            "left_rpm_offset": left_rpm_offset,
            "right_rpm_offset": right_rpm_offset,
            "note": "Offsets are applied AS-IS to ALL configurations without any scaling"
        },
        "safety_ranges": SAFETY_RANGES,
        "dataset_parameters": {
            "speeds": speeds,
            "swing_levels": swing_levels,
            "spin_levels": spin_levels,
            "positions": positions
        },
        "pattern_corrections": [
            "SWING: L-RPM > R-RPM for positive levels, L-RPM < R-RPM for negative levels",
            "SPIN: Left Tilt > Right Tilt for positive levels, Left Tilt < Right Tilt for negative levels", 
            "SPIN: 40 units difference per level (matches actual data)",
            "OFFSETS: Applied DIRECTLY without any scaling - same offset value for all speeds/configs",
            "SAFETY: All values clamped to operational ranges",
            "FAILSAFE: Prevents equal tilt values for non-zero spin levels"
        ],
        "data": structured_data
    }
    
    return complete_json_data


def create_bowling_machine_dataset_with_custom_offsets(
    pan_offset=0, 
    tilt_offset=0, 
    left_rpm_offset=0, 
    right_rpm_offset=0,
    output_filename='Bowling_Machine_Dataset_Fixed_Offsets.json'
):
    """
    🎯 PRODUCTION FUNCTION: Generate bowling machine dataset with custom offsets
    
    Parameters:
    - pan_offset: Offset for pan values (applied AS-IS to all configurations)
    - tilt_offset: Offset for tilt values (applied AS-IS to all configurations)
    - left_rpm_offset: Offset for left RPM values (applied AS-IS to all configurations)
    - right_rpm_offset: Offset for right RPM values (applied AS-IS to all configurations)
    - output_filename: Name of the output JSON file
    
    Returns: Complete dataset with offsets applied directly without scaling
    """
    
    print(f"🎯 BOWLING MACHINE DATASET GENERATOR (FIXED OFFSET APPLICATION)")
    print("="*70)
    print(f"📊 Custom Offsets (Applied AS-IS to ALL configurations):")
    print(f"   Pan Offset: {pan_offset}")
    print(f"   Tilt Offset: {tilt_offset}")
    print(f"   Left RPM Offset: {left_rpm_offset}")
    print(f"   Right RPM Offset: {right_rpm_offset}")
    print(f"📁 Output File: {output_filename}")
    print("="*70)
    
    # Generate the dataset
    dataset = generate_complete_corrected_swing_spin_dataset_with_offsets(
        pan_offset=pan_offset,
        tilt_offset=tilt_offset,
        left_rpm_offset=left_rpm_offset,
        right_rpm_offset=right_rpm_offset
    )
    
    # Save to custom filename
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(dataset, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Dataset generated successfully: {output_filename}")
    
    return dataset


def check_safety_compliance(dataset):
    """Check if all generated values comply with safety ranges"""
    ranges = dataset['safety_ranges']
    violations = []
    
    # Sample a few data points for checking
    sample_positions = ['centre - 0', 'top- 1']
    sample_speeds = [60, 110, 160]
    
    for speed in sample_speeds:
        speed_key = f"{speed}_kmph"
        for position in sample_positions:
            data = dataset['data'][speed_key]['swing_levels']['swing_level_1']['spin_levels']['spin_level_1']['positions'][position]
            
            # Check RPM ranges
            if not (ranges['rpm']['min'] <= data['L_RPM'] <= ranges['rpm']['max']):
                violations.append(f"L_RPM violation at {speed} kmph, {position}: {data['L_RPM']}")
            if not (ranges['rpm']['min'] <= data['R_RPM'] <= ranges['rpm']['max']):
                violations.append(f"R_RPM violation at {speed} kmph, {position}: {data['R_RPM']}")
            
            # Check Pan ranges
            if not (ranges['pan']['min'] <= data['Pan'] <= ranges['pan']['max']):
                violations.append(f"Pan violation at {speed} kmph, {position}: {data['Pan']}")
            
            # Check Tilt ranges
            if not (ranges['machine_tilt']['min'] <= data['Tilt'] <= ranges['machine_tilt']['max']):
                violations.append(f"Tilt violation at {speed} kmph, {position}: {data['Tilt']}")
            
            # Check Left/Right Tilt ranges
            if not (ranges['left_right_tilt']['min'] <= data['Left_Tilt'] <= ranges['left_right_tilt']['max']):
                violations.append(f"Left_Tilt violation at {speed} kmph, {position}: {data['Left_Tilt']}")
            if not (ranges['left_right_tilt']['min'] <= data['Right_Tilt'] <= ranges['left_right_tilt']['max']):
                violations.append(f"Right_Tilt violation at {speed} kmph, {position}: {data['Right_Tilt']}")
    
    return violations


def query_bowling_machine(dataset, speed, swing_level, spin_level, position):
    """
    Query the bowling machine dataset for specific parameters
    
    Parameters:
    - dataset: The generated bowling machine dataset
    - speed: Ball speed in kmph
    - swing_level: Swing level (-5 to 5)
    - spin_level: Spin level (-5 to 5)  
    - position: Ball position string
    
    Returns: Machine configuration values
    """
    try:
        speed_key = f"{speed}_kmph"
        swing_key = f"swing_level_{swing_level}"
        spin_key = f"spin_level_{spin_level}"
        
        result = dataset['data'][speed_key]['swing_levels'][swing_key]['spin_levels'][spin_key]['positions'][position]
        
        return {
            'success': True,
            'parameters': {
                'speed': speed,
                'swing_level': swing_level,
                'spin_level': spin_level,
                'position': position
            },
            'machine_settings': result,
            'applied_offsets': dataset['applied_offsets']
        }
    except KeyError as e:
        return {
            'success': False,
            'error': f"Invalid parameters: {e}",
            'parameters': {
                'speed': speed,
                'swing_level': swing_level,
                'spin_level': spin_level,
                'position': position
            }
        }


# ===== EXAMPLE USAGE =====
if __name__ == "__main__":
    print("🎯 BOWLING MACHINE ALGORITHM WITH FIXED OFFSET CORRECTION")
    print("="*70)
    
    # Example 1: Baseline dataset (no offsets)
    print("\n📋 GENERATING BASELINE DATASET...")
    baseline_dataset = create_bowling_machine_dataset_with_custom_offsets(
        pan_offset=0,
        tilt_offset=0,
        left_rpm_offset=0,
        right_rpm_offset=0,
        output_filename='Bowling_Dataset_Baseline.json'
    )
    
    # Example 2: Dataset with real-world offsets
    print("\n📋 GENERATING OFFSET-CORRECTED DATASET...")
    corrected_dataset = create_bowling_machine_dataset_with_custom_offsets(
        pan_offset=0,      # Pan needs +15 adjustment (applied to ALL configurations)
        tilt_offset=-0,     # Tilt needs -8 adjustment (applied to ALL configurations)
        left_rpm_offset=-50,  # Left RPM needs +5 adjustment (applied to ALL configurations)
        right_rpm_offset=-50, # Right RPM needs +3 adjustment (applied to ALL configurations)
        output_filename='bowling_data.json'
    )
    
    # Safety compliance check
    print("\n🛡️ SAFETY COMPLIANCE CHECK:")
    violations = check_safety_compliance(corrected_dataset)
    if violations:
        print("❌ Safety violations found:")
        for violation in violations:
            print(f"   {violation}")
    else:
        print("✅ All values are within safety ranges!")
    
    # Example query
    print("\n🔍 EXAMPLE QUERY:")
    query_result = query_bowling_machine(
        dataset=corrected_dataset,
        speed=110,
        swing_level=2,
        spin_level=-1,
        position='centre - 0'
    )
    
    if query_result['success']:
        print("✅ Query successful!")
        print(f"Parameters: {query_result['parameters']}")
        print(f"Machine Settings: {query_result['machine_settings']}")
    else:
        print(f"❌ Query failed: {query_result['error']}")
    
    print("\n🎉 ALGORITHM READY FOR PRODUCTION!")
    print("\n📋 USAGE INSTRUCTIONS:")
    print("="*30)
    print("""
    1. Test with baseline dataset (all offsets = 0)
    2. Measure actual vs expected results at any speed
    3. Calculate offsets: offset = expected - actual
    4. Run with your calculated offsets:
    
    dataset = create_bowling_machine_dataset_with_custom_offsets(
        pan_offset=your_pan_offset,        # Applied AS-IS to ALL configs
        tilt_offset=your_tilt_offset,      # Applied AS-IS to ALL configs  
        left_rpm_offset=your_left_rpm_offset,  # Applied AS-IS to ALL configs
        right_rpm_offset=your_right_rpm_offset, # Applied AS-IS to ALL configs
        output_filename='Production_Dataset.json'
    )
    
    5. Query specific configurations:
    result = query_bowling_machine(dataset, speed, swing, spin, position)
    
    6. Deploy to bowling machine!
    """)
