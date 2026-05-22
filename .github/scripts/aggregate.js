const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://zen-iitkgp-default-rtdb.firebaseio.com",
});

const db = admin.database();

async function generateMonthlyAnalytics() {
  const now = Math.floor(Date.now() / 1000);

  const sixHoursAgo = now - 6 * 3600;

  const snapshot = await db
    .ref("energy_logs/device_001")
    .once("value");

  const data = snapshot.val();

  if (!data) return;

  const logs = Object.values(data).filter(
    (log) => log.timestamp >= sixHoursAgo
  );

  if (logs.length === 0) return;

  const powerLogs = logs.filter(
    (log) => log.avg_power !== 0
  );

  const voltageLogs = logs.filter(
    (log) => log.avg_voltage !== 0
  );

  const currentLogs = logs.filter(
    (log) => log.avg_current !== 0
  );

  const avgPower =
    powerLogs.reduce(
      (sum, log) => sum + log.avg_power,
      0
    ) / powerLogs.length;

  const avgVoltage =
    voltageLogs.reduce(
      (sum, log) => sum + log.avg_voltage,
      0
    ) / voltageLogs.length;

  const avgCurrent =
    currentLogs.reduce(
      (sum, log) => sum + log.avg_current,
      0
    ) / currentLogs.length;

  const totalEnergy = logs.reduce(
    (sum, log) => sum + log.energy_wh,
    0
  );

  await db
    .ref("analytics/device_001/monthly")
    .push({
      timestamp: now,
      avg_power: avgPower,
      avg_voltage: avgVoltage,
      avg_current: avgCurrent,
      energy_wh: totalEnergy,
    });

  console.log("Monthly analytics updated");
}

async function generateYearlyAnalytics() {
  const now = Math.floor(Date.now() / 1000);

  const oneDayAgo = now - 86400;

  const snapshot = await db
    .ref("energy_logs/device_001")
    .once("value");

  const data = snapshot.val();

  if (!data) return;

  const logs = Object.values(data).filter(
    (log) => log.timestamp >= oneDayAgo
  );

  if (logs.length === 0) return;

  const powerLogs = logs.filter(
    (log) => log.avg_power !== 0
  );

  const voltageLogs = logs.filter(
    (log) => log.avg_voltage !== 0
  );

  const currentLogs = logs.filter(
    (log) => log.avg_current !== 0
  );

  const avgPower =
    powerLogs.reduce(
      (sum, log) => sum + log.avg_power,
      0
    ) / powerLogs.length;

  const avgVoltage =
    voltageLogs.reduce(
      (sum, log) => sum + log.avg_voltage,
      0
    ) / voltageLogs.length;

  const avgCurrent =
    currentLogs.reduce(
      (sum, log) => sum + log.avg_current,
      0
    ) / currentLogs.length;

  const totalEnergy = logs.reduce(
    (sum, log) => sum + log.energy_wh,
    0
  );

  const yearlyRef =
    db.ref("analytics/device_001/yearly");

  const existing =
    await yearlyRef.once("value");

  const existingData = existing.val();

  if (existingData) {
    const keys = Object.keys(existingData);

    if (keys.length >= 500) {
      await yearlyRef
        .child(keys[0])
        .remove();
    }
  }

  await yearlyRef.push({
    timestamp: now,
    avg_power: avgPower,
    avg_voltage: avgVoltage,
    avg_current: avgCurrent,
    energy_wh: totalEnergy,
  });

  console.log("Yearly analytics updated");
}

(async () => {
  await generateMonthlyAnalytics();
  await generateYearlyAnalytics();
})();