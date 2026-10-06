const { test, expect } = require("@playwright/test");

test("frontend smoke check for notifications and ops features", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", err => pageErrors.push(String(err)));
  page.on("dialog", async dialog => {
    await dialog.accept();
  });

  await page.goto("/");

  const id = Date.now();
  await page.fill("#authName", `Front Smoke ${id}`);
  await page.fill("#authEmail", `front-smoke-${id}@example.com`);
  await page.fill("#authPassword", "Password123!");
  await page.click("#registerBtn");

  await page.click('button.feature-nav-btn:has-text("Energy")');

  await page.fill("#name", "Smoke Fan");
  await page.fill("#category", "Cooling");
  await page.fill("#power", "75");
  await page.click('button:has-text("Add Appliance")');

  await page.waitForFunction(() => {
    const select = document.querySelector("#appliance_id");
    return Boolean(select && select.options && select.options.length > 0);
  });
  await page.selectOption("#appliance_id", { index: 0 });
  await page.fill("#hours", "2");
  await page.click('button:has-text("Add Usage")');

  await page.click('button.feature-nav-btn:has-text("Notifications")');

  await page.locator("#digestEnabled").setChecked(true, { force: true });
  await page.fill("#digestInterval", "60");
  await page.locator("#digestChannelInApp").setChecked(true, { force: true });
  await page.locator("#digestChannelPush").setChecked(false, { force: true });
  await page.locator("#digestChannelEmail").setChecked(false, { force: true });
  await page.click('button:has-text("Save Digest Schedule")');
  await page.click('button:has-text("Refresh Digest Schedule")');
  await expect(page.locator("#digestScheduleResult")).toContainText("Enabled");

  await page.click('button:has-text("Send Test Delivery")');
  await page.click('button:has-text("Refresh Deliveries")');
  await page.click('button:has-text("Check Provider")');
  await expect(page.locator("#deliveryProviderStatus")).toContainText("Mode");

  await page.click('button:has-text("Load Alerts Summary")');
  await expect(page.locator("#alertsSummaryResult")).toContainText("total");

  await page.locator("#inAppNotifications").setChecked(true, { force: true });
  await page.locator("#browserNotifications").setChecked(false, { force: true });
  await page.click('button:has-text("Save Notification Preferences")');
  await page.click('button:has-text("Refresh Anomalies")');

  await page.click('button.feature-nav-btn:has-text("Ops")');

  await page.click('button:has-text("Load Delivery Stats")');
  await expect(page.locator("#deliveryStatsResult")).toContainText("total");

  const firstDeliveryId = await page.evaluate(async () => {
    const token = localStorage.getItem("ecowattToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch("/notification-deliveries?limit=1", { headers });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0].id : null;
  });

  if (firstDeliveryId) {
    await page.fill("#deliveryRetryId", String(firstDeliveryId));
    await page.click('button:has-text("Retry One Delivery")');

    await page.fill("#deliveryDeleteId", String(firstDeliveryId));
    await page.click('button:has-text("Delete One Delivery")');
  }

  await page.fill("#deliveryRetryLimit", "5");
  await page.click('button:has-text("Retry Failed Deliveries")');
  await page.click('button:has-text("Export Deliveries CSV")');

  await page.fill("#deliveryDeleteStatus", "failed");
  await page.click('button:has-text("Bulk Delete Deliveries")');

  await page.click('button:has-text("Preview Digest")');
  await page.click('button:has-text("Run Digest Now")');
  await page.click('button:has-text("Digest Job Status")');
  await page.fill("#digestEnableInterval", "120");
  await page.click('button:has-text("Quick Enable Digest")');
  await page.click('button:has-text("Quick Disable Digest")');
  await expect(page.locator("#digestJobStatusResult")).toContainText("enabled");

  await page.click('button:has-text("Load Sustainability")');
  await page.click('button:has-text("Load Extended Health")');
  await page.click('button:has-text("Load Metrics Overview")');
  await expect(page.locator("#metricsOverviewResult")).toContainText("appliances");

  const firstAlertId = await page.evaluate(async () => {
    const token = localStorage.getItem("ecowattToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch("/alerts", { headers });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0].id : null;
  });

  await page.click('button.feature-nav-btn:has-text("Notifications")');
  await page.click('button:has-text("Acknowledge All")');
  if (firstAlertId) {
    await page.fill("#alertsDeleteId", String(firstAlertId));
    await page.click('button:has-text("Delete One Alert")');
  }
  await page.fill("#alertsBulkDeleteAck", "ack");
  await page.click('button:has-text("Bulk Delete Alerts")');

  expect(pageErrors, `Page errors found:\n${pageErrors.join("\n")}`).toEqual([]);
});
