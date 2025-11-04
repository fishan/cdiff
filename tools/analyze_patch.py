import re
import sys
import argparse
from collections import defaultdict
import os

# --- [v1.0] Base58 Implementation (Python) ---
# Alphabet must exactly match cdiff_compress.ts
BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
BASE58_MAP = {char: index for index, char in enumerate(BASE58_ALPHABET)}
BASE = len(BASE58_ALPHABET)

def decodeBase58(encoded: str) -> int:
    """
    [v1.0] Decodes Base58 string to number (Python version).
    """
    if not encoded or not isinstance(encoded, str):
        return -1
    decoded = 0
    multi = 1
    for char in reversed(encoded):
        digit = BASE58_MAP.get(char)
        if digit is None:
            # Return -1 for invalid character, same as TS
            return -1
        decoded += digit * multi
        multi *= BASE
    return decoded

# --- [v1.0] Main parser logic ---

def analyze_patch(file_path):
    """
    [v1.0] Performs compressed patch revision.
    """
    stats = {
        'total_lines': 0,
        'total_size_b': 0,
        'compression_flag': False,
        'definition_lines': 0,
        'definition_size_b': 0,
        'definition_at_overhead_b': 0, # (H2) Overhead from '@' in definitions
        'command_lines': 0,
        'command_size_b': 0,
        'command_at_overhead_b': 0,  # Overhead from '@' in usage
        'literal_gap_overhead_b': 0, # Overhead from '#<len> '
        'block_prefix_overhead_b': 0,# (H1) Overhead from 'a ' / 'd ' in blocks
        'other_lines': 0,
        'other_size_b': 0,
    }

    defined_vars = {} # {var_name: content}
    used_vars_count = defaultdict(int) # {var_name: count}

    # --- Regex (v16.x format) ---
    
    # Definitions: @ (Base58 ID) (space) (content)
    def_regex = re.compile(r'^(@[\w\d]+)\s(.*)$', re.DOTALL)
    
    # Block header: (Base58 ID) (space) (A+/D+) (space) (count)
    block_header_regex = re.compile(r'^([\w\d]+)\s+([AD]\+)\s+(\d+)$')
    
    # Find all variable usages: @(Base58 ID)
    var_usage_regex = re.compile(r'@([\w\d]+)')
    
    # Find all literal headers: #(\d+)(space)
    literal_gap_regex = re.compile(r'#(\d+)\s')

    try:
        # Get file size for accurate byte counting
        stats['total_size_b'] = os.path.getsize(file_path)
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"ERROR: File not found '{file_path}'")
        return
    except Exception as e:
        print(f"ERROR: Failed to read file: {e}")
        return

    in_block = False
    block_lines_remaining = 0

    for line_num, line in enumerate(lines):
        line = line.rstrip('\n')
        # Use len(line.encode('utf-8')) for accurate byte counting
        line_len_b = len(line.encode('utf-8'))

        stats['total_lines'] += 1

        if line_num == 0 and line == '~':
            stats['compression_flag'] = True
            continue

        if in_block:
            # --- Inside A+/D+ block ---
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            
            content = line
            
            # (H1) Check prefix hypothesis
            if line.startswith('a ') or line.startswith('d '):
                # This is overhead (2 bytes: 'a' and ' ')
                stats['block_prefix_overhead_b'] += 2
                content = line[2:] # Analyze only content
            elif line.startswith('A ') or line.startswith('D '):
                # Count A/D literals too
                stats['block_prefix_overhead_b'] += 2
                content = line[2:]
            else:
                # String without prefix (as you suggested)
                pass 

            # Find usages in content
            usages = var_usage_regex.findall(content)
            for var_id in usages:
                used_vars_count[f"@{var_id}"] += 1
            
            # (H3) Overhead from '@' in usage
            stats['command_at_overhead_b'] += len(usages)
            
            # (H4) Overhead from literals
            gaps = literal_gap_regex.findall(content)
            for gap_len_str in gaps:
                # Count '#', digits and space
                stats['literal_gap_overhead_b'] += len(f"#{gap_len_str} ")

            block_lines_remaining -= 1
            if block_lines_remaining == 0:
                in_block = False
            continue

        # --- Not in block ---

        # (H2) Check definitions
        def_match = def_regex.match(line)
        if def_match:
            var_name = def_match.group(1)
            content = def_match.group(2)
            defined_vars[var_name] = content
            stats['definition_lines'] += 1
            stats['definition_size_b'] += line_len_b
            # (H2) Overhead from '@' at the beginning
            stats['definition_at_overhead_b'] += 1
            continue

        # Check block headers
        block_match = block_header_regex.match(line)
        if block_match:
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            block_lines_remaining = int(block_match.group(3))
            in_block = block_lines_remaining > 0
            continue

        # Check other commands (a, d, a*, d*, M, R)
        if re.match(r'^[\w\d,-]+\s+[ad].*$', line) or \
           re.match(r'^[\w\d,-]+\s+[MR].*$', line):
            
            stats['command_lines'] += 1
            stats['command_size_b'] += line_len_b
            
            usages = var_usage_regex.findall(line)
            for var_id in usages:
                used_vars_count[f"@{var_id}"] += 1
            
            # (H3) Overhead
            stats['command_at_overhead_b'] += len(usages)
            
            # (H4) Overhead
            gaps = literal_gap_regex.findall(line)
            for gap_len_str in gaps:
                stats['literal_gap_overhead_b'] += len(f"#{gap_len_str} ")
            continue

        # Everything else
        stats['other_lines'] += 1
        stats['other_size_b'] += line_len_b

    # --- [v1.0] Post-Analysis and Output ---
    
    print("=== [ Cdiff Patch Revision v1.0 ] ===")
    print(f"File analysis: {file_path}\n")

    print("--- General Statistics ---")
    print(f"  Compression flag:    {'Yes' if stats['compression_flag'] else 'No (???)'}")
    print(f"  Total lines:         {stats['total_lines']}")
    print(f"  Total size (bytes):  {stats['total_size_b']} B\n")

    print("--- Definitions (Variables) Analysis ---")
    defined_set = set(defined_vars.keys())
    print(f"  Definition lines:    {stats['definition_lines']}")
    print(f"  Definitions size:    {stats['definition_size_b']} B")
    if stats['definition_lines'] > 0:
        avg_def_size = stats['definition_size_b'] / stats['definition_lines']
        print(f"  (Avg. var. size):    {avg_def_size:.1f} B\n")
    else:
        print("\n")

    print("--- Commands (Patch) Analysis ---")
    print(f"  Command lines:       {stats['command_lines']}")
    print(f"  Commands size:       {stats['command_size_b']} B")
    print(f"  Other lines:         {stats['other_lines']} (size {stats['other_size_b']} B)\n")

    print("--- REVISION: Stray (Unused) Variables ---")
    used_set = set(used_vars_count.keys())
    unused_vars = defined_set - used_set
    
    if not unused_vars:
        print("  ✅ NO stray (unused) variables found.\n")
    else:
        print(f"  🔥 STRAY VARIABLES FOUND: {len(unused_vars)} out of {len(defined_set)}")
        unused_size_b = 0
        for var_name in unused_vars:
            # +1 for '@' (H2), +1 for ' ', +N for content
            unused_size_b += 1 + 1 + len(defined_vars[var_name].encode('utf-8'))
            
        print(f"  (Estimated 'dead weight': {unused_size_b} B)")
        
        # Show examples
        if len(unused_vars) > 10:
            print(f"  (Examples: {', '.join(list(unused_vars)[:10])} ...)\n")
        else:
            print(f"  (List: {', '.join(unused_vars)})\n")

    print("--- REVISION: Overhead Analysis ---")
    print(f"  (H1) 'a /d ' in A+/D+ blocks: {stats['block_prefix_overhead_b']:>7} B")
    print(f"  (H2) '@' in definitions:      {stats['definition_at_overhead_b']:>7} B")
    print(f"  (H3) '@' in usage:            {stats['command_at_overhead_b']:>7} B")
    print(f"  (H4) '#<len> ' in literals:   {stats['literal_gap_overhead_b']:>7} B")
    
    total_overhead = (stats['block_prefix_overhead_b'] + 
                      stats['definition_at_overhead_b'] + 
                      stats['command_at_overhead_b'] + 
                      stats['literal_gap_overhead_b'])
                      
    print(f"  ---------------------------------------")
    print(f"  Total syntax overhead: {total_overhead:>7} B")
    if stats['total_size_b'] > 0:
        overhead_percent = total_overhead / stats['total_size_b'] * 100
        print(f"  Overhead percentage:    {overhead_percent:.2f} %\n")
    else:
        print("\n")
    
    print("--- REVISION: Top 10 Most Used Variables ---")
    sorted_usage = sorted(used_vars_count.items(), key=lambda item: item[1], reverse=True)
    if not sorted_usage:
        print("  (No variables used)")
    else:
        for i, (var_name, count) in enumerate(sorted_usage[:10]):
            content = defined_vars.get(var_name, "?? DEFINITION NOT FOUND ??")
            content_display = (content[:40] + '...') if len(content) > 40 else content
            # Replace non-printable characters
            content_display = content_display.replace('\t', '\\t').replace('\r', '\\r')
            print(f"  {i+1:2}. {var_name:<4} (x{count:<5}) -> \"{content_display}\"")

def main():
    """
    [v1.0] Command line argument parser.
    """
    parser = argparse.ArgumentParser(
        description="Cdiff Patch Revision Tool v1.0. Analyzes compressed patch, finds stray variables and calculates overhead.",
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