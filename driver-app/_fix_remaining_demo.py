path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix 1: Remove queue flush DEMO guard (lines 816-820, 0-indexed: 815-819)
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if '// MODE GUARD: in DEMO mode queue flush is skipped' in line:
        # Skip this line and the next 4 lines (if guard + return + empty)
        # But be careful about the blank line after
        i += 1
        while i < len(lines) and (lines[i].strip() == '' or 'trackingModeRef' in lines[i] or 'console.log' in lines[i] or 'return;' in lines[i]):
            i += 1
        continue
    new_lines.append(line)
    i += 1

# Fix 2: Fix indentation on line that starts with "let { latitude"
fixed_lines = []
for line in new_lines:
    if line.startswith('let { latitude, longitude, accuracy, altitude, heading } = location;'):
        fixed_lines.append('    ' + line)
    else:
        fixed_lines.append(line)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(fixed_lines)

print('Fixed remaining DEMO issues')
