# EcoWatt Diagrams

SVG image files are ready here:

- [Architecture Diagram](diagrams/architecture.svg)
- [Data Flow Diagram](diagrams/data-flow.svg)
- [Functionality Map](diagrams/functionality-map.svg)
- [Relational Schema](diagrams/relational-schema.svg)

## 1) Data Flow Diagram

```mermaid
flowchart LR
  U[User in browser] --> UI[Public frontend\nindex.html + script.js]
  UI -->|REST calls| API[Express app\nserver.js]
  API --> MW[Security + middleware\nhelmet, cors, rate limit, auth, logging]
  MW --> ROUTES[Route handlers\n/register /login /add-appliance /add-usage /calculate /forecast /digest /alerts]

  ROUTES --> DB[(SQLite database.db)]
  ROUTES --> TIPS[tips.json]
  ROUTES --> PDF[PDFKit report generation]
  ROUTES --> CSV[CSV report export]

  DB --> ROUTES
  TIPS --> ROUTES
  PDF --> U
  CSV --> U
  ROUTES --> UI

  subgraph Key backend outputs
    ALERTS[Alerts and anomalies]
    SUMMARY[Monthly summary and budget delta]
    FORECAST[Forecast and what-if results]
    OPS[Notification delivery and digest operations]
  end

  ROUTES --> ALERTS
  ROUTES --> SUMMARY
  ROUTES --> FORECAST
  ROUTES --> OPS
```

## 2) Functionality Diagram

```mermaid
mindmap
  root((EcoWatt))
    Authentication
      Register
      Login
      Guest mode
      JWT session token
    Energy Tracking
      Add appliance
      Add usage
      Search appliances
      Usage history
      Monthly summary
      Budget set/get
      Bill calculation
    Forecasting
      Forecast explanation
      Advanced forecast
      What-if simulation
      Risk score
      Trend score
      Weekday profile
      Savings plan
    Notifications
      Notification preferences
      Alerts list
      Acknowledge alert
      Bulk acknowledge/delete
      Anomaly detection
    Operations
      Digest schedule
      Run digest now
      Preview digest
      Delivery log
      Retry failed deliveries
      CSV export
      Provider status
    Analytics and Reports
      Category analytics
      Usage trend
      Top appliances
      Report page
      PDF export
      CSV export
      Sustainability metrics
      Health metrics
```

## 3) Relational Schema Diagram

```mermaid
erDiagram
  USERS {
    int id PK
    text email UK
    text password_hash
    text name
    text role
  }

  APPLIANCES {
    int id PK
    text name
    int power
    text category
    int user_id
  }

  USAGE {
    int id PK
    int appliance_id
    real hours
    text date
    int user_id
  }

  TARIFF {
    int id PK
    int min_units
    int max_units
    real rate
  }

  BUDGETS {
    int id PK
    text month UK
    real budget
  }

  USER_BUDGETS {
    int id PK
    int user_id
    text month
    real budget
  }

  ALERTS {
    int id PK
    int user_id
    text type
    text message
    text created_at
    int acknowledged
  }

  REPORT_SNAPSHOTS {
    int id PK
    int user_id
    text month
    real total_units
    real cost
    real budget
    real budget_delta
    text top_appliance
    text created_at
  }

  NOTIFICATION_PREFERENCES {
    int user_id PK
    int browser
    int in_app
  }

  DIGEST_JOBS {
    int user_id PK
    int enabled
    int interval_minutes
    text last_run_at
    text next_run_at
    text channels
  }

  NOTIFICATION_DELIVERIES {
    int id PK
    int user_id
    text channel
    text subject
    text message
    text status
    text created_at
    text sent_at
    text metadata
  }

  USERS ||--o{ APPLIANCES : owns
  USERS ||--o{ USAGE : records
  APPLIANCES ||--o{ USAGE : measured_in
  USERS ||--o{ ALERTS : receives
  USERS ||--o{ REPORT_SNAPSHOTS : saves
  USERS ||--|| NOTIFICATION_PREFERENCES : configures
  USERS ||--|| DIGEST_JOBS : schedules
  USERS ||--o{ NOTIFICATION_DELIVERIES : logs
  USERS ||--o{ USER_BUDGETS : sets
  BUDGETS ||--o{ USER_BUDGETS : default_month_budget
```

## Notes

- The schema is logical rather than strictly enforced with foreign-key constraints in SQLite.
- `user_id` is the main scoping key across the app.
- `usage.appliance_id` links usage rows to appliance rows for summaries, forecasts, and reports.