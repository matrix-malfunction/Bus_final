path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix indentation issues caused by guard removal
content = content.replace('    }\n\n// Build request body without fallbacks', '    }\n\n    // Build request body without fallbacks')
content = content.replace('    }\n\n    // Build request body without fallbacks\n    const requestBody = {\n      busId,', '    }\n\n    // Build request body without fallbacks\n    const requestBody = {\n      busId,')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed indentation')
