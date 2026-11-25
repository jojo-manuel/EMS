const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'emptracker-dev-secret-change-in-prod';

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      employee_code: user.employee_code || '',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Admin or Super Admin access required' });
  }
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  return next();
}

module.exports = {
  JWT_SECRET,
  signToken,
  authenticate,
  isAdminRole,
  requireAdmin,
  requireSuperAdmin,
};
