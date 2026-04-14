require("dotenv").config();

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { z } = require("zod");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || "*";
const JWT_SECRET = process.env.JWT_SECRET || "ecowatt-dev-secret";
const ENABLE_WEBHOOK_DELIVERY = String(process.env.ENABLE_WEBHOOK_DELIVERY || "false").toLowerCase() === "true";
const WEBHOOK_DELIVERY_URL = String(process.env.WEBHOOK_DELIVERY_URL || "").trim();
const WEBHOOK_DELIVERY_TOKEN = String(process.env.WEBHOOK_DELIVERY_TOKEN || "").trim();
const WEBHOOK_DELIVERY_TIMEOUT_MS = Math.min(Math.max(Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS) || 5000, 1000), 30000);
const GUEST_USER = {
  id: 1,
  email: "guest@ecowatt.local",
  name: "Guest",
  role: "guest"
};

app.disable("x-powered-by");
app.use(bodyParser.json());
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "http://localhost:3000", "http://127.0.0.1:3000"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map(v => v.trim())
  })
);
app.use(morgan("tiny"));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use((req, res, next) => {
  req.requestId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  res.setHeader("X-Request-Id", req.requestId);
  next();
});
app.use((req, res, next) => {
  res.setHeader("X-API-Version", "v1");
  next();
});
app.use((req, res, next) => {
  if (req.url === "/api/v1") {
    req.url = "/";
  } else if (req.url.startsWith("/api/v1/")) {
    req.url = req.url.replace(/^\/api\/v1/, "");
  }
  next();
});
app.use(express.static("public"));

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

const db = new sqlite3.Database("./database.db");
let digestSchedulerTimer = null;

function getCurrentMonthKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function computeSlabCost(totalUnits, slabs) {
  let cost = 0;

  slabs.forEach(s => {
    if (totalUnits > s.min_units) {
      const upper = Math.min(totalUnits, s.max_units);
      const units = upper - s.min_units;
      cost += units * s.rate;
    }
  });

  return cost;
}

function readTips() {
  try {
    const tipsPath = path.join(__dirname, "tips.json");
    const tips = JSON.parse(fs.readFileSync(tipsPath, "utf8"));
    if (Array.isArray(tips)) {
      return tips;
    }
    return [];
  } catch (err) {
    return [];
  }
}

function pickTips(allTips, count) {
  const shuffled = [...allTips].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escapeCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];

  rows.forEach(row => {
    lines.push(headers.map(header => escapeCell(row[header])).join(","));
  });

  return lines.join("\n");
}

function calculateCategoryBreakdown(rows) {
  const breakdown = {};

  rows.forEach(row => {
    const category = row.category || "General";
    const units = (row.power * row.hours) / 1000;
    breakdown[category] = (breakdown[category] || 0) + units;
  });

  return breakdown;
}

function buildUsageFilterClause(filters) {
  const clauses = ["a.user_id = ?", "u.user_id = ?"];
  const values = [filters.userId, filters.userId];

  if (filters.start) {
    clauses.push("date(u.date) >= date(?)");
    values.push(filters.start);
  }

  if (filters.end) {
    clauses.push("date(u.date) <= date(?)");
    values.push(filters.end);
  }

  if (filters.month) {
    clauses.push("strftime('%Y-%m', u.date) = ?");
    values.push(filters.month);
  }

  return {
    clause: clauses.join(" AND "),
    values
  };
}

function fetchScopedUsageRows(filters, callback) {
  const filter = buildUsageFilterClause(filters);

  db.all(
    `SELECT a.name, a.category, a.power, u.hours, u.date
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE ${filter.clause}
     ORDER BY u.date DESC`,
    filter.values,
    callback
  );
}

function aggregateMonthlySummary(userId, month, callback) {
  fetchScopedUsageRows({ userId, month }, (err, rows) => {
    if (err) return callback(err);

    db.all("SELECT * FROM tariff", [], (tariffErr, slabs) => {
      if (tariffErr) return callback(tariffErr);

      const totalUnits = rows.reduce((sum, row) => sum + (row.power * row.hours) / 1000, 0);
      const cost = computeSlabCost(totalUnits, slabs);
      const categoryBreakdown = calculateCategoryBreakdown(rows);
      const topAppliance = rows.length
        ? Object.entries(rows.reduce((acc, row) => {
            acc[row.name] = (acc[row.name] || 0) + (row.power * row.hours) / 1000;
            return acc;
          }, {})).sort((a, b) => b[1] - a[1])[0][0]
        : null;

      db.get(
        "SELECT budget FROM user_budgets WHERE user_id = ? AND month = ?",
        [userId, month],
        (budgetErr, budgetRow) => {
          if (budgetErr) return callback(budgetErr);

          db.all(
            "SELECT id, type, message, created_at, acknowledged FROM alerts WHERE user_id = ? ORDER BY created_at DESC",
            [userId],
            (alertsErr, alerts) => {
              if (alertsErr) return callback(alertsErr);

              callback(null, {
                month,
                totalUnits,
                cost,
                budget: budgetRow ? budgetRow.budget : 2000,
                budgetDelta: (budgetRow ? budgetRow.budget : 2000) - cost,
                categoryBreakdown,
                topAppliance,
                applianceCount: rows.length,
                alertsCount: alerts.length,
                alerts
              });
            }
          );
        }
      );
    });
  });
}

function getDailyUsageStats(userId, callback) {
  db.all(
    `SELECT date(u.date) AS day, SUM((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     GROUP BY date(u.date)
     ORDER BY day DESC
     LIMIT 30`,
    [userId, userId],
    callback
  );
}

function detectAnomalies(userId, callback) {
  getDailyUsageStats(userId, (err, rows) => {
    if (err) return callback(err);

    const values = rows.map(row => Number(row.units || 0));
    if (values.length < 3) {
      return callback(null, []);
    }

    const recent = values.slice(0, Math.min(7, values.length));
    const baseline = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const threshold = baseline * 1.5;
    const anomalies = rows
      .filter(row => Number(row.units || 0) > threshold)
      .map(row => ({
        day: row.day,
        units: Number(row.units || 0),
        baseline,
        threshold,
        severity: Number(row.units || 0) > baseline * 2 ? "high" : "medium"
      }));

    callback(null, anomalies);
  });
}

function summarizeForecastExplanation(userId, month, callback) {
  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return callback(err);

    getDailyUsageStats(userId, (dailyErr, dailyRows) => {
      if (dailyErr) return callback(dailyErr);

      const recentDays = dailyRows.slice(0, 7).map(row => Number(row.units || 0));
      const recentAverage = recentDays.length
        ? recentDays.reduce((sum, value) => sum + value, 0) / recentDays.length
        : 0;

      const anomalies = [];
      detectAnomalies(userId, (anomalyErr, anomalyRows) => {
        if (anomalyErr) return callback(anomalyErr);
        anomalyRows.forEach(row => anomalies.push(row));

        const reasons = [];
        reasons.push(`Average daily usage is ${recentAverage.toFixed(2)} units.`);
        reasons.push(`Projected monthly cost is INR ${summary.cost.toFixed(2)} against a budget of INR ${summary.budget.toFixed(2)}.`);

        if (summary.topAppliance) {
          reasons.push(`${summary.topAppliance} is currently the largest energy consumer.`);
        }

        if (anomalies.length) {
          reasons.push(`${anomalies.length} usage anomalies were detected in recent days.`);
        }

        if (summary.cost > summary.budget) {
          reasons.push("Current consumption is likely to exceed the budget if the pattern continues.");
        } else {
          reasons.push("Current consumption is within budget, but continued monitoring is recommended.");
        }

        callback(null, {
          month,
          recentAverage,
          reasons,
          anomalies,
          summary
        });
      });
    });
  });
}

function saveReportSnapshot(userId, month, summary, callback) {
  db.run(
    `INSERT INTO report_snapshots (
      user_id, month, total_units, cost, budget, budget_delta, top_appliance, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET
      total_units = excluded.total_units,
      cost = excluded.cost,
      budget = excluded.budget,
      budget_delta = excluded.budget_delta,
      top_appliance = excluded.top_appliance,
      created_at = excluded.created_at` ,
    [
      userId,
      month,
      summary.totalUnits,
      summary.cost,
      summary.budget,
      summary.budgetDelta,
      summary.topAppliance,
      new Date().toISOString()
    ],
    callback
  );
}

function addAlert(userId, type, message) {
  db.run(
    "INSERT INTO alerts (user_id, type, message, created_at, acknowledged) VALUES (?, ?, ?, ?, 0)",
    [userId, type, message, new Date().toISOString()],
    err => {
      if (err) console.error(err);
      recordAlertDeliveries(userId, type, message);
    }
  );
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDeliveryChannels(value) {
  const allowed = new Set(["in_app", "push", "email"]);
  const channels = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);

  const normalized = channels.filter(channel => allowed.has(channel));
  return normalized.length ? Array.from(new Set(normalized)) : ["in_app"];
}

function encodeChannels(channels) {
  return JSON.stringify(normalizeDeliveryChannels(channels));
}

function decodeChannels(value) {
  if (!value) return ["in_app"];

  try {
    const parsed = JSON.parse(value);
    return normalizeDeliveryChannels(parsed);
  } catch (err) {
    return normalizeDeliveryChannels(value);
  }
}

function sendWebhookDelivery(payload, callback) {
  if (!ENABLE_WEBHOOK_DELIVERY || !WEBHOOK_DELIVERY_URL) {
    return callback(null, {
      status: "sent",
      source: "local",
      code: null,
      responsePreview: "Webhook delivery disabled"
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, WEBHOOK_DELIVERY_TIMEOUT_MS);

  const headers = {
    "Content-Type": "application/json"
  };

  if (WEBHOOK_DELIVERY_TOKEN) {
    headers.Authorization = `Bearer ${WEBHOOK_DELIVERY_TOKEN}`;
  }

  fetch(WEBHOOK_DELIVERY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal
  })
    .then(async response => {
      clearTimeout(timeoutId);
      const body = await response.text().catch(() => "");
      if (!response.ok) {
        return callback(null, {
          status: "failed",
          source: "webhook",
          code: response.status,
          responsePreview: body.slice(0, 280) || `HTTP ${response.status}`
        });
      }

      callback(null, {
        status: "sent",
        source: "webhook",
        code: response.status,
        responsePreview: body.slice(0, 280) || "OK"
      });
    })
    .catch(err => {
      clearTimeout(timeoutId);
      callback(null, {
        status: "failed",
        source: "webhook",
        code: null,
        responsePreview: String(err && err.message ? err.message : err)
      });
    });
}

function recordNotificationDeliveries(userId, channels, subject, message, callback) {
  const channelList = normalizeDeliveryChannels(channels);
  if (!channelList.length) {
    return callback(null, []);
  }

  const createdAt = new Date().toISOString();
  const rows = [];

  const processChannel = index => {
    if (index >= channelList.length) {
      return callback(null, rows);
    }

    const channel = channelList[index];
    const shouldUseWebhook = channel === "push" || channel === "email";
    const payload = {
      userId,
      channel,
      subject,
      message,
      createdAt
    };

    const afterDelivery = result => {
      const sentAt = new Date().toISOString();
      db.run(
        `INSERT INTO notification_deliveries (user_id, channel, subject, message, status, created_at, sent_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          channel,
          subject,
          message,
          result.status,
          createdAt,
          sentAt,
          JSON.stringify({
            source: result.source,
            code: result.code,
            responsePreview: result.responsePreview
          })
        ],
        function (err) {
          if (err) {
            return callback(err);
          }

          rows.push({
            id: this.lastID,
            user_id: userId,
            channel,
            subject,
            message,
            status: result.status,
            created_at: createdAt,
            sent_at: sentAt
          });

          processChannel(index + 1);
        }
      );
    };

    if (!shouldUseWebhook) {
      return afterDelivery({
        status: "sent",
        source: "local",
        code: null,
        responsePreview: "In-app delivery"
      });
    }

    sendWebhookDelivery(payload, (deliveryErr, result) => {
      if (deliveryErr) {
        return callback(deliveryErr);
      }
      afterDelivery(result);
    });
  };

  processChannel(0);
}

function recordAlertDeliveries(userId, type, message) {
  db.get(
    "SELECT browser, in_app FROM notification_preferences WHERE user_id = ?",
    [userId],
    (err, prefs) => {
      if (err) {
        console.error(err);
        return;
      }

      const channels = [];
      if (!prefs || prefs.in_app) channels.push("in_app");
      if (!prefs || prefs.browser) channels.push("push");

      if (!channels.length) {
        return;
      }

      recordNotificationDeliveries(userId, channels, `EcoWatt ${type} alert`, message, deliveryErr => {
        if (deliveryErr) console.error(deliveryErr);
      });
    }
  );
}

function getDigestSchedule(userId, callback) {
  db.get(
    "SELECT enabled, interval_minutes, last_run_at, next_run_at, channels FROM digest_jobs WHERE user_id = ?",
    [userId],
    (err, row) => {
      if (err) return callback(err);

      callback(null, {
        enabled: row ? Boolean(row.enabled) : false,
        intervalMinutes: row ? Number(row.interval_minutes || 1440) : 1440,
        lastRunAt: row ? row.last_run_at : null,
        nextRunAt: row ? row.next_run_at : null,
        channels: row ? decodeChannels(row.channels) : ["in_app"]
      });
    }
  );
}

function upsertDigestSchedule(userId, schedule, callback) {
  const enabled = schedule.enabled ? 1 : 0;
  const intervalMinutes = clampNumber(Number(schedule.intervalMinutes) || 1440, 15, 10080);
  const channels = encodeChannels(schedule.channels);
  const nextRunAt = enabled ? new Date(Date.now() + intervalMinutes * 60000).toISOString() : null;

  db.run(
    `INSERT INTO digest_jobs (user_id, enabled, interval_minutes, last_run_at, next_run_at, channels)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       interval_minutes = excluded.interval_minutes,
       next_run_at = excluded.next_run_at,
       channels = excluded.channels`,
    [userId, enabled, intervalMinutes, null, nextRunAt, channels],
    callback
  );
}

function buildAdvancedForecast(userId, days, callback) {
  const horizonDays = clampNumber(Number(days) || 30, 7, 90);

  db.all(
    `SELECT date(u.date) AS day, SUM((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     GROUP BY date(u.date)
     ORDER BY day DESC
     LIMIT 60`,
    [userId, userId],
    (err, rows) => {
      if (err) return callback(err);

      const lookup = {};
      rows.forEach(row => {
        lookup[row.day] = Number(row.units || 0);
      });

      const history = [];
      const dayCount = Math.max(rows.length, 30);
      for (let i = dayCount - 1; i >= 0; i -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const day = date.toISOString().slice(0, 10);
        history.push({
          day,
          units: lookup[day] || 0,
          weekday: date.getDay()
        });
      }

      const recentWindow = history.slice(-14);
      const recentSeven = history.slice(-7).map(item => item.units);
      const previousSeven = history.slice(-14, -7).map(item => item.units);

      const recentAverage = recentSeven.length
        ? recentSeven.reduce((sum, value) => sum + value, 0) / recentSeven.length
        : 0;

      const previousAverage = previousSeven.length
        ? previousSeven.reduce((sum, value) => sum + value, 0) / previousSeven.length
        : 0;

      const variance = recentWindow.length
        ? Math.sqrt(
            recentWindow.reduce((sum, item) => sum + Math.pow(item.units - recentAverage, 2), 0) /
            recentWindow.length
          )
        : 0;

      const weekdayBuckets = Array.from({ length: 7 }, () => []);
      history.slice(-28).forEach(item => {
        weekdayBuckets[item.weekday].push(item.units);
      });

      const weekdayProfile = weekdayBuckets.map(values => {
        if (!values.length) return recentAverage;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      });

      const growthRate = previousAverage > 0 ? (recentAverage - previousAverage) / previousAverage : 0;
      const dailyForecast = [];

      for (let i = 1; i <= horizonDays; i += 1) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const weekday = date.getDay();
        const seasonalBaseline = weekdayProfile[weekday] || recentAverage;
        const trendFactor = clampNumber(1 + growthRate * (i / horizonDays), 0.75, 1.5);
        const units = Math.max(0, seasonalBaseline * trendFactor);

        dailyForecast.push({
          day: date.toISOString().slice(0, 10),
          units
        });
      }

      db.all("SELECT * FROM tariff", [], (tariffErr, slabs) => {
        if (tariffErr) return callback(tariffErr);

        const forecastUnits = dailyForecast.reduce((sum, item) => sum + item.units, 0);
        const forecastCost = computeSlabCost(forecastUnits, slabs);

        db.get(
          "SELECT budget FROM user_budgets WHERE user_id = ? AND month = ?",
          [userId, getCurrentMonthKey()],
          (budgetErr, budgetRow) => {
            if (budgetErr) return callback(budgetErr);

            const budget = budgetRow ? budgetRow.budget : 2000;
            const confidence = clampNumber(
              Math.round(88 - Math.abs(growthRate) * 120 - Math.min(variance * 2, 18)),
              55,
              95
            );

            const recommendations = [];
            if (growthRate > 0.08) {
              recommendations.push("Recent consumption is trending up. Check high-load appliances.");
            } else if (growthRate < -0.08) {
              recommendations.push("Usage is trending down. Keep the current routine stable.");
            } else {
              recommendations.push("Consumption is steady. Small efficiency gains can still reduce cost.");
            }

            if (forecastCost > budget) {
              recommendations.push("Forecasted cost is above budget. Reduce evening peak usage or defer flexible loads.");
            } else {
              recommendations.push("Forecasted cost remains within budget.");
            }

            const peakForecast = dailyForecast.reduce(
              (best, item) => (item.units > best.units ? item : best),
              dailyForecast[0] || { day: null, units: 0 }
            );

            callback(null, {
              horizonDays,
              recentAverage,
              previousAverage,
              growthRate,
              variance,
              forecastUnits,
              forecastCost,
              budget,
              budgetDelta: budget - forecastCost,
              confidence,
              peakForecastDay: peakForecast.day,
              dailyForecast,
              weekdayProfile: weekdayProfile.map((units, weekday) => ({
                weekday,
                units
              })),
              recommendations
            });
          }
        );
      });
    }
  );
}

function processDigestJob(job, callback) {
  const userId = Number(job.user_id);
  const channels = decodeChannels(job.channels);
  const month = getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return callback(err);

    saveReportSnapshot(userId, month, summary, saveErr => {
      if (saveErr) return callback(saveErr);

      const now = new Date().toISOString();
      const nextRunAt = new Date(Date.now() + Number(job.interval_minutes || 1440) * 60000).toISOString();
      const subject = `EcoWatt digest for ${month}`;
      const message = `Total units ${summary.totalUnits.toFixed(2)}, cost INR ${summary.cost.toFixed(2)}, budget delta INR ${summary.budgetDelta.toFixed(2)}`;

      recordNotificationDeliveries(userId, channels, subject, message, deliveryErr => {
        if (deliveryErr) return callback(deliveryErr);

        db.run(
          "UPDATE digest_jobs SET last_run_at = ?, next_run_at = ? WHERE user_id = ?",
          [now, nextRunAt, userId],
          updateErr => {
            if (updateErr) return callback(updateErr);
            callback(null, { summary, channels, nextRunAt });
          }
        );
      });
    });
  });
}

function processDueDigestJobs() {
  const now = new Date().toISOString();

  db.all(
    "SELECT user_id, enabled, interval_minutes, last_run_at, next_run_at, channels FROM digest_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
    [now],
    (err, jobs) => {
      if (err) {
        console.error(err);
        return;
      }

      jobs.forEach(job => {
        processDigestJob(job, jobErr => {
          if (jobErr) console.error(jobErr);
        });
      });
    }
  );
}

function startDigestScheduler() {
  if (digestSchedulerTimer) {
    return;
  }

  digestSchedulerTimer = setInterval(processDueDigestJobs, 60 * 1000);
  digestSchedulerTimer.unref();
  processDueDigestJobs();
}

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role
  };
}

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getColumnNames(tableName, callback) {
  db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows.map(row => row.name));
  });
}

function ensureColumn(tableName, columnDefinition, callback) {
  const columnName = columnDefinition.split(" ")[0];
  getColumnNames(tableName, (err, columns) => {
    if (err) return callback(err);
    if (columns.includes(columnName)) return callback(null);
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`, callback);
  });
}

function getUserScopedId(req) {
  return req.user && req.user.id ? req.user.id : GUEST_USER.id;
}

function authSchemaSafeParse(schema, body) {
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

function sendDbError(res, err) {
  return res.status(500).send({
    error: "Database operation failed",
    details: String(err && err.message ? err.message : err)
  });
}

const addApplianceSchema = z.object({
  name: z.string().min(1).max(80),
  power: z.coerce.number().positive().max(100000),
  category: z.string().min(1).max(40).optional()
});

const addUsageSchema = z.object({
  appliance_id: z.coerce.number().int().positive(),
  hours: z.coerce.number().positive().max(24),
  date: z.string().optional()
});

const setBudgetSchema = z.object({
  month: z.string().optional(),
  budget: z.coerce.number().positive().max(10000000)
});

const notificationSchema = z.object({
  browser: z.boolean().optional(),
  inApp: z.boolean().optional()
});

const updateApplianceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: z.string().min(1).max(40).optional(),
  power: z.coerce.number().positive().max(100000).optional()
});

const registerSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128)
});

app.use((req, res, next) => {
  req.user = GUEST_USER;

  const publicPaths = new Set([
    "/health",
    "/ready",
    "/version",
    "/api-docs",
    "/login",
    "/register",
    "/tips"
  ]);

  if (publicPaths.has(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get("SELECT id, email, name, role FROM users WHERE id = ?", [decoded.sub], (err, row) => {
      if (err) return sendDbError(res, err);
      if (!row) return res.status(401).send({ error: "Invalid token" });
      req.user = normalizeUserRow(row);
      next();
    });
  } catch (err) {
    return res.status(401).send({ error: "Invalid token" });
  }
});

app.get("/health", (req, res) => {
  res.send({
    status: "ok",
    version: "v1",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/ready", (req, res) => {
  db.get("SELECT 1 AS ok", [], (err) => {
    if (err) {
      return res.status(503).send({ status: "not-ready" });
    }
    return res.send({ status: "ready" });
  });
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS appliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    power INTEGER,
    category TEXT DEFAULT 'General'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appliance_id INTEGER,
    hours REAL,
    date TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tariff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    min_units INTEGER,
    max_units INTEGER,
    rate REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT UNIQUE,
    budget REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    month TEXT,
    budget REAL,
    UNIQUE(user_id, month)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    message TEXT,
    created_at TEXT,
    acknowledged INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS report_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    month TEXT,
    total_units REAL,
    cost REAL,
    budget REAL,
    budget_delta REAL,
    top_appliance TEXT,
    created_at TEXT
  )`);

  db.run(`DELETE FROM report_snapshots
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM report_snapshots
      GROUP BY user_id, month
    )`);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_report_snapshots_user_month
    ON report_snapshots (user_id, month)`);

  db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INTEGER PRIMARY KEY,
    browser INTEGER DEFAULT 1,
    in_app INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS digest_jobs (
    user_id INTEGER PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    interval_minutes INTEGER DEFAULT 1440,
    last_run_at TEXT,
    next_run_at TEXT,
    channels TEXT DEFAULT '["in_app"]'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    channel TEXT,
    subject TEXT,
    message TEXT,
    status TEXT,
    created_at TEXT,
    sent_at TEXT,
    metadata TEXT
  )`);

  db.run("DELETE FROM tariff");

  db.run("INSERT INTO tariff (min_units, max_units, rate) VALUES (0, 100, 5)");
  db.run("INSERT INTO tariff (min_units, max_units, rate) VALUES (101, 200, 7)");
  db.run("INSERT INTO tariff (min_units, max_units, rate) VALUES (201, 100000, 10)");

  db.run(
    "INSERT OR IGNORE INTO budgets (month, budget) VALUES (?, ?)",
    [getCurrentMonthKey(), 2000]
  );

  db.run(
    "INSERT OR IGNORE INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)",
    [GUEST_USER.id, GUEST_USER.email, "", GUEST_USER.name, GUEST_USER.role]
  );

  ensureColumn("appliances", "user_id INTEGER DEFAULT 1", err => {
    if (err) console.error(err);
  });

  ensureColumn("appliances", "category TEXT DEFAULT 'General'", err => {
    if (err) console.error(err);
  });

  ensureColumn("usage", "user_id INTEGER DEFAULT 1", err => {
    if (err) console.error(err);
  });

  db.run(
    "INSERT OR IGNORE INTO notification_preferences (user_id, browser, in_app) VALUES (?, 1, 1)",
    [GUEST_USER.id]
  );

  db.run(
    "INSERT OR IGNORE INTO digest_jobs (user_id, enabled, interval_minutes, last_run_at, next_run_at, channels) VALUES (?, 0, 1440, NULL, NULL, '[\"in_app\"]')",
    [GUEST_USER.id]
  );
});

app.post("/register", (req, res) => {
  const parsed = authSchemaSafeParse(registerSchema, req.body);
  if (!parsed.ok) {
    return res.status(400).send({ error: "Invalid registration data" });
  }

  const { email, password, name } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  const displayName = (name || normalizedEmail.split("@")[0]).trim();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
    [normalizedEmail, passwordHash, displayName, "user"],
    function (err) {
      if (err) {
        if (String(err.message || "").includes("UNIQUE")) {
          return res.status(409).send({ error: "User already exists" });
        }
        return sendDbError(res, err);
      }

      const user = { id: this.lastID, email: normalizedEmail, name: displayName, role: "user" };
      res.send({ token: issueToken(user), user });
    }
  );
});

app.post("/login", (req, res) => {
  const parsed = authSchemaSafeParse(loginSchema, req.body);
  if (!parsed.ok) {
    return res.status(400).send({ error: "Invalid login data" });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  db.get(
    "SELECT id, email, password_hash, name, role FROM users WHERE email = ?",
    [normalizedEmail],
    (err, row) => {
      if (err) return sendDbError(res, err);
      if (!row || !row.password_hash) {
        return res.status(401).send({ error: "Invalid credentials" });
      }

      const valid = bcrypt.compareSync(password, row.password_hash);
      if (!valid) {
        return res.status(401).send({ error: "Invalid credentials" });
      }

      const user = normalizeUserRow(row);
      res.send({ token: issueToken(user), user });
    }
  );
});

app.get("/me", (req, res) => {
  res.send({ user: req.user, authenticated: req.user.id !== GUEST_USER.id });
});

app.get("/alerts", (req, res) => {
  const userId = getUserScopedId(req);
  db.all(
    "SELECT id, type, message, created_at, acknowledged FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    [userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.send(rows);
    }
  );
});

app.get("/anomalies", (req, res) => {
  const userId = getUserScopedId(req);

  detectAnomalies(userId, (err, anomalies) => {
    if (err) return sendDbError(res, err);
    res.send({ anomalies });
  });
});

app.get("/notification-preferences", (req, res) => {
  const userId = getUserScopedId(req);

  db.get(
    "SELECT browser, in_app FROM notification_preferences WHERE user_id = ?",
    [userId],
    (err, row) => {
      if (err) return sendDbError(res, err);
      res.send({
        browser: row ? Boolean(row.browser) : true,
        inApp: row ? Boolean(row.in_app) : true
      });
    }
  );
});

app.get("/notification-deliveries", (req, res) => {
  const userId = getUserScopedId(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

  db.all(
    `SELECT id, channel, subject, message, status, created_at, sent_at, metadata
     FROM notification_deliveries
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.send(rows);
    }
  );
});

app.get("/notification-deliveries/stats", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT status, channel, COUNT(*) AS count
     FROM notification_deliveries
     WHERE user_id = ?
     GROUP BY status, channel`,
    [userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const byStatus = {};
      const byChannel = {};
      let total = 0;

      rows.forEach(row => {
        const count = Number(row.count || 0);
        total += count;
        byStatus[row.status] = (byStatus[row.status] || 0) + count;
        byChannel[row.channel] = (byChannel[row.channel] || 0) + count;
      });

      res.send({
        total,
        byStatus,
        byChannel,
        failedRate: total ? Number(((byStatus.failed || 0) / total).toFixed(4)) : 0
      });
    }
  );
});

app.post("/notification-deliveries/:id/retry", (req, res) => {
  const userId = getUserScopedId(req);
  const id = Number(req.params.id);

  db.get(
    `SELECT id, channel, subject, message
     FROM notification_deliveries
     WHERE id = ? AND user_id = ?`,
    [id, userId],
    (err, row) => {
      if (err) return sendDbError(res, err);
      if (!row) return res.status(404).send({ error: "Delivery not found" });

      recordNotificationDeliveries(userId, [row.channel], row.subject, row.message, (retryErr, deliveries) => {
        if (retryErr) return sendDbError(res, retryErr);
        res.send({ message: "Delivery retried", sourceId: id, deliveries });
      });
    }
  );
});

app.post("/notification-deliveries/retry-failed", (req, res) => {
  const userId = getUserScopedId(req);
  const limit = Math.min(Math.max(Number(req.body && req.body.limit) || 25, 1), 100);

  db.all(
    `SELECT id, channel, subject, message
     FROM notification_deliveries
     WHERE user_id = ? AND status = 'failed'
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const retried = [];
      const run = index => {
        if (index >= rows.length) {
          return res.send({ message: "Failed deliveries retried", attempted: rows.length, retried });
        }

        const item = rows[index];
        recordNotificationDeliveries(userId, [item.channel], item.subject, item.message, (retryErr, deliveries) => {
          if (retryErr) return sendDbError(res, retryErr);
          retried.push({ sourceId: item.id, deliveries });
          run(index + 1);
        });
      };

      run(0);
    }
  );
});

app.get("/notification-deliveries.csv", (req, res) => {
  const userId = getUserScopedId(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  db.all(
    `SELECT id, channel, subject, message, status, created_at, sent_at, metadata
     FROM notification_deliveries
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="ecowatt-deliveries.csv"');
      res.send(toCsv(rows));
    }
  );
});

app.delete("/notification-deliveries/:id", (req, res) => {
  const userId = getUserScopedId(req);
  const id = Number(req.params.id);

  db.run(
    "DELETE FROM notification_deliveries WHERE id = ? AND user_id = ?",
    [id, userId],
    function (err) {
      if (err) return sendDbError(res, err);
      if (!this.changes) return res.status(404).send({ error: "Delivery not found" });
      res.send({ message: "Delivery deleted" });
    }
  );
});

app.delete("/notification-deliveries", (req, res) => {
  const userId = getUserScopedId(req);
  const status = String(req.query.status || "").trim();

  const clause = status ? "user_id = ? AND status = ?" : "user_id = ?";
  const values = status ? [userId, status] : [userId];

  db.run(`DELETE FROM notification_deliveries WHERE ${clause}`, values, function (err) {
    if (err) return sendDbError(res, err);
    res.send({ message: "Deliveries deleted", deleted: this.changes });
  });
});

app.get("/notification-provider-status", (req, res) => {
  res.send({
    mode: ENABLE_WEBHOOK_DELIVERY && WEBHOOK_DELIVERY_URL ? "webhook" : "local",
    webhookConfigured: Boolean(WEBHOOK_DELIVERY_URL),
    webhookEnabled: ENABLE_WEBHOOK_DELIVERY,
    timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS
  });
});

app.get("/digest-preview", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.query.month || getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return sendDbError(res, err);

    db.get(
      "SELECT enabled, interval_minutes, next_run_at, channels FROM digest_jobs WHERE user_id = ?",
      [userId],
      (scheduleErr, row) => {
        if (scheduleErr) return sendDbError(res, scheduleErr);
        res.send({
          month,
          summary,
          schedule: {
            enabled: row ? Boolean(row.enabled) : false,
            intervalMinutes: row ? Number(row.interval_minutes || 1440) : 1440,
            nextRunAt: row ? row.next_run_at : null,
            channels: row ? decodeChannels(row.channels) : ["in_app"]
          }
        });
      }
    );
  });
});

app.post("/digest/run-now", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.body.month || getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return sendDbError(res, err);

    saveReportSnapshot(userId, month, summary, saveErr => {
      if (saveErr) return sendDbError(res, saveErr);

      db.get(
        "SELECT enabled, interval_minutes, channels FROM digest_jobs WHERE user_id = ?",
        [userId],
        (scheduleErr, row) => {
          if (scheduleErr) return sendDbError(res, scheduleErr);

          const channels = row ? decodeChannels(row.channels) : ["in_app"];
          recordNotificationDeliveries(
            userId,
            channels,
            `EcoWatt digest for ${month}`,
            `Total units ${summary.totalUnits.toFixed(2)}, cost INR ${summary.cost.toFixed(2)}, budget delta INR ${summary.budgetDelta.toFixed(2)}`,
            deliveryErr => {
              if (deliveryErr) return sendDbError(res, deliveryErr);

              const now = new Date().toISOString();
              if (!row) {
                return res.send({ message: "Digest executed", month, summary, channels });
              }

              const nextRunAt = row.enabled
                ? new Date(Date.now() + Number(row.interval_minutes || 1440) * 60000).toISOString()
                : null;

              db.run(
                "UPDATE digest_jobs SET last_run_at = ?, next_run_at = ? WHERE user_id = ?",
                [now, nextRunAt, userId],
                updateErr => {
                  if (updateErr) return sendDbError(res, updateErr);
                  res.send({ message: "Digest executed", month, summary, channels, nextRunAt });
                }
              );
            }
          );
        }
      );
    });
  });
});

app.get("/digest-jobs/status", (req, res) => {
  const userId = getUserScopedId(req);

  db.get(
    "SELECT enabled, interval_minutes, last_run_at, next_run_at, channels FROM digest_jobs WHERE user_id = ?",
    [userId],
    (err, row) => {
      if (err) return sendDbError(res, err);
      const now = Date.now();
      const nextTs = row && row.next_run_at ? Date.parse(row.next_run_at) : null;

      res.send({
        enabled: row ? Boolean(row.enabled) : false,
        intervalMinutes: row ? Number(row.interval_minutes || 1440) : 1440,
        lastRunAt: row ? row.last_run_at : null,
        nextRunAt: row ? row.next_run_at : null,
        channels: row ? decodeChannels(row.channels) : ["in_app"],
        dueInMinutes: nextTs ? Math.max(0, Math.ceil((nextTs - now) / 60000)) : null
      });
    }
  );
});

app.post("/digest-schedule/disable", (req, res) => {
  const userId = getUserScopedId(req);
  upsertDigestSchedule(userId, { enabled: false, intervalMinutes: 1440, channels: ["in_app"] }, err => {
    if (err) return sendDbError(res, err);
    getDigestSchedule(userId, (scheduleErr, schedule) => {
      if (scheduleErr) return sendDbError(res, scheduleErr);
      res.send({ message: "Digest schedule disabled", schedule });
    });
  });
});

app.post("/digest-schedule/enable", (req, res) => {
  const userId = getUserScopedId(req);
  const intervalMinutes = Number(req.body && req.body.intervalMinutes ? req.body.intervalMinutes : 1440);
  const channels = req.body && req.body.channels ? req.body.channels : ["in_app"];

  upsertDigestSchedule(userId, { enabled: true, intervalMinutes, channels }, err => {
    if (err) return sendDbError(res, err);
    getDigestSchedule(userId, (scheduleErr, schedule) => {
      if (scheduleErr) return sendDbError(res, scheduleErr);
      res.send({ message: "Digest schedule enabled", schedule });
    });
  });
});

app.get("/forecast-advanced/what-if", (req, res) => {
  const userId = getUserScopedId(req);
  const days = req.query.days || 30;
  const deltaPercent = clampNumber(Number(req.query.deltaPercent) || 0, -50, 100);

  buildAdvancedForecast(userId, days, (err, forecast) => {
    if (err) return sendDbError(res, err);

    const factor = 1 + deltaPercent / 100;
    const scenarioDaily = (forecast.dailyForecast || []).map(item => ({
      day: item.day,
      units: Math.max(0, item.units * factor)
    }));
    const scenarioUnits = scenarioDaily.reduce((sum, row) => sum + row.units, 0);

    db.all("SELECT * FROM tariff", [], (tariffErr, slabs) => {
      if (tariffErr) return sendDbError(res, tariffErr);
      const scenarioCost = computeSlabCost(scenarioUnits, slabs);

      res.send({
        deltaPercent,
        baseline: {
          units: forecast.forecastUnits,
          cost: forecast.forecastCost
        },
        scenario: {
          units: scenarioUnits,
          cost: scenarioCost,
          budgetDelta: forecast.budget - scenarioCost,
          dailyForecast: scenarioDaily
        }
      });
    });
  });
});

app.get("/forecast-risk", (req, res) => {
  const userId = getUserScopedId(req);
  const days = req.query.days || 30;

  buildAdvancedForecast(userId, days, (err, forecast) => {
    if (err) return sendDbError(res, err);

    let risk = "low";
    if (forecast.budgetDelta < 0 || forecast.confidence < 65) risk = "high";
    else if (forecast.confidence < 78 || forecast.growthRate > 0.08) risk = "medium";

    res.send({
      risk,
      confidence: forecast.confidence,
      budgetDelta: forecast.budgetDelta,
      growthRate: forecast.growthRate,
      variance: forecast.variance
    });
  });
});

app.get("/forecast-trend-score", (req, res) => {
  const userId = getUserScopedId(req);
  const days = req.query.days || 30;

  buildAdvancedForecast(userId, days, (err, forecast) => {
    if (err) return sendDbError(res, err);

    const trendScore = clampNumber(
      Math.round(50 + forecast.growthRate * 140 - Math.min(forecast.variance * 1.5, 20)),
      0,
      100
    );

    res.send({ trendScore, growthRate: forecast.growthRate, variance: forecast.variance });
  });
});

app.get("/forecast-weekday-profile", (req, res) => {
  const userId = getUserScopedId(req);
  const days = req.query.days || 30;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  buildAdvancedForecast(userId, days, (err, forecast) => {
    if (err) return sendDbError(res, err);
    const profile = (forecast.weekdayProfile || []).map(row => ({
      weekday: row.weekday,
      weekdayName: names[row.weekday] || String(row.weekday),
      units: row.units
    }));
    res.send({ profile });
  });
});

app.get("/forecast-savings-plan", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT a.name, SUM((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     GROUP BY a.id
     ORDER BY units DESC
     LIMIT 3`,
    [userId, userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const plan = rows.map((row, idx) => ({
        appliance: row.name,
        currentUnits: Number(row.units || 0),
        suggestedReductionPercent: 8 + idx * 4,
        estimatedMonthlySavingsINR: Number(row.units || 0) * (5 + idx)
      }));

      res.send({
        plan,
        note: "Estimated savings are modeled projections based on current usage and tariff behavior."
      });
    }
  );
});

app.get("/alerts/summary", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT type, acknowledged, COUNT(*) AS count
     FROM alerts
     WHERE user_id = ?
     GROUP BY type, acknowledged`,
    [userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const byType = {};
      let total = 0;
      let acknowledged = 0;
      let pending = 0;

      rows.forEach(row => {
        const count = Number(row.count || 0);
        total += count;
        byType[row.type] = (byType[row.type] || 0) + count;
        if (Number(row.acknowledged) === 1) acknowledged += count;
        else pending += count;
      });

      res.send({ total, acknowledged, pending, byType });
    }
  );
});

app.post("/alerts/ack-all", (req, res) => {
  const userId = getUserScopedId(req);
  db.run("UPDATE alerts SET acknowledged = 1 WHERE user_id = ? AND acknowledged = 0", [userId], function (err) {
    if (err) return sendDbError(res, err);
    res.send({ message: "All alerts acknowledged", updated: this.changes });
  });
});

app.delete("/alerts/:id", (req, res) => {
  const userId = getUserScopedId(req);
  const id = Number(req.params.id);

  db.run("DELETE FROM alerts WHERE id = ? AND user_id = ?", [id, userId], function (err) {
    if (err) return sendDbError(res, err);
    if (!this.changes) return res.status(404).send({ error: "Alert not found" });
    res.send({ message: "Alert deleted" });
  });
});

app.delete("/alerts", (req, res) => {
  const userId = getUserScopedId(req);
  const acknowledged = req.query.acknowledged;

  if (acknowledged === undefined) {
    db.run("DELETE FROM alerts WHERE user_id = ?", [userId], function (err) {
      if (err) return sendDbError(res, err);
      res.send({ message: "Alerts deleted", deleted: this.changes });
    });
    return;
  }

  const ackValue = String(acknowledged) === "1" || String(acknowledged).toLowerCase() === "true" ? 1 : 0;
  db.run("DELETE FROM alerts WHERE user_id = ? AND acknowledged = ?", [userId, ackValue], function (err) {
    if (err) return sendDbError(res, err);
    res.send({ message: "Alerts deleted", deleted: this.changes, acknowledged: Boolean(ackValue) });
  });
});

app.get("/sustainability", (req, res) => {
  const userId = getUserScopedId(req);
  const emissionFactorKgPerUnit = clampNumber(Number(req.query.emissionFactor) || 0.82, 0.1, 2.5);

  db.all(
    `SELECT a.power, u.hours
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?`,
    [userId, userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const totalUnits = rows.reduce((sum, row) => sum + (row.power * row.hours) / 1000, 0);
      const co2Kg = totalUnits * emissionFactorKgPerUnit;

      res.send({
        totalUnits,
        emissionFactorKgPerUnit,
        co2Kg,
        co2Tonnes: co2Kg / 1000,
        treesNeededToOffsetPerYear: Number((co2Kg / 21).toFixed(2))
      });
    }
  );
});

app.get("/health/extended", (req, res) => {
  db.get("SELECT COUNT(*) AS users FROM users", [], (usersErr, usersRow) => {
    if (usersErr) return sendDbError(res, usersErr);

    db.get("SELECT COUNT(*) AS appliances FROM appliances", [], (appErr, appRow) => {
      if (appErr) return sendDbError(res, appErr);

      db.get("SELECT COUNT(*) AS usageEntries FROM usage", [], (usageErr, usageRow) => {
        if (usageErr) return sendDbError(res, usageErr);

        db.get("SELECT COUNT(*) AS alerts FROM alerts", [], (alertsErr, alertsRow) => {
          if (alertsErr) return sendDbError(res, alertsErr);
          res.send({
            status: "ok",
            version: "v1",
            uptime: process.uptime(),
            db: {
              users: Number(usersRow.users || 0),
              appliances: Number(appRow.appliances || 0),
              usageEntries: Number(usageRow.usageEntries || 0),
              alerts: Number(alertsRow.alerts || 0)
            },
            timestamp: new Date().toISOString()
          });
        });
      });
    });
  });
});

app.get("/metrics/overview", (req, res) => {
  const userId = getUserScopedId(req);

  db.get("SELECT COUNT(*) AS appliances FROM appliances WHERE user_id = ?", [userId], (appErr, appRow) => {
    if (appErr) return sendDbError(res, appErr);

    db.get("SELECT COUNT(*) AS usageEntries FROM usage WHERE user_id = ?", [userId], (usageErr, usageRow) => {
      if (usageErr) return sendDbError(res, usageErr);

      db.get(
        "SELECT COUNT(*) AS failedDeliveries FROM notification_deliveries WHERE user_id = ? AND status = 'failed'",
        [userId],
        (deliveryErr, deliveryRow) => {
          if (deliveryErr) return sendDbError(res, deliveryErr);

          db.get(
            "SELECT COUNT(*) AS pendingAlerts FROM alerts WHERE user_id = ? AND acknowledged = 0",
            [userId],
            (alertErr, alertRow) => {
              if (alertErr) return sendDbError(res, alertErr);

              db.get(
                "SELECT budget FROM user_budgets WHERE user_id = ? AND month = ?",
                [userId, getCurrentMonthKey()],
                (budgetErr, budgetRow) => {
                  if (budgetErr) return sendDbError(res, budgetErr);

                  res.send({
                    appliances: Number(appRow.appliances || 0),
                    usageEntries: Number(usageRow.usageEntries || 0),
                    failedDeliveries: Number(deliveryRow.failedDeliveries || 0),
                    pendingAlerts: Number(alertRow.pendingAlerts || 0),
                    currentBudget: Number(budgetRow ? budgetRow.budget : 2000),
                    generatedAt: new Date().toISOString()
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

app.post("/notification-deliveries/test", (req, res) => {
  const userId = getUserScopedId(req);
  const channels = normalizeDeliveryChannels(req.body && req.body.channels ? req.body.channels : ["in_app"]);
  const subject = String(req.body && req.body.subject ? req.body.subject : "EcoWatt test notification");
  const message = String(req.body && req.body.message ? req.body.message : "This is a delivery test from EcoWatt.");

  recordNotificationDeliveries(userId, channels, subject, message, (err, rows) => {
    if (err) return sendDbError(res, err);
    res.send({ message: "Notification test sent", deliveries: rows });
  });
});

app.get("/digest-schedule", (req, res) => {
  const userId = getUserScopedId(req);

  getDigestSchedule(userId, (err, schedule) => {
    if (err) return sendDbError(res, err);
    res.send(schedule);
  });
});

app.post("/digest-schedule", (req, res) => {
  const enabled = Boolean(req.body && req.body.enabled);
  const intervalMinutes = Number(req.body && req.body.intervalMinutes ? req.body.intervalMinutes : 1440);
  const channels = req.body && req.body.channels ? req.body.channels : ["in_app"];

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 15) {
    return res.status(400).send({ error: "Interval minutes must be at least 15" });
  }

  const userId = getUserScopedId(req);
  upsertDigestSchedule(userId, { enabled, intervalMinutes, channels }, err => {
    if (err) return sendDbError(res, err);
    getDigestSchedule(userId, (scheduleErr, schedule) => {
      if (scheduleErr) return sendDbError(res, scheduleErr);
      res.send({ message: "Digest schedule updated", schedule });
    });
  });
});

app.post("/notification-preferences", (req, res) => {
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send({ error: "Invalid notification preferences" });
  }

  const userId = getUserScopedId(req);
  const browser = parsed.data.browser === false ? 0 : 1;
  const inApp = parsed.data.inApp === false ? 0 : 1;

  db.run(
    `INSERT INTO notification_preferences (user_id, browser, in_app) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET browser = excluded.browser, in_app = excluded.in_app`,
    [userId, browser, inApp],
    err => {
      if (err) return sendDbError(res, err);
      res.send({ message: "Notification preferences updated", browser: Boolean(browser), inApp: Boolean(inApp) });
    }
  );
});

app.get("/appliances/search", (req, res) => {
  const userId = getUserScopedId(req);
  const query = String(req.query.q || "").trim();

  db.all(
    `SELECT id, name, power, category
     FROM appliances
     WHERE user_id = ?
       AND (? = '' OR name LIKE ? OR category LIKE ?)
     ORDER BY id DESC`,
    [userId, query, `%${query}%`, `%${query}%`],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.send(rows);
    }
  );
});

app.post("/alerts/:id/ack", (req, res) => {
  const userId = getUserScopedId(req);
  const id = Number(req.params.id);

  db.run(
    "UPDATE alerts SET acknowledged = 1 WHERE id = ? AND user_id = ?",
    [id, userId],
    err => {
      if (err) return sendDbError(res, err);
      res.send({ message: "Alert acknowledged" });
    }
  );
});

// Add appliance
app.post("/add-appliance", (req, res) => {
  const parsed = addApplianceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send({ error: "Invalid appliance input" });
  }
  const { name, power, category } = parsed.data;
  const userId = getUserScopedId(req);

  db.run(
    "INSERT INTO appliances (name, power, category, user_id) VALUES (?, ?, ?, ?)",
    [name.trim(), Number(power), (category || "General").trim(), userId],
    function (err) {
      if (err) return sendDbError(res, err);
      res.send({ message: "Appliance added!", id: this.lastID, name: name.trim(), category: (category || "General").trim() });
    }
  );
});

app.put("/appliances/:id", (req, res) => {
  const userId = getUserScopedId(req);
  const parsed = updateApplianceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send({ error: "Invalid appliance update" });
  }

  const id = Number(req.params.id);
  const fields = [];
  const values = [];

  if (parsed.data.name) {
    fields.push("name = ?");
    values.push(parsed.data.name.trim());
  }
  if (parsed.data.category) {
    fields.push("category = ?");
    values.push(parsed.data.category.trim());
  }
  if (parsed.data.power !== undefined) {
    fields.push("power = ?");
    values.push(Number(parsed.data.power));
  }

  if (!fields.length) {
    return res.status(400).send({ error: "No appliance changes provided" });
  }

  values.push(id, userId);

  db.run(
    `UPDATE appliances SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    values,
    function (err) {
      if (err) return sendDbError(res, err);
      if (!this.changes) return res.status(404).send({ error: "Appliance not found" });
      res.send({ message: "Appliance updated" });
    }
  );
});

app.delete("/appliances/:id", (req, res) => {
  const userId = getUserScopedId(req);
  const id = Number(req.params.id);

  db.run(
    "DELETE FROM appliances WHERE id = ? AND user_id = ?",
    [id, userId],
    function (err) {
      if (err) return sendDbError(res, err);
      if (!this.changes) return res.status(404).send({ error: "Appliance not found" });
      db.run("DELETE FROM usage WHERE appliance_id = ? AND user_id = ?", [id, userId]);
      res.send({ message: "Appliance deleted" });
    }
  );
});

// Add usage
app.post("/add-usage", (req, res) => {
  const parsed = addUsageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send({ error: "Invalid usage input" });
  }
  const { appliance_id, hours, date } = parsed.data;
  const userId = getUserScopedId(req);

  db.run(
    "INSERT INTO usage (appliance_id, hours, date, user_id) VALUES (?, ?, ?, ?)",
    [Number(appliance_id), Number(hours), date || new Date().toISOString(), userId],
    function (err) {
      if (err) return sendDbError(res, err);
      res.send({ message: "Usage added!" });
    }
  );
});

app.get("/appliances", (req, res) => {
  const userId = getUserScopedId(req);
  db.all("SELECT id, name, power, category FROM appliances WHERE user_id = ? ORDER BY id DESC", [userId], (err, rows) => {
    if (err) return sendDbError(res, err);
    res.send(rows);
  });
});

app.get("/category-analytics", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT a.name, a.category, a.power, u.hours
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?`,
    [userId, userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const breakdown = calculateCategoryBreakdown(rows);
      const categories = Object.keys(breakdown)
        .sort((a, b) => breakdown[b] - breakdown[a])
        .map(name => ({ name, units: breakdown[name] }));

      res.send({ categories });
    }
  );
});

app.get("/usage-history", (req, res) => {
  const userId = getUserScopedId(req);
  const start = req.query.start || null;
  const end = req.query.end || null;

  fetchScopedUsageRows({ userId, start, end }, (err, rows) => {
    if (err) return sendDbError(res, err);
    res.send(rows.map(row => ({
      name: row.name,
      category: row.category || "General",
      power: row.power,
      hours: row.hours,
      date: row.date,
      units: (row.power * row.hours) / 1000
    })));
  });
});

app.get("/simulate", (req, res) => {
  const userId = getUserScopedId(req);
  const applianceId = Number(req.query.appliance_id);
  const hours = Number(req.query.hours);

  if (!Number.isFinite(applianceId) || applianceId <= 0 || !Number.isFinite(hours) || hours <= 0) {
    return res.status(400).send({ error: "Invalid simulation input" });
  }

  db.get(
    "SELECT id, name, power, category FROM appliances WHERE id = ? AND user_id = ?",
    [applianceId, userId],
    (err, appliance) => {
      if (err) return sendDbError(res, err);
      if (!appliance) return res.status(404).send({ error: "Appliance not found" });

      db.all(
        `SELECT a.name, a.power, u.hours, u.date FROM usage u
         JOIN appliances a ON u.appliance_id = a.id
         WHERE a.user_id = ? AND u.user_id = ?`,
        [userId, userId],
        (usageErr, rows) => {
          if (usageErr) return sendDbError(res, usageErr);

          const unitsToAdd = (appliance.power * hours) / 1000;
          const currentUnits = rows.reduce((sum, row) => sum + (row.power * row.hours) / 1000, 0);
          const simulatedUnits = currentUnits + unitsToAdd;

          db.all("SELECT * FROM tariff", [], (tariffErr, slabs) => {
            if (tariffErr) return sendDbError(res, tariffErr);

            const currentCost = computeSlabCost(currentUnits, slabs);
            const simulatedCost = computeSlabCost(simulatedUnits, slabs);

            res.send({
              appliance,
              hours,
              unitsToAdd,
              currentUnits,
              simulatedUnits,
              currentCost,
              simulatedCost,
              difference: simulatedCost - currentCost
            });
          });
        }
      );
    }
  );
});

app.get("/monthly-summary", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.query.month || getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return sendDbError(res, err);
    saveReportSnapshot(userId, month, summary, saveErr => {
      if (saveErr) console.error(saveErr);
      res.send(summary);
    });
  });
});

app.get("/forecast-explanation", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.query.month || getCurrentMonthKey();

  summarizeForecastExplanation(userId, month, (err, payload) => {
    if (err) return sendDbError(res, err);
    res.send(payload);
  });
});

app.get("/forecast-advanced", (req, res) => {
  const userId = getUserScopedId(req);
  const days = req.query.days || 30;

  buildAdvancedForecast(userId, days, (err, forecast) => {
    if (err) return sendDbError(res, err);
    res.send(forecast);
  });
});

app.get("/report-history", (req, res) => {
  const userId = getUserScopedId(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

  db.all(
    `SELECT id, month, total_units, cost, budget, budget_delta, top_appliance, created_at
     FROM report_snapshots
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.send(rows);
    }
  );
});

app.post("/digest", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.body.month || getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return sendDbError(res, err);
    saveReportSnapshot(userId, month, summary, saveErr => {
      if (saveErr) return sendDbError(res, saveErr);
      res.send({
        message: "Digest generated",
        month,
        summary
      });
    });
  });
});

app.get("/report", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT a.name, a.category, a.power, u.hours, u.date
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     ORDER BY u.date DESC`,
    [userId, userId],
    (err, usageRows) => {
      if (err) return sendDbError(res, err);

      db.all("SELECT * FROM tariff", [], (tariffErr, slabs) => {
        if (tariffErr) return sendDbError(res, tariffErr);

        const totalUnits = usageRows.reduce((sum, row) => sum + (row.power * row.hours) / 1000, 0);
        const categoryBreakdown = calculateCategoryBreakdown(usageRows);
        const cost = computeSlabCost(totalUnits, slabs);
        const rows = usageRows.map(row => ({
          name: row.name,
          category: row.category || "General",
          power: row.power,
          hours: row.hours,
          date: row.date,
          units: (row.power * row.hours) / 1000
        }));

        res.send({
          generatedAt: new Date().toISOString(),
          totalUnits,
          cost,
          categoryBreakdown,
          rows
        });
      });
    }
  );
});

app.get("/report.csv", (req, res) => {
  const userId = getUserScopedId(req);

  db.all(
    `SELECT a.name, a.category, a.power, u.hours, u.date,
            ((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     ORDER BY u.date DESC`,
    [userId, userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="ecowatt-report.csv"');
      res.send(toCsv(rows));
    }
  );
});

app.get("/report.pdf", (req, res) => {
  const userId = getUserScopedId(req);
  const month = req.query.month || getCurrentMonthKey();

  aggregateMonthlySummary(userId, month, (err, summary) => {
    if (err) return sendDbError(res, err);

    fetchScopedUsageRows({ userId, month }, (usageErr, rows) => {
      if (usageErr) return sendDbError(res, usageErr);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="ecowatt-report.pdf"');
      doc.pipe(res);

      doc.fontSize(20).text("EcoWatt Monthly Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Month: ${month}`);
      doc.text(`Total Units: ${summary.totalUnits.toFixed(2)}`);
      doc.text(`Cost: INR ${summary.cost.toFixed(2)}`);
      doc.text(`Budget: INR ${summary.budget.toFixed(2)}`);
      doc.text(`Budget Delta: INR ${summary.budgetDelta.toFixed(2)}`);
      doc.text(`Top Appliance: ${summary.topAppliance || "N/A"}`);
      doc.moveDown();
      doc.text("Usage Breakdown:");
      Object.entries(summary.categoryBreakdown || {}).forEach(([name, units]) => {
        doc.text(`- ${name}: ${Number(units).toFixed(2)} units`);
      });

      doc.moveDown();
      doc.text("Recent Usage:");
      rows.slice(0, 20).forEach(row => {
        doc.text(`- ${row.name} | ${row.category || "General"} | ${Number((row.power * row.hours) / 1000).toFixed(2)} units | ${String(row.date).slice(0, 10)}`);
      });

      doc.end();
    });
  });
});

app.get("/budget", (req, res) => {
  const month = req.query.month || getCurrentMonthKey();
  const userId = getUserScopedId(req);

  db.get("SELECT budget FROM user_budgets WHERE user_id = ? AND month = ?", [userId, month], (err, row) => {
    if (err) return sendDbError(res, err);
    res.send({ month, budget: row ? row.budget : 2000 });
  });
});

app.post("/set-budget", (req, res) => {
  const parsed = setBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send({ error: "Budget must be a positive number" });
  }
  const month = parsed.data.month || getCurrentMonthKey();
  const budget = Number(parsed.data.budget);
  const userId = getUserScopedId(req);

  db.run(
    `INSERT INTO user_budgets (user_id, month, budget) VALUES (?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET budget = excluded.budget`,
    [userId, month, budget],
    err => {
      if (err) return sendDbError(res, err);
      res.send({ message: "Budget updated", month, budget });
    }
  );
});

// Calculate bill
app.get("/calculate", (req, res) => {
  const userId = getUserScopedId(req);
  db.all(
    `SELECT a.name, a.power, u.hours, u.date FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?`,
    [userId, userId],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      let totalUnits = 0;
      let breakdown = {};
      const uniqueDays = new Set();

      rows.forEach(r => {
        let units = (r.power * r.hours) / 1000;
        totalUnits += units;

        if (!breakdown[r.name]) breakdown[r.name] = 0;
        breakdown[r.name] += units;

        const day = String(r.date).slice(0, 10);
        if (day) {
          uniqueDays.add(day);
        }
      });

      db.all("SELECT * FROM tariff", [], (err, slabs) => {
        if (err) return sendDbError(res, err);

        const daysTracked = Math.max(uniqueDays.size, 1);
        const averageDailyUnits = totalUnits / daysTracked;
        const predictedUnits = averageDailyUnits * 30;
        const cost = computeSlabCost(totalUnits, slabs);
        const predictedCost = computeSlabCost(predictedUnits, slabs);

        const month = getCurrentMonthKey();
        db.get("SELECT budget FROM user_budgets WHERE user_id = ? AND month = ?", [userId, month], (budgetErr, budgetRow) => {
          if (budgetErr) return sendDbError(res, budgetErr);

          const budget = budgetRow ? budgetRow.budget : 2000;

          let warning = "";
          if (predictedCost > budget) {
            warning = "Warning: You may exceed your budget!";
            addAlert(userId, "budget", warning);
          }

          let suggestion = "You are using energy efficiently.";
          if ((breakdown.AC || 0) > 50) {
            suggestion = "Try reducing AC usage.";
          }

          const allTips = readTips();
          const recommendedTips = pickTips(allTips, 3);

          const topAppliance = Object.keys(breakdown).sort((a, b) => breakdown[b] - breakdown[a])[0] || null;

          if (topAppliance && (breakdown[topAppliance] || 0) > 20) {
            addAlert(userId, "usage", `High usage detected for ${topAppliance}`);
          }

          detectAnomalies(userId, (anomalyErr, anomalies) => {
            if (anomalyErr) return sendDbError(res, anomalyErr);

            anomalies.slice(0, 3).forEach(anomaly => {
              addAlert(userId, "anomaly", `Anomalous usage on ${anomaly.day}: ${anomaly.units.toFixed(2)} units`);
            });

            res.send({
              totalUnits,
              cost,
              predictedUnits,
              predictedCost,
              averageDailyUnits,
              daysTracked,
              budget,
              budgetDelta: budget - predictedCost,
              topAppliance,
              breakdown,
              warning,
              suggestion,
              recommendedTips,
              anomalies
            });
          });
        });
      });
    }
  );
});

app.get("/usage-trend", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
  const offset = `-${days - 1} day`;
  const userId = getUserScopedId(req);

  db.all(
    `SELECT date(u.date) AS day, SUM((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ? AND date(u.date) >= date('now', ?)
     GROUP BY date(u.date)
     ORDER BY day`,
    [userId, userId, offset],
    (err, rows) => {
      if (err) return sendDbError(res, err);

      const lookup = {};
      rows.forEach(r => {
        lookup[r.day] = Number(r.units || 0);
      });

      const trend = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const day = d.toISOString().slice(0, 10);
        trend.push({ day, units: lookup[day] || 0 });
      }

      res.send({ days, trend });
    }
  );
});

app.get("/top-appliances", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
  const userId = getUserScopedId(req);

  db.all(
    `SELECT a.name, SUM((a.power * u.hours) / 1000.0) AS units
     FROM usage u
     JOIN appliances a ON u.appliance_id = a.id
     WHERE a.user_id = ? AND u.user_id = ?
     GROUP BY a.id
     ORDER BY units DESC
     LIMIT ?`,
    [userId, userId, limit],
    (err, rows) => {
      if (err) return sendDbError(res, err);
      res.send(rows);
    }
  );
});

app.get("/data", (req, res) => {
  const userId = getUserScopedId(req);
  db.all("SELECT * FROM appliances WHERE user_id = ?", [userId], (err, appliances) => {
    if (err) return sendDbError(res, err);

    db.all("SELECT * FROM usage WHERE user_id = ?", [userId], (err, usage) => {
      if (err) return sendDbError(res, err);

      res.json({
        appliances,
        usage
      });
    });
  });
});

app.get("/tips", (req, res) => {
  const tips = readTips();
  res.send(tips);
});

app.get("/version", (req, res) => {
  res.send({
    service: "EcoWatt",
    version: "v1",
    features: [
      "health-checks",
      "rate-limiting",
      "input-validation",
      "budget-forecasting",
      "usage-trends",
      "top-appliance-analytics",
      "tip-recommendations",
      "scheduled-digests",
      "notification-deliveries",
      "advanced-forecasting",
      "delivery-retries",
      "forecast-risk-scoring",
      "bulk-alert-management",
      "sustainability-metrics",
      "extended-health-metrics"
    ]
  });
});

app.get("/api-docs", (req, res) => {
  res.send({
    version: "v1",
    routes: [
      "/health",
      "/ready",
      "/version",
      "/calculate",
      "/forecast-advanced",
      "/forecast-advanced/what-if",
      "/forecast-risk",
      "/forecast-explanation",
      "/budget",
      "/digest-schedule",
      "/digest-preview",
      "/digest/run-now",
      "/set-budget",
      "/appliances",
      "/notification-deliveries",
      "/notification-deliveries/stats",
      "/usage-trend",
      "/alerts/summary",
      "/sustainability",
      "/metrics/overview",
      "/top-appliances",
      "/tips",
      "/data"
    ],
    note: "All routes are also available under /api/v1/..."
  });
});

app.use((req, res, next) => {
  const hasExtension = Boolean(path.extname(req.path));

  if (req.method === "GET" && !req.path.startsWith("/api/") && !hasExtension) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  return next();
});

app.use((req, res) => {
  res.status(404).send({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  res.status(500).send({
    error: "Unexpected server error",
    requestId: req.requestId
  });
});

if (require.main === module) {
  startDigestScheduler();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;