path = r'w:\Final year project\backend\src\controllers\locationController.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """          nextStopEtaMinutes: progression?.etaMinutes,
        });

        if (!progression?.lastProjectedPoint) {"""
new = """          nextStopEtaMinutes: progression?.etaMinutes,
        });

        // DRIVER-OVERRIDE: Accept remainingDistanceMeters from driver app (simulation or real GPS)
        if (progression && Number.isFinite(req.body?.remainingDistanceMeters)) {
          progression.remainingDistanceMeters = req.body.remainingDistanceMeters;
          console.log("[DRIVER OVERRIDE] remainingDistanceMeters:", progression.remainingDistanceMeters);
        }

        if (!progression?.lastProjectedPoint) {"""
content = content.replace(old, new, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
