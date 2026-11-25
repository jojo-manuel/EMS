require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { connectAndSeed } = require('./db');
const { JWT_SECRET } = require('./auth');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const createTasksRouter = require('./routes/tasks');
const createLocationsRouter = require('./routes/locations');
const createAttendanceRouter = require('./routes/attendance');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  if (socket.user.role === 'admin') {
    socket.join('admins');
  } else {
    socket.join(`employee:${socket.user.id}`);
  }
});

app.use(cors());
app.use(express.json());

// Ensure MongoDB connection is established before handling any API request (supports Vercel serverless cold starts)
app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next();
  try {
    await connectAndSeed();
    return next();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    return res.status(500).json({ error: 'Database connection failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'mongodb', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tasks', createTasksRouter(io));
app.use('/api/locations', createLocationsRouter(io));
app.use('/api/attendance', createAttendanceRouter(io));
app.use('/api/notifications', notificationsRoutes);

const PORT = process.env.PORT || 4000;

if (!process.env.VERCEL) {
  connectAndSeed()
    .then(() => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`EmpTracker backend running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;
