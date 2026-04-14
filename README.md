# EcoWatt - Smart Home Energy Optimizer

A smart home energy optimization system built with Node.js, Express, and SQLite.

## Overview

EcoWatt helps you monitor and optimize household energy consumption with real-time insights and smart recommendations to reduce electricity bills.

## Features

- Real-time energy monitoring dashboard
- Smart device management and scheduling
- Energy consumption analytics
- Optimization recommendations
- Progressive Web App (PWA) support
- Responsive mobile & desktop design

## Project Structure

```
├── public/              # Frontend (HTML, CSS, JS, PWA)
├── test/                # Test suite (Jest, Playwright)
├── diagrams/            # Architecture diagrams (Mermaid)
├── server.js            # Express backend
├── database.db          # SQLite database
└── package.json         # Dependencies
```

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript, PWA
- **Backend:** Node.js, Express.js
- **Database:** SQLite
- **Testing:** Playwright, Jest

## Installation

### Prerequisites
- Node.js v16+
- npm

### Setup

1. Clone the repository:
```bash
git clone https://github.com/SATVIK-PANDEY-MITB/Smart-Home-Energy-Optimizer-DBS-Project.git
cd EcoWatt
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
```

4. Start the application:
```bash
npm start
```

5. Open in browser: `http://localhost:3000`

## Development

Start development server with auto-reload:
```bash
npm run dev
```

## Testing

Run all tests:
```bash
npm test
```

Run specific test suites:
```bash
npm run test:backend      # Backend tests
npm run test:frontend     # Frontend E2E tests
```

## License

MIT License

## Author

**Satvik Pandey** - [GitHub](https://github.com/SATVIK-PANDEY-MITB)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/your-feature`)
5. Open a Pull Request
