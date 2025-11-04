import re
import sys
import argparse
from collections import defaultdict
import os

# --- [v1.0] Base58 Implementation (Python) ---
BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
BASE58_MAP = {char: index for index, char in enumerate(BASE58_ALPHABET)}
BASE = len(BASE58_ALPHABET)

def decodeBase58(encoded: str) -> int:
    if not encoded or not isinstance(encoded, str):
        return -1
    decoded = 0
    multi = 1
    for char in reversed(encoded):
        digit = BASE58_MAP.get(char)
        if digit is None:
            return -1
        decoded += digit * multi
        multi *= BASE
    return decoded

# --- [v2.0.0] Main parser logic ---

def analyze_patch(file_path):
    stats = {
        'total_lines': 0,
        'total_size_b': 0,
        'compression_flag': False,
        'definition_lines': 0,
        'definition_size_b': 0,
        'definition_at_overhead_b': 0, # (H2)
        'command_lines': 0,
        'command_size_b': 0,
        'literal_gap_overhead_b': 0, # (H4)
        'block_prefix_overhead_b': 0,# (H1)
        'other_lines': 0,
        'other_size_b': 0,
        
        # --- [v2.0.0] Efficiency Statistics ---
        # (H3) Total cost of all references (e.g. '@bY', '@0')
        'total_reference_cost_b': 0, 
        # Total "weight" of original content that was replaced
        'total_replaced_bytes': 0, 
        
        # [v2.0.0] Separation by type
        'full_line_vars': set(),
        'fragment_vars': set(),
        
        'full_line_replaced_b': 0,
        'full_line_ref_cost_b': 0,
        
        'fragment_replaced_b': 0,
        'fragment_ref_cost_b': 0,
    }

    defined_vars = {} # {var_name: content}
    used_vars_count = defaultdict(int) # {var_name: count}

    # --- Regex (v16.x format) ---
    def_regex = re.compile(r'^(@[\w\d]+)\s(.*)$', re.DOTALL)
    def_regex_no_content = re.compile(r'^(@[\w\d]+)$') # For empty ones
    block_header_regex = re.compile(r'^([\w\d]+)\s+([AD]\+)\s+(\d+)$')
    var_usage_regex = re.compile(r'(@[\w\d]+)')
    literal_gap_regex = re.compile(r'#(\d+)\s')
    
    # [v2.0.0] Heuristic: "Full line" = content > 5 characters AND
    # (starts with \t) OR (starts with ' ') OR (ends with '}' or ';')
    # This is rough but should separate " \t\t}" from " return"
    full_line_heuristic_regex = re.compile(r'^(\s+.*|.*[};])$')

    try:
        stats['total_size_b'] = os.path.getsize(file_path)
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"ERROR: Failed to read file '{file_path}': {e}")
        return

    in_block = False
    block_lines_remaining = 0
    parsing_definitions = True # [v2.0.0] Start with definitions

    # --- [v2.0.0] Cycle 1: Collect Definitions ---
    # (We must collect *all* definitions *before* analyzing commands)
    
    for line_num, line in enumerate(lines):
        line = line.rstrip('\n')
        line_len_b = len(line.encode('utf-8'))
        
        stats['total_lines'] += 1

        if line_num == 0 and line == '~':
            stats['compression_flag'] = True
            continue
            
        if parsing_definitions:
            def_match = def_regex.match(line)
            if def_match:
                var_name = def_match.group(1)
                content = def_match.group(2)
                defined_vars[var_name] = content
                
                stats['definition_lines'] += 1
                stats['definition_size_b'] += line_len_b
                stats['definition_at_overhead_b'] += 1 # (H2)
                
                # [v2.0.0] Heuristic
                if len(content) > 5 and full_line_heuristic_regex.match(content):
                    stats['full_line_vars'].add(var_name)
                else:
                    stats['fragment_vars'].add(var_name)
                
                continue
            
            def_match_no_content = def_regex_no_content.match(line)
            if def_match_no_content:
                var_name = def_match_no_content.group(1)
                defined_vars[var_name] = ""
                stats['definition_lines'] += 1
                stats['definition_size_b'] += line_len_b
                stats['definition_at_overhead_b'] += 1 # (H2)
                stats['fragment_vars'].add(var_name) # Empty = fragments
                continue

            # First line that is not a definition = end of block
            parsing_definitions = False 
        
        # --- [v2.0.0] Cycle 2: Command Analysis (starts here) ---
        
        if in_block:
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            content = line
            
            if line.startswith(('a ', 'd ', 'A ', 'D ')):
                stats['block_prefix_overhead_b'] += 2 # (H1)
                content = line[2:]
            
            # --- [v2.0.0] Usage Analysis (H3 + Benefit) ---
            usages = var_usage_regex.findall(content)
            for full_var_name in usages: # e.g. '@bY'
                used_vars_count[full_var_name] += 1
                ref_cost_b = len(full_var_name.encode('utf-8'))
                stats['total_reference_cost_b'] += ref_cost_b # (H3)
                
                if full_var_name in defined_vars:
                    replaced_content = defined_vars[full_var_name]
                    replaced_b = len(replaced_content.encode('utf-8'))
                    stats['total_replaced_bytes'] += replaced_b
                    
                    # [v2.0.0] Separation
                    if full_var_name in stats['full_line_vars']:
                        stats['full_line_replaced_b'] += replaced_b
                        stats['full_line_ref_cost_b'] += ref_cost_b
                    else:
                        stats['fragment_replaced_b'] += replaced_b
                        stats['fragment_ref_cost_b'] += ref_cost_b

            # (H4) Overhead
            gaps = literal_gap_regex.findall(content)
            for gap_len_str in gaps:
                stats['literal_gap_overhead_b'] += len(f"#{gap_len_str} ")

            block_lines_remaining -= 1
            if block_lines_remaining == 0:
                in_block = False
            continue

        # (Not in block, not definition)
        block_match = block_header_regex.match(line)
        if block_match:
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            block_lines_remaining = int(block_match.group(3))
            in_block = block_lines_remaining > 0
            continue

        if re.match(r'^[\w\d,-]+\s+[ad].*$', line) or \
           re.match(r'^[\w\d,-]+\s+[MR].*$', line):
            
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            
            # --- [v2.0.0] Usage Analysis (H3 + Benefit) ---
            usages = var_usage_regex.findall(line)
            for full_var_name in usages: # e.g. '@bY'
                used_vars_count[full_var_name] += 1
                ref_cost_b = len(full_var_name.encode('utf-8'))
                stats['total_reference_cost_b'] += ref_cost_b # (H3)
                
                if full_var_name in defined_vars:
                    replaced_content = defined_vars[full_var_name]
                    replaced_b = len(replaced_content.encode('utf-8'))
                    stats['total_replaced_bytes'] += replaced_b
                    
                    # [v2.0.0] Separation
                    if full_var_name in stats['full_line_vars']:
                        stats['full_line_replaced_b'] += replaced_b
                        stats['full_line_ref_cost_b'] += ref_cost_b
                    else:
                        stats['fragment_replaced_b'] += replaced_b
                        stats['fragment_ref_cost_b'] += ref_cost_b
            
            # (H4) Overhead
            gaps = literal_gap_regex.findall(line)
            for gap_len_str in gaps:
                stats['literal_gap_overhead_b'] += len(f"#{gap_len_str} ")
            continue

        stats['other_lines'] += 1
        stats['other_size_b'] += line_len_b

    # --- [v2.0.0] Post-Analysis and Output ---
    
    print("=== [ Cdiff Patch Revision v2.0.0 ] ===")
    print(f"File analysis: {file_path}\n")

    print("--- General Statistics ---")
    print(f"  Compression flag:    {'Yes' if stats['compression_flag'] else 'No (???)'}")
    print(f"  Total lines:         {stats['total_lines']}")
    print(f"  Total size (bytes):  {stats['total_size_b']} B\n")

    print("--- Definitions (Variables) Analysis ---")
    defined_set = set(defined_vars.keys())
    print(f"  Definition lines:    {stats['definition_lines']}")
    print(f"    (Full lines):      {len(stats['full_line_vars'])}")
    print(f"    (Fragments):       {len(stats['fragment_vars'])}")
    print(f"  Definitions size:    {stats['definition_size_b']} B")
    
    # [v2.0.0] Definition cost by type
    def_cost_full_b = 0
    def_cost_fragment_b = 0
    for var_name, content in defined_vars.items():
        # (H2) Overhead + ' ' + content
        cost = 1 + 1 + len(content.encode('utf-8')) 
        if var_name in stats['full_line_vars']:
            def_cost_full_b += cost
        else:
            def_cost_fragment_b += cost
            
    print(f"    (Full lines cost):  {def_cost_full_b} B")
    print(f"    (Fragments cost):   {def_cost_fragment_b} B\n")


    print("--- REVISION: Stray (Unused) Variables ---")
    used_set = set(used_vars_count.keys())
    unused_vars = defined_set - used_set
    
    if not unused_vars:
        print("  ✅ NO stray (unused) variables found.\n")
    else:
        print(f"  🔥 STRAY VARIABLES FOUND: {len(unused_vars)} out of {len(defined_set)}")
        # (Dead weight calculation logic from v1.0)
        unused_size_b = 0
        for var_name in unused_vars:
            unused_size_b += 1 + 1 + len(defined_vars[var_name].encode('utf-8'))
        print(f"  (Estimated 'dead weight': {unused_size_b} B)\n")

    
    print("--- REVISION: Overhead Analysis ---")
    print(f"  (H1) 'a /d ' in A+/D+ blocks: {stats['block_prefix_overhead_b']:>7} B")
    print(f"  (H2) '@' in definitions:      {stats['definition_at_overhead_b']:>7} B")
    print(f"  (H3) References (e.g. '@bY'): {stats['total_reference_cost_b']:>7} B")
    print(f"  (H4) '#<len> ' in literals:   {stats['literal_gap_overhead_b']:>7} B")
    total_overhead = (stats['block_prefix_overhead_b'] + 
                      stats['definition_at_overhead_b'] + 
                      stats['total_reference_cost_b'] + 
                      stats['literal_gap_overhead_b'])
    print(f"  ---------------------------------------")
    print(f"  Total syntax overhead: {total_overhead:>7} B")
    if stats['total_size_b'] > 0:
        overhead_percent = total_overhead / stats['total_size_b'] * 100
        print(f"  Overhead percentage:    {overhead_percent:.2f} %\n")
    else:
        print("\n")

    # --- [v2.0.0] NEW BLOCK: EFFICIENCY ANALYSIS ---
    print("--- EFFICIENCY ANALYSIS (v2.0.0) ---")
    
    # 1. Full lines
    total_cost_full = def_cost_full_b + stats['full_line_ref_cost_b']
    net_savings_full = stats['full_line_replaced_b'] - total_cost_full
    
    print("  --- 1. Only 'Full Lines' ---")
    print(f"  Bytes replaced (B):     {stats['full_line_replaced_b']:>7} B")
    print(f"  Total cost (C):         {total_cost_full:>7} B")
    print(f"    (C1) Definitions:     {def_cost_full_b:>7} B")
    print(f"    (C2) References:      {stats['full_line_ref_cost_b']:>7} B")
    print(f"  ---------------------------------------")
    print(f"  🔥 Net Savings (B-C):    {net_savings_full:>7} B")
    
    # 2. Fragments (GST)
    total_cost_fragment = def_cost_fragment_b + stats['fragment_ref_cost_b']
    net_savings_fragment = stats['fragment_replaced_b'] - total_cost_fragment

    print("\n  --- 2. Only 'Fragments' (GST/v5) ---")
    print(f"  Bytes replaced (B):     {stats['fragment_replaced_b']:>7} B")
    print(f"  Total cost (C):         {total_cost_fragment:>7} B")
    print(f"    (C1) Definitions:     {def_cost_fragment_b:>7} B")
    print(f"    (C2) References:      {stats['fragment_ref_cost_b']:>7} B")
    print(f"  ---------------------------------------")
    print(f"  🔥 Net Savings (B-C):    {net_savings_fragment:>7} B")
    
    # 3. Total
    total_replaced = stats['total_replaced_bytes']
    total_cost = total_cost_full + total_cost_fragment
    total_savings = net_savings_full + net_savings_fragment

    print("\n  --- 3. TOTAL (Full + Fragments) ---")
    print(f"  Total bytes replaced (B): {total_replaced:>7} B")
    print(f"  Total cost (C):         {total_cost:>7} B")
    print(f"  🔥 Total Net Savings:     {total_savings:>7} B\n")


    print("--- REVISION: Top 10 Most Used Variables ---")
    sorted_usage = sorted(used_vars_count.items(), key=lambda item: item[1], reverse=True)
    if not sorted_usage:
        print("  (No variables used)")
    else:
        for i, (var_name, count) in enumerate(sorted_usage[:10]):
            var_type = "FULL" if var_name in stats['full_line_vars'] else "FRAG"
            content = defined_vars.get(var_name, "?? N/A ??")
            content_display = (content[:40] + '...') if len(content) > 40 else content
            content_display = content_display.replace('\t', '\\t').replace('\r', '\\r')
            print(f"  {i+1:2}. {var_name:<4} (x{count:<5}) [{var_type}] -> \"{content_display}\"")

def main():
    parser = argparse.ArgumentParser(
        description="Cdiff Patch Revision Tool v2.0.0. Analyzes savings from 'Full Lines' vs 'Fragments'.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "patch_file", 
        help="Path to compressed .cdiff file for analysis."
    )
    args = parser.parse_args()
    
    analyze_patch(args.patch_file)

if __name__ == "__main__":
    main()