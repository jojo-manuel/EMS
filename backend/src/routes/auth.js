const express = require('express');
const { User, verifyPassword } = require('../db');
const { signToken, authenticate } = require('../auth');

const router = express.Router();

function formatUser(user) {
  return {
    id: String(user._id),
    employee_code: user.employee_code || '',
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    unit: user.unit || '',
    area: user.area || '',
    role: user.role,
  };
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email / Employee ID and password are required' });
    }

    const identifier = email.trim();
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { employee_code: new RegExp(`^${escaped}$`, 'i') },
        { phone: identifier },
      ],
    });

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const safeUser = formatUser(user);

    return res.json({
      token: signToken(safeUser),
      user: safeUser,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: formatUser(user) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
