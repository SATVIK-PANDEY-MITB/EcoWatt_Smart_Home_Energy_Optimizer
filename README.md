# EcoWatt — Smart Home Energy Optimizer

EcoWatt is a full-stack, database-driven energy management application for tracking household appliance usage, calculating electricity bills, forecasting future consumption, and notifying users about budget or usage anomalies.

The application combines a browser-based Progressive Web App with an Express API backed by SQLite. It provides authenticated user data isolation, hourly usage recording, tariff-based billing, affordability forecasts, scheduled digests, delivery tracking, and operational health endpoints.

## Product at a Glance

| Metric | Value |
| --- | ---: |
| Primary runtime | Node.js + Express 5 |
| Database | SQLite 6 with automatic schema migration |
| Frontend | HTML5, CSS3, JavaScript, SVG charts, PWA |
| Authentication | JWT, bcrypt, per-user data isolation |
| API version | v1 |
| API routes registered | 65+ |
| Default port | 3000 |
| Default JWT lifetime | 7 days |
| Default monthly budget | INR 2,000 |
| Default digest interval | 1,440 minutes (24 hours) |
| Forecast horizon | 7–90 days |
| Notification channels | in-app, push, email |
| Report formats | JSON, CSV, PDF |
| Default rate limit | 1,000 requests per 15 minutes |

## Key Features

- **Appliance management:** add, update, delete, search, and categorize appliances.
- **Usage tracking:** record appliance usage by date and duration, with power-to-energy conversion.
- **Bill calculation:** apply graduated tariffs: INR 5, INR 7, and INR 10 per unit in the configured slabs.
- **Monthly budgets:** store a per-user budget and calculate the budget delta.
- **Usage analytics:** show total units, category breakdowns, top appliances, daily trends, and 30-day summaries.
- **Forecasting:** generate 7–90 day forecasts using recent usage, weekday patterns, and trend growth.
- **What-if simulation:** estimate the impact of changing appliance runtime.
- **Risk and anomaly detection:** identify unusually high daily usage and forecast risk.
- **Report generation:** export JSON, CSV, and PDF reports.
- **Scheduled digests:** generate and deliver monthly summaries through configured channels.
- **Notification delivery center:** track delivery status, retry failed deliveries, and export delivery records.
- **Operational monitoring:** expose health, readiness, extended health, and metrics endpoints.
- **Security:** apply Helmet headers, CORS configuration, request IDs, rate limiting, input validation, JWT authentication, and per-user SQL isolation.
- **Progressive Web App:** installable frontend with cached assets and theme support.

## Technology Stack

### Backend

- Node.js
- Express 5
- SQLite 6
- JWT authentication
- bcryptjs password hashing
- Zod request validation
- Helmet security middleware
- Express rate limiting
- Morgan request logging
- PDFKit report generation

### Frontend

- Semantic HTML
- Responsive CSS
- Vanilla JavaScript
- SVG-based charts
- LocalStorage for API/base and theme preferences
- Service Worker and web manifest for PWA support

### Testing

- Node.js built-in test runner
- Supertest HTTP testing
- Playwright browser testing

## Architecture

```text
Browser / PWA
    |
    | HTTP + JWT
    v
Express API (server.js)
    |
    +-- Zod validation
    +-- Authentication and authorization
    +-- SQLite queries
    +-- Tariff, forecast, and alert logic
    +-- Notification delivery processing
    v
SQLite database (database.db)
```

The API automatically creates the required tables on startup. All authenticated requests are scoped by the authenticated user's ID, and the application defaults to a guest user when no token is supplied.

## Project Structure

```text
.
├── public/                     # Static frontend, styles, script, manifest, and service worker
├── diagrams/                   # Mermaid architecture and database diagrams
├── test/                       # Backend and Playwright test suites
├── server.js                   # Express application and database initialization
├── tips.json                   # Energy-saving recommendation dataset
├── package.json                # Runtime scripts and dependencies
├── package-lock.json           # Locked dependency versions
├── playwright.config.cjs       # Playwright configuration
├── database.db                 # Runtime SQLite database
└── README.md                   # Project documentation
```

## Requirements

- Node.js 18 or newer
- npm 9 or newer
- A supported browser for the frontend
- Port 3000 available for the local server

> The project does not require an external database service. SQLite uses a local file named `database.db`.

## Installation

1. Open a terminal in the project directory.
2. Install dependencies:

```bash
npm install
```

3. Start the application:

```bash
npm start
```

4. Visit the application at:

```text
http://localhost:3000
```

For development, the same server command is used because the project has no separate watch process:

```bash
npm run dev
```

## Environment Configuration

The application reads optional environment variables from a `.env` file. No `.env.example` file is currently included, so create `.env` manually if you need custom values.

```env
PORT=3000
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=replace-with-a-long-random-secret
ENABLE_WEBHOOK_DELIVERY=false
WEBHOOK_DELIVERY_URL=https://example.com/webhook
WEBHOOK_DELIVERY_TOKEN=replace-with-a-webhook-token
WEBHOOK_DELIVERY_TIMEOUT_MS=5000
```

### Security Notes

- Use a unique, long `JWT_SECRET` in production.
- Do not commit real credentials or tokens.
- Keep `ENABLE_WEBHOOK_DELIVERY` disabled unless a trusted webhook endpoint is configured.
- The default `JWT_SECRET` is only suitable for local development.
- Passwords are hashed with bcrypt before storage.

## Authentication

### Register

```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "user@example.com",
    "password": "Password123!"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "Password123!"
  }'
```

The response contains a JWT. Store it and send it as a bearer token for protected endpoints:

```bash
export TOKEN="your-jwt-token"
curl http://localhost:3000/me -H "Authorization: Bearer $TOKEN"
```

## Core API

All routes below are available on the main API base. The server also exposes the same routes under `/api/v1/`.

### Health and version

```http
GET /health
GET /ready
GET /version
GET /api-docs
```

### Authentication

```http
POST /register
POST /login
GET /me
```

### Appliances and usage

```http
GET /appliances
POST /add-appliance
PUT /appliances/:id
DELETE /appliances/:id
GET /appliances/search?q=fan
POST /add-usage
GET /usage-history?start=2026-01-01&end=2026-01-31
GET /category-analytics
```

### Energy calculation and reporting

```http
GET /calculate
GET /monthly-summary?month=2026-10
GET /usage-trend?days=7
GET /top-appliances?limit=5
GET /report
GET /report.csv
GET /report.pdf?month=2026-10
GET /report-history?limit=10
GET /simulate?appliance_id=1&hours=2
GET /forecast-explanation?month=2026-10
GET /forecast-advanced?days=30
GET /forecast-advanced/what-if?days=14&deltaPercent=-10
GET /forecast-risk?days=14
GET /forecast-trend-score
GET /forecast-weekday-profile
GET /forecast-savings-plan
```

### Budgets and alerts

```http
GET /budget?month=2026-10
POST /set-budget
GET /alerts
GET /alerts/summary
POST /alerts/:id/ack
POST /alerts/ack-all
DELETE /alerts/:id
DELETE /alerts?acknowledged=1
```

### Notifications and digests

```http
GET /notification-preferences
POST /notification-preferences
GET /notification-deliveries
GET /notification-deliveries/stats
GET /notification-deliveries.csv
POST /notification-deliveries/test
POST /notification-deliveries/:id/retry
POST /notification-deliveries/retry-failed
DELETE /notification-deliveries/:id
DELETE /notification-deliveries?status=failed
GET /notification-provider-status
GET /digest-preview
POST /digest/run-now
GET /digest-jobs/status
GET /digest-schedule
POST /digest-schedule
POST /digest-schedule/enable
POST /digest-schedule/disable
POST /digest
```

### Sustainability and operations

```http
GET /sustainability
GET /health/extended
GET /metrics/overview
GET /anomalies
GET /tips
GET /data
```

### Example: calculate a bill

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/calculate
```

Example response:

```json
{
  "totalUnits": 84.5,
  "cost": 491.5,
  "predictedUnits": 253.5,
  "predictedCost": 1723.5,
  "averageDailyUnits": 2.82,
  "daysTracked": 30,
  "budget": 2000,
  "budgetDelta": 276.5,
  "topAppliance": "Air Conditioner",
  "breakdown": {
    "Air Conditioner": 52.5,
    "Refrigerator": 18.0,
    "Lighting": 14.0
  },
  "warning": "",
  "suggestion": "You are using energy efficiently.",
  "recommendedTips": [],
  "anomalies": []
}
```

## Data Model

### Users

- `id`: internal numeric user ID
- `email`: unique email address
- `password_hash`: bcrypt hash
- `name`: display name
- `role`: user role

### Appliances

- `id`: appliance identifier
- `name`: appliance name
- `power`: power rating in watts
- `category`: appliance category
- `user_id`: owner of the appliance

### Usage

- `id`: usage record identifier
- `appliance_id`: linked appliance
- `hours`: consumption duration
- `date`: ISO date/time value
- `user_id`: owner of the record

### Billing

The tariff table uses slab pricing:

| Energy range | Rate |
| --- | ---: |
| 0–100 units | INR 5/unit |
| 101–200 units | INR 7/unit |
| 201+ units | INR 10/unit |

Units are computed as:

$$
\text{units} = \frac{\text{power (W)} \times \text{hours}}{1000}
$$

The application calculates cost from the total units using the configured tariff slabs.

## Forecasting

The advanced forecast uses the previous 60 days of daily usage and generates a forecast across a configurable horizon of 7–90 days.

The forecast includes:

- Recent 7-day and previous 7-day averages
- Growth rate measurement
- Daily variance calculation
- Weekday usage profile
- Seasonal baseline adjustment
- Forecasted units and cost
- Confidence score between 55% and 95%
- Peak forecast day
- Action-oriented recommendations

The forecast confidence is reduced by large changes in usage and variance. Values are bounded within 0.75× and 1.5× of the seasonal baseline to prevent unrealistic projections.

## Scheduled Digests

Scheduled digests are stored per user. The default interval is 1,440 minutes, the minimum supported interval is 15 minutes, and the maximum interval is 10,080 minutes.

Supported delivery channels:

- `in_app`
- `push`
- `email`

The visible frontend supports in-app, push, and email channels. Webhook delivery is available when `ENABLE_WEBHOOK_DELIVERY=true` and a valid webhook URL is configured.

## Testing

### Run the full test suite

```bash
npm test
```

### Run backend tests only

```bash
npm run test:backend
```

### Run frontend end-to-end tests

```bash
npm run test:frontend
```

### Check the server syntax

```bash
npm run check
```

### Test coverage by behavior

The backend suite verifies:

- health and readiness
- registration and login
- appliance CRUD operations
- usage recording and calculations
- monthly summaries and historical reports
- forecast explanation and PDF export
- scheduled digests
- delivery logging and retries
- provider status and CSV export
- what-if, risk, trend, weekday, savings, alert, sustainability, and metrics APIs
- bulk alert and delivery management

The frontend Playwright suite uses a 90-second browser timeout and starts the application on port 3000 through its configured web server.

## Development Commands

```bash
npm install        # install dependencies
npm start           # start the production server
npm run dev         # start the same server locally
npm run check       # validate server syntax
npm test            # run backend and frontend tests
npm run test:backend
npm run test:frontend
```

## Run and Validate Locally

```bash
npm install
npm run check
npm test
npm start
```

If port 3000 is already occupied by an older process, stop that process before starting the server. This is especially important when the API behavior has recently changed and an existing Node process still serves stale responses.

## Security and Reliability

- HTTP responses include a request ID.
- API version headers are included on requests.
- Security headers are applied by Helmet.
- API requests are rate-limited to 1,000 requests per 15-minute window.
- JWT tokens expire after seven days.
- Database errors are isolated from public responses while retaining technical details in the server logs.
- Input values are validated using Zod.
- Authentication is checked for every protected route.
- Notification webhook delivery has timeout and fallback handling.
- The application does not expose database credentials or secrets in the frontend.

## Known Operational Notes

- SQLite creates the local database automatically when the server starts.
- The database is persistent across server restarts.
- The frontend is served through the same Express process on port 3000.
- API calls are available through the frontend’s `api` query parameter or saved API base setting.
- Guest access is available for basic health and public tips endpoints.
- Authenticated users receive isolated appliance, usage, budget, alert, report, and delivery data.
- The service worker and browser cache may need to be cleared after frontend updates.

## Contributing

1. Create a focused feature branch:

```bash
git checkout -b feature/your-feature
```

2. Make a small, testable change.
3. Run the relevant test suite.
4. Update documentation when adding or changing endpoints.
5. Run the full test suite before submitting.
6. Open a pull request with a clear summary and test evidence.

### Suggested Contribution Workflow

```bash
npm run check
npm run test:backend
npm run test:frontend
```

## License

This project is licensed under the ISC License. See the package metadata for the license declaration.

## Project Status

EcoWatt is a functional, self-contained energy-management prototype suitable for local development, demonstrations, and coursework. Its current architecture prioritizes straightforward deployment and maintainability over container orchestration or cloud-managed infrastructure.

