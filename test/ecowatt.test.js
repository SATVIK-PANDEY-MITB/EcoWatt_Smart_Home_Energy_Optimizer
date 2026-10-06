const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

const app = require("../server");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("health and readiness endpoints respond", async () => {
  await delay(300);

  const health = await request(app).get("/health");
  const ready = await request(app).get("/ready");

  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.status, "ok");
  assert.strictEqual(ready.status, 200);
  assert.strictEqual(ready.body.status, "ready");
});

test("register, summary, and history flow works", async () => {
  await delay(300);
  const email = `test-${Date.now()}@example.com`;

  const register = await request(app)
    .post("/register")
    .send({ name: "Tester", email, password: "Password123!" });

  assert.strictEqual(register.status, 200);
  assert.ok(register.body.token);

  const auth = { Authorization: `Bearer ${register.body.token}` };

  const appliance = await request(app)
    .post("/add-appliance")
    .set(auth)
    .send({ name: "Unit Test Lamp", category: "Lighting", power: 80 });

  assert.strictEqual(appliance.status, 200);
  assert.ok(appliance.body.id);

  const usage = await request(app)
    .post("/add-usage")
    .set(auth)
    .send({ appliance_id: appliance.body.id, hours: 3, date: new Date().toISOString() });

  assert.strictEqual(usage.status, 200);

  const calculate = await request(app)
    .get("/calculate")
    .set(auth);

  assert.strictEqual(calculate.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(calculate.body, "totalUnits"));

  const summary = await request(app)
    .get("/monthly-summary")
    .set(auth);

  assert.strictEqual(summary.status, 200);
  assert.ok(summary.body.month);

  const history = await request(app)
    .get("/report-history")
    .set(auth);

  assert.strictEqual(history.status, 200);
  assert.ok(Array.isArray(history.body));
  assert.ok(history.body.length >= 1);
});

test("search and digest endpoints work", async () => {
  await delay(300);
  const email = `search-${Date.now()}@example.com`;

  const register = await request(app)
    .post("/register")
    .send({ name: "Searcher", email, password: "Password123!" });

  const auth = { Authorization: `Bearer ${register.body.token}` };

  await request(app)
    .post("/add-appliance")
    .set(auth)
    .send({ name: "Kitchen Fan", category: "Cooling", power: 120 });

  const search = await request(app)
    .get("/appliances/search?q=fan")
    .set(auth);

  assert.strictEqual(search.status, 200);
  assert.ok(Array.isArray(search.body));

  const digest = await request(app)
    .post("/digest")
    .set(auth)
    .send({ month: new Date().toISOString().slice(0, 7) });

  assert.strictEqual(digest.status, 200);
  assert.strictEqual(digest.body.message, "Digest generated");
});

test("forecast explanation and PDF export work", async () => {
  await delay(300);
  const email = `pdf-${Date.now()}@example.com`;

  const register = await request(app)
    .post("/register")
    .send({ name: "Pdf User", email, password: "Password123!" });

  const auth = { Authorization: `Bearer ${register.body.token}` };

  const explanation = await request(app)
    .get("/forecast-explanation")
    .set(auth);

  assert.strictEqual(explanation.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(explanation.body, "reasons"));

  const pdf = await request(app)
    .get("/report.pdf")
    .set(auth);

  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.headers["content-type"], "application/pdf");
});

test("digest schedule, delivery center, and advanced forecast work", async () => {
  await delay(300);
  const email = `forecast-${Date.now()}@example.com`;

  const register = await request(app)
    .post("/register")
    .send({ name: "Forecast User", email, password: "Password123!" });

  const auth = { Authorization: `Bearer ${register.body.token}` };

  const appliance = await request(app)
    .post("/add-appliance")
    .set(auth)
    .send({ name: "Forecast Fan", category: "Cooling", power: 140 });

  await request(app)
    .post("/add-usage")
    .set(auth)
    .send({ appliance_id: appliance.body.id, hours: 2.5, date: new Date().toISOString() });

  const scheduleUpdate = await request(app)
    .post("/digest-schedule")
    .set(auth)
    .send({ enabled: true, intervalMinutes: 60, channels: ["in_app", "email"] });

  assert.strictEqual(scheduleUpdate.status, 200);
  assert.strictEqual(scheduleUpdate.body.schedule.enabled, true);

  const scheduleRead = await request(app)
    .get("/digest-schedule")
    .set(auth);

  assert.strictEqual(scheduleRead.status, 200);
  assert.ok(Array.isArray(scheduleRead.body.channels));

  const testDelivery = await request(app)
    .post("/notification-deliveries/test")
    .set(auth)
    .send({ channels: ["in_app", "push"], subject: "Test delivery", message: "Testing delivery logging." });

  assert.strictEqual(testDelivery.status, 200);
  assert.ok(Array.isArray(testDelivery.body.deliveries));
  assert.ok(testDelivery.body.deliveries.length >= 1);

  const deliveries = await request(app)
    .get("/notification-deliveries?limit=10")
    .set(auth);

  assert.strictEqual(deliveries.status, 200);
  assert.ok(Array.isArray(deliveries.body));
  assert.ok(deliveries.body.length >= 1);
  assert.ok(Object.prototype.hasOwnProperty.call(deliveries.body[0], "status"));

  const providerStatus = await request(app)
    .get("/notification-provider-status")
    .set(auth);

  assert.strictEqual(providerStatus.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(providerStatus.body, "mode"));
  assert.ok(Object.prototype.hasOwnProperty.call(providerStatus.body, "webhookEnabled"));

  const forecast = await request(app)
    .get("/forecast-advanced?days=14")
    .set(auth);

  assert.strictEqual(forecast.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(forecast.body, "forecastUnits"));
  assert.ok(Array.isArray(forecast.body.recommendations));
});

test("bulk production feature batch endpoints work", async () => {
  await delay(300);
  const email = `batch-${Date.now()}@example.com`;

  const register = await request(app)
    .post("/register")
    .send({ name: "Batch User", email, password: "Password123!" });

  const auth = { Authorization: `Bearer ${register.body.token}` };

  const appliance = await request(app)
    .post("/add-appliance")
    .set(auth)
    .send({ name: "Batch AC", category: "Cooling", power: 1500 });

  await request(app)
    .post("/add-usage")
    .set(auth)
    .send({ appliance_id: appliance.body.id, hours: 4, date: new Date().toISOString() });

  await request(app)
    .post("/notification-deliveries/test")
    .set(auth)
    .send({ channels: ["in_app", "email"], subject: "Batch test", message: "Batch delivery." });

  const deliveryStats = await request(app)
    .get("/notification-deliveries/stats")
    .set(auth);
  assert.strictEqual(deliveryStats.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(deliveryStats.body, "byStatus"));

  const deliveries = await request(app)
    .get("/notification-deliveries?limit=5")
    .set(auth);
  assert.strictEqual(deliveries.status, 200);
  assert.ok(Array.isArray(deliveries.body));
  assert.ok(deliveries.body.length >= 1);

  const retrySingle = await request(app)
    .post(`/notification-deliveries/${deliveries.body[0].id}/retry`)
    .set(auth)
    .send({});
  assert.strictEqual(retrySingle.status, 200);

  const retryFailed = await request(app)
    .post("/notification-deliveries/retry-failed")
    .set(auth)
    .send({ limit: 5 });
  assert.strictEqual(retryFailed.status, 200);

  const deliveriesCsv = await request(app)
    .get("/notification-deliveries.csv?limit=20")
    .set(auth);
  assert.strictEqual(deliveriesCsv.status, 200);
  assert.strictEqual(deliveriesCsv.headers["content-type"], "text/csv; charset=utf-8");

  const digestPreview = await request(app)
    .get("/digest-preview")
    .set(auth);
  assert.strictEqual(digestPreview.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(digestPreview.body, "summary"));

  const digestRun = await request(app)
    .post("/digest/run-now")
    .set(auth)
    .send({});
  assert.strictEqual(digestRun.status, 200);

  const digestJobsStatus = await request(app)
    .get("/digest-jobs/status")
    .set(auth);
  assert.strictEqual(digestJobsStatus.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(digestJobsStatus.body, "enabled"));

  const enableSchedule = await request(app)
    .post("/digest-schedule/enable")
    .set(auth)
    .send({ intervalMinutes: 60, channels: ["in_app", "push"] });
  assert.strictEqual(enableSchedule.status, 200);

  const disableSchedule = await request(app)
    .post("/digest-schedule/disable")
    .set(auth)
    .send({});
  assert.strictEqual(disableSchedule.status, 200);

  const whatIf = await request(app)
    .get("/forecast-advanced/what-if?days=14&deltaPercent=-10")
    .set(auth);
  assert.strictEqual(whatIf.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(whatIf.body, "scenario"));

  const forecastRisk = await request(app)
    .get("/forecast-risk?days=14")
    .set(auth);
  assert.strictEqual(forecastRisk.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(forecastRisk.body, "risk"));

  const trendScore = await request(app)
    .get("/forecast-trend-score")
    .set(auth);
  assert.strictEqual(trendScore.status, 200);

  const weekdayProfile = await request(app)
    .get("/forecast-weekday-profile")
    .set(auth);
  assert.strictEqual(weekdayProfile.status, 200);
  assert.ok(Array.isArray(weekdayProfile.body.profile));

  const savingsPlan = await request(app)
    .get("/forecast-savings-plan")
    .set(auth);
  assert.strictEqual(savingsPlan.status, 200);
  assert.ok(Array.isArray(savingsPlan.body.plan));

  const alertsSummary = await request(app)
    .get("/alerts/summary")
    .set(auth);
  assert.strictEqual(alertsSummary.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(alertsSummary.body, "total"));

  const ackAll = await request(app)
    .post("/alerts/ack-all")
    .set(auth)
    .send({});
  assert.strictEqual(ackAll.status, 200);

  const sustainability = await request(app)
    .get("/sustainability")
    .set(auth);
  assert.strictEqual(sustainability.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(sustainability.body, "co2Kg"));

  const extendedHealth = await request(app)
    .get("/health/extended")
    .set(auth);
  assert.strictEqual(extendedHealth.status, 200);
  assert.strictEqual(extendedHealth.body.status, "ok");

  const metrics = await request(app)
    .get("/metrics/overview")
    .set(auth);
  assert.strictEqual(metrics.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(metrics.body, "appliances"));

  const deleteAlertBulk = await request(app)
    .delete("/alerts?acknowledged=1")
    .set(auth);
  assert.strictEqual(deleteAlertBulk.status, 200);

  const deleteDeliveryBulk = await request(app)
    .delete("/notification-deliveries?status=failed")
    .set(auth);
  assert.strictEqual(deleteDeliveryBulk.status, 200);
});
