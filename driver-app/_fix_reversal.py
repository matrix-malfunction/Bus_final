path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """          s.targetSpeed = 35;
          s.avgSpeed = 0;

          // Notify backend so progression engine uses reversed stops / coords"""
new = """          s.targetSpeed = 35;
          s.cruiseTarget = 30 + Math.random() * 5;
          s.nextCruiseChangeAt = 0;
          s.avgSpeed = 0;

          // Notify backend so progression engine uses reversed stops / coords"""
content = content.replace(old, new, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
