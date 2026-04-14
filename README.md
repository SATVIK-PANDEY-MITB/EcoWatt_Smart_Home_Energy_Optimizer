# EcoWatt - Smart Home Energy Optimizer

![Node.js](https://img.shields.io/badge/Node.js-v20-green) ![License](https://img.shields.io/badge/license-MIT-blue) ![Status](https://img.shields.io/badge/status-Active-brightgreen)

## Overview

**EcoWatt** is a comprehensive Smart Home Energy Optimization system that monitors, analyzes, and optimizes household energy consumption. It provides real-time insights into your home's power usage and suggests intelligent optimization strategies to reduce energy waste and lower electricity bills.

## Features

### Core Functionality
- 🔌 **Real-time Energy Monitoring** - Track power consumption across all connected devices
- 📊 **Energy Analytics Dashboard** - Visualize consumption patterns and trends
- 🤖 **Smart Recommendations** - AI-driven suggestions for energy optimization
- 💡 **Device Management** - Control and schedule connected smart home devices
- 📈 **Historical Analysis** - Track consumption patterns over time
- ⚡ **Load Balancing** - Distribute power intelligently across devices
- 🔔 **Alert System** - Notifications for abnormal consumption patterns

### Advanced Features
- Frontend smoke testing with Playwright
- Progressive Web App (PWA) support with service worker
- Responsive design for mobile and desktop
- Data flow visualization and architecture documentation
- Comprehensive testing suite

## Project Structure

```
EcoWatt/
├── public/                 # Frontend static files & PWA
│   ├── index.html         # Main HTML file
│   ├── script.js          # Frontend JavaScript
│   ├── style.css          # Styling
│   ├── sw.js              # Service Worker
│   └── manifest.json      # PWA manifest
├── test/                  # Test suite
│   ├── ecowatt.test.js    # Backend tests
│   └── frontend-smoke.spec.js # Frontend E2E tests
├── diagrams/              # Documentation diagrams
│   ├── data-flow.mmd      # Data flow diagram
│   ├── functionality-map.mmd # Feature map
│   └── relational-schema.mmd # Database schema
├── server.js              # Express backend server
├── database.db            # SQLite database
├── package.json           # Node.js dependencies
├── playwright.config.cjs  # Playwright configuration
└── README.md             # This file
```

## Tech Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Responsive styling
- **JavaScript (ES6+)** - Interactive functionality
- **PWA** - Service Workers & Web Manifest

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **SQLite** - Database

### Testing
- **Playwright** - E2E testing & browser automation
- **Jest** - Unit testing framework

## Installation

### Prerequisites
- Node.js v16+ 
- npm or yarn
- Git

### Quick Start

1. **Clone the repository:**
```bash
git clone https://github.com/SATVIK-PANDEY-MITB/Smart-Home-Energy-Optimizer-DBS-Project.git
cd EcoWatt
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start the server:**
```bash
npm start
# Or for development with auto-reload:
npm run dev
```

5. **Access the application:**
Open your browser and navigate to `http://localhost:3000`

## Usage

### Dashboard Navigation
1. **Home** - Overview of current energy consumption
2. **Devices** - Manage connected smart home devices
3. **Analytics** - View detailed consumption reports
4. **Settings** - Configure alerts and preferences

### Energy Optimization Tips
- Set device schedules during off-peak hours
- Enable load balancing for simultaneous devices
- Review historical data to identify consumption patterns
- Configure alerts for abnormal usage
- Use device grouping for bulk control

## API Endpoints

### Core Endpoints
- `GET /api/devices` - Get all devices
- `POST /api/devices` - Create a new device
- `GET /api/consumption` - Get consumption data
- `POST /api/recommendations` - Get optimization suggestions
- `GET /api/analytics` - Get analytics report

## Testing

### Run All Tests
```bash
npm test
```

### Run Specific Test Suite
```bash
# Backend tests
npm run test:backend

# Frontend E2E tests
npm run test:frontend
```

### Coverage Report
```bash
npm run test:coverage
```

## Development

### Project Setup
- **Build Tools:** Native JavaScript, no transpilation required
- **Auto-reload:** Configure with Nodemon for development
- **Database:** SQLite for data persistence
- **Version Control:** Git with conventional commits

### Code Standards
- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Comments:** Clear, concise JSDoc comments for functions
- **Structure:** Modular architecture with separation of concerns
- **Error Handling:** Try-catch blocks with proper error logging

### Running in Development Mode
```bash
npm run dev
```

## Database Schema

The application uses SQLite with the following main tables:
- **users** - User accounts and authentication
- **devices** - Smart home device records
- **consumption_logs** - Energy consumption data
- **settings** - User preferences and configurations
- **recommendations** - AI-generated suggestions

See `diagrams/relational-schema.mmd` for visual schema diagram.

## Architecture

### Data Flow
The system follows a client-server architecture:
```
Client (PWA) → Express Server → SQLite Database
   ↓
  Real-time WebSocket Updates
```

See `diagrams/data-flow.mmd` for detailed data flow.

## Performance Optimization

- **Frontend:** Minified JavaScript/CSS, lazy loading
- **Backend:** Connection pooling, query optimization
- **Database:** Indexed queries, efficient schema design
- **Caching:** Service Worker caching strategy
- **Monitoring:** Performance metrics logging

## Security

- ✅ Input validation on all endpoints
- ✅ SQL injection prevention via parameterized queries
- ✅ CORS configuration for cross-origin requests
- ✅ Environment variable protection
- ✅ Secure headers with Express middleware
- ⚠️ Authentication (recommended for production)

## Deployment

### Hosting Options
- **Heroku:** `git push heroku main`
- **Vercel:** Supports frontend deployment
- **AWS:** EC2 or Elastic Beanstalk
- **Docker:** Containerized deployment available

### Production Checklist
- [ ] Set environment variables securely
- [ ] Enable HTTPS/SSL
- [ ] Configure database backups
- [ ] Set up monitoring and logging
- [ ] Enable rate limiting
- [ ] Configure CORS properly
- [ ] Set up CI/CD pipeline

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Guidelines
- Follow existing code style
- Write clear commit messages
- Add tests for new features
- Update documentation as needed

## Troubleshooting

### Common Issues

**Q: Server won't start**
- Ensure port 3000 is available
- Check Node.js installation: `node --version`
- Verify database.db exists

**Q: Database errors**
- Delete `database.db` and restart server
- Check SQLite installation
- Verify file permissions

**Q: Frontend not loading**
- Clear browser cache
- Verify service worker registration
- Check browser console for errors

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Author

**Satvik Pandey** - [GitHub Profile](https://github.com/SATVIK-PANDEY-MITB)

### Project Information
- **Course:** DBS Lab Mini Project
- **Institution:** [Your Institution]
- **Created:** 2026

## Support & Contact

- 📧 Email: [Your Email]
- 🐛 Issues: [GitHub Issues](https://github.com/SATVIK-PANDEY-MITB/Smart-Home-Energy-Optimizer-DBS-Project/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/SATVIK-PANDEY-MITB/Smart-Home-Energy-Optimizer-DBS-Project/discussions)

## Roadmap

### v1.0 (Current)
- ✅ Basic device management
- ✅ Energy monitoring
- ✅ Analytics dashboard

### v1.1 (Planned)
- [ ] Mobile app (React Native)
- [ ] Machine learning predictions
- [ ] Advanced scheduling
- [ ] Integration with utility APIs

### v2.0 (Future)
- [ ] Multi-user support
- [ ] Cloud synchronization
- [ ] Smart automation rules
- [ ] Integration with home automation platforms

## Acknowledgments

- Express.js community
- Playwright testing framework
- SQLite database system
- Contributors and testers

---

**Made with ❤️ for sustainable living**
