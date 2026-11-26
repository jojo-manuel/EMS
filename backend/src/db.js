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

const UNITS = ['KOZHIKODE', 'KOCHI', 'TRIVANDRUM', 'KANNUR', 'THRISSUR', 'KOTTAYAM'];

const userSchema = new mongoose.Schema(
  {
    employee_code: { type: String, default: '', trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    unit: { type: String, default: '', trim: true },
    area: { type: String, default: '', trim: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['superadmin', 'admin', 'employee'], required: true },
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
      enum: ['pending', 'in_progress', 'completed', 'rescheduled', 'cancelled'],
      default: 'pending',
    },
    reschedule_reason: { type: String, default: '' },
    rescheduled_lat: { type: Number, default: null },
    rescheduled_lng: { type: Number, default: null },
    rescheduled_at: { type: Date, default: null },
    completion_notes: { type: String, default: '' },
    completed_at: { type: Date, default: null },
    completed_lat: { type: Number, default: null },
    completed_lng: { type: Number, default: null },
    cancel_reason: { type: String, default: '' },
    cancelled_at: { type: Date, default: null },
    cancelled_lat: { type: Number, default: null },
    cancelled_lng: { type: Number, default: null },
    transferred_from_name: { type: String, default: '' },
    transferred_at: { type: Date, default: null },
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

const leaveSchema = new mongoose.Schema(
  {
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leave_type: { type: String, enum: ['single_day', 'custom'], default: 'single_day' },
    start_date: { type: String, required: true }, // YYYY-MM-DD
    end_date: { type: String, required: true },   // YYYY-MM-DD
    reason: { type: String, default: '' },
    transfer_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    transferred_tasks_count: { type: Number, default: 0 },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const EmployeeLocation = mongoose.model('EmployeeLocation', employeeLocationSchema);
const LocationHistory = mongoose.model('LocationHistory', locationHistorySchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Leave = mongoose.model('Leave', leaveSchema);

async function seedDatabase() {
  const [existingSuperAdmin, existingAdmin] = await Promise.all([
    User.findOne({ role: 'superadmin' }),
    User.findOne({ role: 'admin' }),
  ]);

  if (!existingSuperAdmin) {
    await User.create({
      name: 'Super Admin',
      email: 'superadmin@emptracker.com',
      phone: '',
      password_hash: hashPassword('superadmin123'),
      role: 'superadmin',
    });
    console.log('Initialized default superadmin account: superadmin@emptracker.com');
  }

  if (!existingAdmin) {
    await User.create({
      name: 'Admin',
      email: 'admin@emptracker.com',
      phone: '',
      password_hash: hashPassword('admin123'),
      role: 'admin',
    });
    console.log('Initialized default admin account: admin@emptracker.com');
  }
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

async function getAdminUnitScope(reqUser) {
  if (!reqUser || reqUser.role === 'superadmin') {
    return null; // Super Admin sees all units
  }
  const adminDoc = await User.findById(reqUser.id).select('role unit').lean();
  if (!adminDoc || adminDoc.role === 'superadmin' || !adminDoc.unit) {
    return null;
  }
  const unitUpper = adminDoc.unit.trim().toUpperCase();
  const unitEmployees = await User.find({
    role: 'employee',
    unit: new RegExp(`^${unitUpper}$`, 'i'),
  })
    .select('_id')
    .lean();
  return {
    unit: unitUpper,
    employeeIds: unitEmployees.map((e) => e._id),
  };
}

module.exports = {
  UNITS,
  connectAndSeed,
  getAdminUnitScope,
  hashPassword,
  verifyPassword,
  User,
  Task,
  EmployeeLocation,
  LocationHistory,
  Notification,
  Attendance,
  Leave,
};
