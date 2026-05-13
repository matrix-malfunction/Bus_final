path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and fix the stray brace in flushQueue
marker = '    }\n\n    }\n    \n    if (failedQueue.length === 0 || flushInProgressRef.current) return;'
replacement = '    }\n\n    if (failedQueue.length === 0 || flushInProgressRef.current) return;'

if marker in content:
    content = content.replace(marker, replacement)
    print('Fixed stray brace')
else:
    print('WARNING: Could not find exact marker, trying simpler')
    # Try simpler replacement
    content = content.replace('    }\n\n    }\n    \n    if (failedQueue.length === 0', '    }\n\n    if (failedQueue.length === 0')
    print('Fixed stray brace (simple)')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
