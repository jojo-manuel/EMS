const crypto = require('crypto');
const mongoose = require('mongoose');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'employee'], required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    address: { type: String, default: '' },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduled_start: { type: String, required: true },
    scheduled_end: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'rescheduled'],
      default: 'pending',
    },
    reschedule_reason: { type: String, default: '' },
    completion_notes: { type: String, default: '' },
    completed_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const employeeLocationSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: { type: Number, default: 0 },
  is_tracking: { type: Number, default: 0 },
  updated_at: { type: Date, default: Date.now },
});

const locationHistorySchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: { type: Number, default: 0 },
  recorded_at: { type: Date, default: Date.now },
});

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    task_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    is_read: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    punch_in_at: { type: Date, required: true, default: Date.now },
    punch_in_lat: { type: Number, default: null },
    punch_in_lng: { type: Number, default: null },
    punch_out_at: { type: Date, default: null },
    punch_out_lat: { type: Number, default: null },
    punch_out_lng: { type: Number, default: null },
    verified_by: { type: String, default: 'fingerprint' },
    punch_out_reason: { type: String, default: '' },
    status: { type: String, enum: ['punched_in', 'punched_out'], default: 'punched_in' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const EmployeeLocation = mongoose.model('EmployeeLocation', employeeLocationSchema);
const LocationHistory = mongoose.model('LocationHistory', locationHistorySchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

async function seedDatabase() {
  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) return;

  await User.create({
    name: 'Admin',
    email: 'admin@emptracker.com',
    phone: '',
    password_hash: hashPassword('admin123'),
    role: 'admin',
  });

  console.log('Initialized default admin account: admin@emptracker.com');
}

let connectPromise = null;

async function connectAndSeed() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (connectPromise) {
    return connectPromise;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in environment variables or backend/.env');
  }
  connectPromise = mongoose
    .connect(uri)
    .then(async () => {
      console.log('Connected to MongoDB');
      await seedDatabase();
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });
  return connectPromise;
}

module.exports = {
  connectAndSeed,
  hashPassword,
  verifyPassword,
  User,
  Task,
  EmployeeLocation,
  LocationHistory,
  Notification,
  Attendance,
};
