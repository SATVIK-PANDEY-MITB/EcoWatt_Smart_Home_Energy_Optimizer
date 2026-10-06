# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-smoke.spec.js >> frontend smoke check for notifications and ops features
- Location: test\frontend-smoke.spec.js:3:1

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 90000ms exceeded.
```

# Page snapshot

```yaml
- main [ref=e2]:
  - generic [ref=e3]:
    - heading "EcoWatt Smart Home Energy Optimizer" [level=1] [ref=e4]
    - paragraph [ref=e5]: Track usage, forecast bills, and stay under budget.
    - button "Toggle Theme" [ref=e7] [cursor=pointer]
    - navigation "Feature navigation" [ref=e8]:
      - button "Auth" [ref=e9] [cursor=pointer]
      - button "Energy" [pressed] [ref=e10] [cursor=pointer]
      - button "Forecast" [ref=e11] [cursor=pointer]
      - button "Notifications" [ref=e12] [cursor=pointer]
      - button "Ops" [ref=e13] [cursor=pointer]
      - button "Analytics" [ref=e14] [cursor=pointer]
      - button "History" [ref=e15] [cursor=pointer]
  - generic [ref=e16]:
    - generic [ref=e17]:
      - heading "Add Appliance" [level=2] [ref=e18]
      - textbox "Appliance Name" [ref=e19]
      - textbox "Category (e.g. Lighting)" [ref=e20]
      - textbox "Power (W)" [ref=e21]
      - button "Add Appliance" [active] [ref=e22] [cursor=pointer]
    - generic [ref=e23]:
      - heading "Add Usage" [level=2] [ref=e24]
      - combobox [ref=e25]
      - textbox "Hours Used Today" [ref=e26]
      - button "Add Usage" [ref=e27] [cursor=pointer]
  - generic [ref=e28]:
    - generic [ref=e29]:
      - heading "Search Appliances" [level=2] [ref=e30]
      - textbox "Search by name or category" [ref=e31]
      - button "Search" [ref=e32] [cursor=pointer]
    - generic [ref=e33]:
      - heading "Usage Date Filter" [level=2] [ref=e34]
      - textbox [ref=e35]
      - textbox [ref=e36]
      - button "Apply Date Filter" [ref=e37] [cursor=pointer]
  - generic [ref=e38]:
    - heading "Monthly Summary" [level=2] [ref=e39]
    - button "Refresh Monthly Summary" [ref=e40] [cursor=pointer]
    - button "Generate Digest" [ref=e41] [cursor=pointer]
    - generic [ref=e42]: "Month: 2026-04 Units: 0.00 Cost: INR 0.00 Budget: INR 2000.00 Budget Delta: INR 2000.00 Top Appliance: N/A Alerts: 0"
  - generic [ref=e43]:
    - generic [ref=e44]:
      - heading "Monthly Budget" [level=2] [ref=e45]
      - textbox "Budget in INR" [ref=e46]: "2000.00"
      - button "Save Budget" [ref=e47] [cursor=pointer]
    - generic [ref=e48]:
      - heading "Analytics" [level=2] [ref=e49]
      - textbox "Auto Refresh Minutes" [ref=e50]: "5"
      - button "Refresh Dashboard" [ref=e51] [cursor=pointer]
```

# Test source

```ts
  1   | const { test, expect } = require("@playwright/test");
  2   | 
  3   | test("frontend smoke check for notifications and ops features", async ({ page }) => {
  4   |   const pageErrors = [];
  5   |   page.on("pageerror", err => pageErrors.push(String(err)));
  6   |   page.on("dialog", async dialog => {
  7   |     await dialog.accept();
  8   |   });
  9   | 
  10  |   await page.goto("/");
  11  | 
  12  |   const id = Date.now();
  13  |   await page.fill("#authName", `Front Smoke ${id}`);
  14  |   await page.fill("#authEmail", `front-smoke-${id}@example.com`);
  15  |   await page.fill("#authPassword", "Password123!");
  16  |   await page.click("#registerBtn");
  17  | 
  18  |   await page.click('button.feature-nav-btn:has-text("Energy")');
  19  | 
  20  |   await page.fill("#name", "Smoke Fan");
  21  |   await page.fill("#category", "Cooling");
  22  |   await page.fill("#power", "75");
  23  |   await page.click('button:has-text("Add Appliance")');
  24  | 
> 25  |   await page.waitForFunction(() => {
      |              ^ Error: page.waitForFunction: Test timeout of 90000ms exceeded.
  26  |     const select = document.querySelector("#appliance_id");
  27  |     return Boolean(select && select.options && select.options.length > 0);
  28  |   });
  29  |   await page.selectOption("#appliance_id", { index: 0 });
  30  |   await page.fill("#hours", "2");
  31  |   await page.click('button:has-text("Add Usage")');
  32  | 
  33  |   await page.click('button.feature-nav-btn:has-text("Notifications")');
  34  | 
  35  |   await page.locator("#digestEnabled").setChecked(true, { force: true });
  36  |   await page.fill("#digestInterval", "60");
  37  |   await page.locator("#digestChannelInApp").setChecked(true, { force: true });
  38  |   await page.locator("#digestChannelPush").setChecked(false, { force: true });
  39  |   await page.locator("#digestChannelEmail").setChecked(false, { force: true });
  40  |   await page.click('button:has-text("Save Digest Schedule")');
  41  |   await page.click('button:has-text("Refresh Digest Schedule")');
  42  |   await expect(page.locator("#digestScheduleResult")).toContainText("Enabled");
  43  | 
  44  |   await page.click('button:has-text("Send Test Delivery")');
  45  |   await page.click('button:has-text("Refresh Deliveries")');
  46  |   await page.click('button:has-text("Check Provider")');
  47  |   await expect(page.locator("#deliveryProviderStatus")).toContainText("Mode");
  48  | 
  49  |   await page.click('button:has-text("Load Alerts Summary")');
  50  |   await expect(page.locator("#alertsSummaryResult")).toContainText("total");
  51  | 
  52  |   await page.locator("#inAppNotifications").setChecked(true, { force: true });
  53  |   await page.locator("#browserNotifications").setChecked(false, { force: true });
  54  |   await page.click('button:has-text("Save Notification Preferences")');
  55  |   await page.click('button:has-text("Refresh Anomalies")');
  56  | 
  57  |   await page.click('button.feature-nav-btn:has-text("Ops")');
  58  | 
  59  |   await page.click('button:has-text("Load Delivery Stats")');
  60  |   await expect(page.locator("#deliveryStatsResult")).toContainText("total");
  61  | 
  62  |   const firstDeliveryId = await page.evaluate(async () => {
  63  |     const token = localStorage.getItem("ecowattToken");
  64  |     const headers = token ? { Authorization: `Bearer ${token}` } : {};
  65  |     const res = await fetch("/notification-deliveries?limit=1", { headers });
  66  |     if (!res.ok) return null;
  67  |     const rows = await res.json();
  68  |     return rows.length ? rows[0].id : null;
  69  |   });
  70  | 
  71  |   if (firstDeliveryId) {
  72  |     await page.fill("#deliveryRetryId", String(firstDeliveryId));
  73  |     await page.click('button:has-text("Retry One Delivery")');
  74  | 
  75  |     await page.fill("#deliveryDeleteId", String(firstDeliveryId));
  76  |     await page.click('button:has-text("Delete One Delivery")');
  77  |   }
  78  | 
  79  |   await page.fill("#deliveryRetryLimit", "5");
  80  |   await page.click('button:has-text("Retry Failed Deliveries")');
  81  |   await page.click('button:has-text("Export Deliveries CSV")');
  82  | 
  83  |   await page.fill("#deliveryDeleteStatus", "failed");
  84  |   await page.click('button:has-text("Bulk Delete Deliveries")');
  85  | 
  86  |   await page.click('button:has-text("Preview Digest")');
  87  |   await page.click('button:has-text("Run Digest Now")');
  88  |   await page.click('button:has-text("Digest Job Status")');
  89  |   await page.fill("#digestEnableInterval", "120");
  90  |   await page.click('button:has-text("Quick Enable Digest")');
  91  |   await page.click('button:has-text("Quick Disable Digest")');
  92  |   await expect(page.locator("#digestJobStatusResult")).toContainText("enabled");
  93  | 
  94  |   await page.click('button:has-text("Load Sustainability")');
  95  |   await page.click('button:has-text("Load Extended Health")');
  96  |   await page.click('button:has-text("Load Metrics Overview")');
  97  |   await expect(page.locator("#metricsOverviewResult")).toContainText("appliances");
  98  | 
  99  |   const firstAlertId = await page.evaluate(async () => {
  100 |     const token = localStorage.getItem("ecowattToken");
  101 |     const headers = token ? { Authorization: `Bearer ${token}` } : {};
  102 |     const res = await fetch("/alerts", { headers });
  103 |     if (!res.ok) return null;
  104 |     const rows = await res.json();
  105 |     return rows.length ? rows[0].id : null;
  106 |   });
  107 | 
  108 |   await page.click('button.feature-nav-btn:has-text("Notifications")');
  109 |   await page.click('button:has-text("Acknowledge All")');
  110 |   if (firstAlertId) {
  111 |     await page.fill("#alertsDeleteId", String(firstAlertId));
  112 |     await page.click('button:has-text("Delete One Alert")');
  113 |   }
  114 |   await page.fill("#alertsBulkDeleteAck", "ack");
  115 |   await page.click('button:has-text("Bulk Delete Alerts")');
  116 | 
  117 |   expect(pageErrors, `Page errors found:\n${pageErrors.join("\n")}`).toEqual([]);
  118 | });
  119 | 
```