const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    'https://www.naijagamers.com',
    'https://54.85.217.182:4000',
    'https://naijagamers.com',
    'wss://www.naijagamers.com',
    'wss://naijagamers.com',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Allow cookies/session-based auth if needed
}));

app.options('*', cors());

const ADMIN_PATH = process.env.ADMIN_PATH || '/admin-panel-xyz123';
app.use(ADMIN_PATH, express.static(path.join(__dirname, 'public/admin')));

// JWT Authentication Middleware
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user_id = decoded.user_id;
    next();
  });
};

const generateToken = (userId) => {
  return jwt.sign({ user_id: userId }, process.env.JWT_SECRET);
};

const authenticateAdmin = (req, res, next) => {
  authenticate(req, res, () => {
    db.query('SELECT role FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
      if (err || result.length === 0 || result[0].role === 'user') {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
      req.adminRole = result[0].role;
      next();
    });
  });
};

const onlySuperAdmin = (req, res, next) => {
  if (req.adminRole !== 'super_admin') {
    return res.status(403).json({ error: 'Not Authorised' });
  }
  next();
};

// Homepage endpoint to check if the server is live
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is live and running! ak',
  });
});

// Database Connection Pool
const db = mysql.createPool({
  connectionLimit: 50,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.on('error', (err) => {
  console.error('Database error:', err);
});

// Unified Login Endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const isAdminLogin = req.headers['x-login-type'] === 'admin';

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.query('SELECT * FROM users WHERE username = ?', [username], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error finding user or user not found:', err);
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = result[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      if (isAdminLogin && user.role === 'user') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      db.query('UPDATE users SET last_seen = ? WHERE user_id = ?', [new Date(), user.user_id], (updateErr) => {
        if (updateErr) {
          console.error('Error updating last seen:', updateErr);
        }
      });

      const token = generateToken(user.user_id);
      res.status(200).json({
        token,
        user: {
          user_id: user.user_id,
          referralCode: user.referralCode,
          username: user.username,
          email: user.email,
          phone_number: user.phone_number,
          bank_name: user.bank_name,
          bank_account_number: user.bank_account_number,
          account_name: user.account_name,
          balance: user.balance,
          role: user.role
        }
      });
    });
  });
});

// Create Admin Endpoint
app.post(`${ADMIN_PATH}/create-admin`, authenticateAdmin, onlySuperAdmin, async (req, res) => {
  const { username, password, email, role } = req.body;

  if (!username || !password || !email || !['junior_admin', 'senior_admin', 'super_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
      'INSERT INTO users (username, password, balance, email, role) VALUES (?, ?, 0, ?, ?)',
      [username, hashedPassword, email, role],
      (err, result) => {
        if (err) {
          console.error('Error creating admin:', err);
          return res.status(500).json({ error: 'Error creating admin' });
        }
        res.status(201).json({ success: true, message: 'Admin created', userId: result.insertId });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Error hashing password' });
  }
});

// Update Password Endpoint
app.post(`${ADMIN_PATH}/update-password`, authenticateAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  db.query('SELECT password FROM users WHERE user_id = ?', [req.user_id], async (err, result) => {
    if (err || result.length === 0) {
      return res.status(500).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, result[0].password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    db.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedNewPassword, req.user_id], (err) => {
      if (err) {
        console.error('Error updating password:', err);
        return res.status(500).json({ error: 'Error updating password' });
      }
      res.status(200).json({ success: true, message: 'Password updated successfully' });
    });
  });
});

// User details endpoint
app.get('/user', authenticate, (req, res) => {
  db.query('SELECT username, balance FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error fetching user details:', err);
      return res.status(500).json({ error: 'Error fetching user details' });
    }
    res.status(200).json(result[0]);
  });
});

// Transactions: Deposits with Filtering and Pagination
app.get(`${ADMIN_PATH}/deposits`, authenticateAdmin, (req, res) => {
  const { status, startDate, endDate, userId, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM deposit_requests WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }
  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error fetching deposits:', err);
      return res.status(500).json({ error: 'Error fetching deposits' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Approve Deposit Request
app.post(`${ADMIN_PATH}/deposits/:id/approve`, authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM deposit_requests WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).json({ error: 'Deposit request not found' });
    }

    const deposit = result[0];
    if (deposit.status !== 'pending') {
      return res.status(400).json({ error: 'Deposit request already processed' });
    }

    db.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [deposit.amount, deposit.user_id], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error updating user balance' });
      }

      db.query('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [id], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating deposit status' });
        }
        res.status(200).json({ success: true, message: 'Deposit approved successfully' });
      });
    });
  });
});

// Reject Deposit Request
app.post(`${ADMIN_PATH}/deposits/:id/reject`, authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.query('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Error rejecting deposit' });
    }
    res.status(200).json({ success: true, message: 'Deposit rejected successfully' });
  });
});

// Transactions: Withdrawals with Filtering and Pagination
app.get(`${ADMIN_PATH}/withdrawals`, authenticateAdmin, (req, res) => {
  const { status, startDate, endDate, userId, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM withdrawal_requests WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }
  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.query(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching withdrawals' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Approve Withdrawal Request
app.post(`${ADMIN_PATH}/withdrawals/:id/approve`, authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.query('UPDATE withdrawal_requests SET status = "approved" WHERE id = ?', [id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Error approving withdrawal' });
    }
    res.status(200).json({ success: true, message: 'Withdrawal approved successfully' });
  });
});

// Reject Withdrawal Request (Refund Amount)
app.post(`${ADMIN_PATH}/withdrawals/:id/reject`, authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM withdrawal_requests WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).json({ error: 'Withdrawal request not found' });
    }

    const withdrawal = result[0];
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal request already processed' });
    }

    db.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [withdrawal.amount, withdrawal.user_id], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error refunding user balance' });
      }

      db.query('UPDATE withdrawal_requests SET status = "rejected" WHERE id = ?', [id], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating withdrawal status' });
        }
        res.status(200).json({ success: true, message: 'Withdrawal rejected and amount refunded' });
      });
    });
  });
});

// Finances Summary with Time Period Filtering
app.get(`${ADMIN_PATH}/finances/summary`, authenticateAdmin, (req, res) => {
  const { startDate, endDate } = req.query;

  const query = `
    SELECT 
      SUM(CASE WHEN t.type = 'deposit' AND dr.status = 'approved' THEN dr.amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN t.type = 'withdrawal' AND wr.status = 'approved' THEN wr.amount ELSE 0 END) as total_withdrawals,
      SUM(wgo.winner_amount) as total_bets,
      SUM(wgo.rake) as total_rake
    FROM transactions t
    LEFT JOIN deposit_requests dr ON t.user_id = dr.user_id AND t.type = 'deposit'
    LEFT JOIN withdrawal_requests wr ON t.user_id = wr.user_id AND t.type = 'withdrawal'
    LEFT JOIN whot_game_outcomes wgo ON t.user_id = wgo.winner_id
    WHERE t.created_at BETWEEN ? AND ?
  `;

  db.query(query, [startDate || '1970-01-01', endDate || new Date()], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching finances summary' });
    }
    res.status(200).json({ success: true, data: result[0] });
  });
});

// Whot Games Interface with Filtering and Pagination
app.get(`${ADMIN_PATH}/games/whot`, authenticateAdmin, (req, res) => {
  const { playerId, startDate, endDate, roomId, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM whot_game_outcomes WHERE 1=1';
  const params = [];

  if (playerId) {
    query += ' AND winner_id = ?';
    params.push(playerId);
  }
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }
  if (roomId) {
    query += ' AND table_name = ?';
    params.push(roomId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.query(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching Whot games' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Registered Users with Time Period Filtering and Pagination
app.get(`${ADMIN_PATH}/users/registered`, authenticateAdmin, (req, res) => {
  const { startDate, endDate, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT user_id, username, email, phone_number, created_at FROM users WHERE created_at BETWEEN ? AND ?';
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  db.query(query, [startDate || '1970-01-01', endDate || new Date(), parseInt(limit), parseInt(offset)], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching registered users' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Chart Data for Deposits Over Time
app.get(`${ADMIN_PATH}/charts/deposits`, authenticateAdmin, (req, res) => {
  const { startDate, endDate } = req.query;

  const query = `
    SELECT DATE(created_at) as date, SUM(amount) as total
    FROM deposit_requests
    WHERE status = 'approved' AND created_at BETWEEN ? AND ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  db.query(query, [startDate || '1970-01-01', endDate || new Date()], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching deposit chart data' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Chart Data for Whot Game Bets Over Time
app.get(`${ADMIN_PATH}/charts/whot-bets`, authenticateAdmin, (req, res) => {
  const { startDate, endDate } = req.query;

  const query = `
    SELECT DATE(created_at) as date, SUM(winner_amount) as total_bets
    FROM whot_game_outcomes
    WHERE created_at BETWEEN ? AND ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  db.query(query, [startDate || '1970-01-01', endDate || new Date()], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching Whot bets chart data' });
    }
    res.status(200).json({ success: true, data: results });
  });
});

// Updated Registration Endpoint
// Generate a unique referral code
async function generateUniqueReferralCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = 'A' + Math.random().toString(36).substr(2, 4).toUpperCase();
    const result = await new Promise((resolve, reject) => {
      db.query('SELECT referralCode FROM users WHERE referralCode = ?', [code], (err, result) => {
        if (err) {
          console.error('Error checking referral code uniqueness:', err.message);
          reject(err);
        }
        resolve(result);
      });
    });
    isUnique = result.length === 0;
  }

  return code;
}

app.post('/save-game-outcome', async (req, res) => {
  const {
    roomId,
    winnerId,
    winnings,
    reason,
    winnerName,
    playerTotals,
    startTime,
    endTime,
    rake
  } = req.body;

  if (
    startTime === undefined ||
    endTime === undefined ||
    !roomId ||
    winnerId === undefined ||
    !winnerName ||
    winnings === undefined ||
    rake === undefined ||
    !playerTotals
  ) {
    console.error("Validation error:", { startTime, endTime, roomId, winnerId, winnerName, winnings, rake, playerTotals });
    return res.status(400).json({ error: 'All fields are required' });
  }

  const query = `
    INSERT INTO whot_game_outcomes (
      start_time, end_time, table_name, winner_id, winner, winner_amount, rake, card_totals, created_at, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
  `;
  
  db.query(
    query,
    [
      startTime,
      endTime,
      roomId,
      winnerId,
      winnerName,
      winnings,
      rake,
      JSON.stringify(playerTotals),
      reason
    ],
    (err, result) => {
      if (err) {
        console.error("Error saving game outcome:", err);
        return res.status(500).json({ error: 'Failed to save game outcome' });
      }
      res.status(200).json({ message: 'Game outcome saved successfully', id: result.insertId });
    }
  );
});


// Function to register a new user
async function registerUser(username, password, email, phone_number, referralCode, referrerCode, dob) {
  return new Promise((resolve, reject) => {
    console.log('Registering user with:', { username, email, dob, referralCode, referrerCode });

    db.query(
      'INSERT INTO users (username, password, balance, email, phone_number, referralCode, referrer_code, date_of_birth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, password, 200, email, phone_number, referralCode, referrerCode, dob],
      (err, insertResult) => {
        if (err) {
          console.error('Error registering user:', err.message);
          reject(err);
        } else {
          const newUserId = insertResult.insertId;
          console.log('User successfully registered with ID:', newUserId);
          resolve(newUserId);
        }
      }
    );
  });
}

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { username, password, email, phone_number, referrerCode, dob } = req.body;
    if (!username || !password || (!email && !phone_number)) {
      return res.status(400).json({ error: 'Username, password, and either email or phone number are required' });
    }
    const formattedDob = dob ? new Date(dob).toISOString().split('T')[0] : null;
    const referralCode = await generateUniqueReferralCode();
    const hashedPassword = await bcrypt.hash(password, 10);

    let referrerId = null;
    if (referrerCode) {
      const referrerResult = await new Promise((resolve, reject) => {
        db.query('SELECT referralCode FROM users WHERE referralCode = ?', [referrerCode], (err, result) => {
          if (err) reject(err);
          resolve(result);
        });
      });
      if (!referrerResult || referrerResult.length === 0) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }
      referrerId = referrerCode;
    }

    const newUserId = await registerUser(username, hashedPassword, email, phone_number, referralCode, referrerId, formattedDob);
    const token = jwt.sign({ userId: newUserId }, process.env.JWT_SECRET, { expiresIn: '7d' }); // Updated secret

    db.query('SELECT * FROM users WHERE user_id = ?', [newUserId], (err, result) => {
      if (err || result.length === 0) {
        return res.status(500).json({ error: 'Error retrieving user data' });
      }
      const user = result[0];
      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          user_id: user.user_id,
          referralCode: user.referralCode,
          username: user.username,
          email: user.email,
          phone_number: user.phone_number,
          bank_name: user.bank_name,
          bank_account_number: user.bank_account_number,
          account_name: user.account_name,
          balance: user.balance
        }
      });
    });
  } catch (err) {
    console.error('Error during registration:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;

// Reset Password Endpoint (updated secret key)
app.post('/reset-password', (req, res) => {
  const { username, dob, newPassword } = req.body;
  if (!username || !dob || !newPassword) {
    return res.status(400).json({ error: 'Username, date of birth, and new password are required' });
  }
  const normalizedDob = new Date(dob).toISOString().split('T')[0];
  db.query('SELECT user_id, date_of_birth FROM users WHERE username = ?', [username], (err, result) => {
    if (err) {
      console.error('Error querying database:', err.message);
      return res.status(500).json({ error: 'Error verifying user information' });
    }
    if (result.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    const storedDob = result[0].date_of_birth;
    const normalizedStoredDob = new Date(storedDob).toISOString().split('T')[0];
    if (normalizedStoredDob !== normalizedDob) {
      return res.status(400).json({ error: 'Invalid date of birth' });
    }
    bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        return res.status(500).json({ error: 'Error hashing the password' });
      }
      db.query('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, username], (updateErr, updateResult) => {
        if (updateErr) {
          console.error('Error updating password:', updateErr.message);
          return res.status(500).json({ error: 'Error updating password' });
        }
        if (updateResult.affectedRows === 0) {
          return res.status(400).json({ error: 'User not found' });
        }
        const newToken = jwt.sign({ userId: result[0].user_id }, process.env.JWT_SECRET, { expiresIn: '7d' }); // Updated secret
        return res.status(200).json({ message: 'Password reset successfully', token: newToken });
      });
    });
  });
});

// Combined GET and POST endpoint for server-to-server balance operations
app.route('/server-balance')
  // GET: Fetch user balance by username
  .get((req, res) => {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    db.query('SELECT balance FROM users WHERE username = ?', [username], (err, result) => {
      if (err) {
        console.error('Error fetching balance for username:', username, err);
        return res.status(500).json({ error: 'Error fetching balance' });
      }
      if (result.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(200).json({ balance: result[0].balance });
    });
  })
  // POST: Update user balance by username
  .post((req, res) => {
    const { username, balance } = req.body;
    if (!username || balance === undefined || isNaN(balance)) {
      return res.status(400).json({ error: 'Valid username and balance required' });
    }
    db.query('UPDATE users SET balance = ? WHERE username = ?', [balance, username], (err, result) => {
      if (err) {
        console.error('Error updating balance for username:', username, err);
        return res.status(500).json({ error: 'Error updating balance' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(200).json({ message: 'Balance updated successfully' });
    });
  });


// Get and update user balance
app.route('/balance')
  .get(authenticate, (req, res) => {
    db.query('SELECT balance FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
      if (err || result.length === 0) {
        console.error('Error fetching balance or user not found:', err);
        return res.status(500).json({ error: 'Error fetching balance' });
      }
      res.status(200).json({ balance: result[0].balance });
    });
  })
  .post(authenticate, (req, res) => {
    const { balance } = req.body;

    if (balance === undefined || isNaN(balance)) {
      return res.status(400).json({ error: 'Valid balance value required' });
    }

    db.query('UPDATE users SET balance = ? WHERE user_id = ?', [balance, req.user_id], (err, result) => {
      if (err) {
        console.error('Error updating balance:', err);
        return res.status(500).json({ error: 'Error updating balance' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(200).json({ message: 'Balance updated successfully' });
    });
  });

// Store game outcome
app.post('/outcome', authenticate, (req, res) => {
  const { betAmount, numberOfPanels, outcome, payout, jackpot_type, userBalance } = req.body;

  if (!betAmount || !numberOfPanels || !outcome || payout === undefined || userBalance === undefined) {
    return res.status(400).json({ error: 'All game outcome fields are required' });
  }
    const query = `
      INSERT INTO game_outcomes (user_id, bet_amount, panels, outcome, payout, userBalance, jackpot_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [req.user_id, betAmount, numberOfPanels, JSON.stringify(outcome), payout, userBalance, jackpot_type, new Date()];

    db.query(query, values, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error logging game outcome' });
      }
        res.status(200).json({
          message: 'Game outcome processed successfully',
        });
      });
    });

// Fetch recent winners
app.get('/winners', (req, res) => {
  const query = `
    SELECT users.username, game_outcomes.jackpot_type, game_outcomes.payout, game_outcomes.created_at
    FROM game_outcomes
    JOIN users ON game_outcomes.user_id = users.user_id
    WHERE game_outcomes.jackpot_type IS NOT NULL AND game_outcomes.jackpot_type != 'none'
    ORDER BY game_outcomes.created_at DESC
    LIMIT 50
  `;

  db.query(query, (err, result) => {
    if (err) {
      console.error('Error fetching winners:', err);
      return res.status(500).json({ error: 'Error fetching winners' });
    }

    const winners = result.map((winner) => {
      return `${winner.username} has won a ${winner.jackpot_type} jackpot for N${winner.payout.toLocaleString()}!!!`;
    });

    res.status(200).json({ winners });
  });
});

// Fetch user profile data
app.get('/user-info', authenticate, (req, res) => {
  const userId = req.user_id; 

  db.query('SELECT * FROM users WHERE user_id = ?', [userId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Error fetching user profile' });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result[0];
    res.status(200).json({
      user_id: user.user_id,
      referralCode: user.referralCode,
      username: user.username,
      email: user.email,
      phone_number: user.phone_number,
      bank_name: user.bank_name,
      bank_account_number: user.bank_account_number,
      account_name: user.account_name,
      balance: user.balance
    });
  });
});

// Admin-only endpoint for deposits and withdrawals
app.post('/transaction', (req, res) => {
  const { adminSecret, userId, type, amount } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }

  if (!userId || !type || !amount || isNaN(amount) || (type !== 'deposit' && type !== 'withdrawal')) {
    return res.status(400).json({ error: 'Invalid request data' });
  }

  db.query('SELECT balance FROM users WHERE user_id = ?', [userId], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error fetching user balance:', err);
      return res.status(500).json({ error: 'Error fetching user data' });
    }

    const currentBalance = parseFloat(result[0].balance);
    const newBalance = type === 'deposit'
      ? currentBalance + parseFloat(amount)
      : currentBalance - parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({ error: 'Insufficient balance for withdrawal' });
    }

    // Update the user's balance
    db.query('UPDATE users SET balance = ? WHERE user_id = ?', [newBalance, userId], (updateErr) => {
      if (updateErr) {
        console.error('Error updating balance:', updateErr);
        return res.status(500).json({ error: 'Error updating balance' });
      }

      // Log the transaction
      const query = `
        INSERT INTO transactions (user_id, type, amount, balance_after)
        VALUES (?, ?, ?, ?)
      `;
      db.query(query, [userId, type, amount, newBalance], (logErr) => {
        if (logErr) {
          console.error('Error logging transaction:', logErr);
          return res.status(500).json({ error: 'Error logging transaction' });
        }

        res.status(200).json({
          message: `Transaction successful: ${type} of N${amount}`,
          newBalance,
        });
      });
    });
  });
});

// Update user profile data
app.put('/update-profile', authenticate, (req, res) => {
  const { username, email, phone_number, bank_name, bank_account_number, account_name } = req.body;

  // Initialize a flag to check if any valid fields are provided
  let hasValidField = false;

  // Validate each field and prepare for update if provided
  const updateFields = [];
  const values = [];

  if (email && email.trim() !== "") {
    updateFields.push('email = ?');
    values.push(email);
    hasValidField = true;
  }
  if (phone_number && phone_number.trim() !== "") {
    updateFields.push('phone_number = ?');
    values.push(phone_number);
    hasValidField = true;
  }
  if (bank_name && bank_name.trim() !== "") {
    updateFields.push('bank_name = ?');
    values.push(bank_name);
    hasValidField = true;
  }
  if (bank_account_number && /^\d{10}$/.test(bank_account_number)) {
    updateFields.push('bank_account_number = ?');
    values.push(bank_account_number);
    hasValidField = true;
  }
  if (account_name && account_name.trim() !== "") {
    updateFields.push('account_name = ?');
    values.push(account_name);
    hasValidField = true;
  }

  // Check if at least one valid field is provided
  if (!hasValidField) {
    return res.status(400).json({ error: 'At least one field must be provided' });
  }

  let updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE user_id = ?`;
  values.push(req.user_id);

  // Perform the database update
  db.query(updateQuery, values, (err, result) => {
    if (err) {
      console.error('Error updating profile:', err);
      return res.status(500).json({ error: 'Error updating profile' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.query('SELECT user_id, referralCode, username, email, phone_number, bank_name, bank_account_number, account_name FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
      if (err) {
        console.error('Error fetching updated user data:', err);
        return res.status(500).json({ error: 'Error fetching updated user data' });
      }

      const updatedUser = result[0];
      res.status(200).json({
        message: 'Profile updated successfully',
        user_id: updatedUser.user_id,
        referralCode: updatedUser.referralCode,
        username: updatedUser.username,
        email: updatedUser.email,
        phone_number: updatedUser.phone_number,
        bank_name: updatedUser.bank_name,
        bank_account_number: updatedUser.bank_account_number,
        account_name: updatedUser.account_name,
      });
    });
  });
});



// Bounty prize route
app.get('/bounty-jackpot', async (req, res) => {
  try {
    const panelType = req.query.panelType;
    if (!panelType || (panelType !== '3' && panelType !== '4')) {
      return res.status(400).json({ error: 'Invalid panel type. Please use "3" or "4".' });
    }

    // If no cached prize, calculate it from the database
    const BASE_PRIZE = 50000;
    const PERCENTAGE = 0.01;
    const FOUR_PANEL_MULTIPLIER = 1;
    const THREE_PANEL_MULTIPLIER = 1;

    const lastWinQuery = `
      SELECT MAX(created_at) AS lastWinTime
      FROM game_outcomes
      WHERE jackpot_type = 'bounty'
    `;
    db.query(lastWinQuery, (err, result) => {
      if (err) {
        console.error('Error fetching last bounty win time:', err);
        return res.status(500).json({ error: 'Error calculating bounty prize' });
      }

      const lastWinTime = result[0].lastWinTime;

      const totalBetsQuery = `
        SELECT SUM(bet_amount) * ? AS prizePool
        FROM game_outcomes
        WHERE created_at > ? OR ? IS NULL
      `;

      db.query(totalBetsQuery, [PERCENTAGE, lastWinTime, lastWinTime], (err, result) => {
        if (err) {
          console.error('Error calculating total bets:', err);
          return res.status(500).json({ error: 'Error calculating bounty prize' });
        }

        const calculatedPrize = result[0].prizePool || 0;
        const currentPrize = Math.max(BASE_PRIZE, calculatedPrize);

        const prizeForFourPanels = currentPrize * FOUR_PANEL_MULTIPLIER;
        const prizeForThreePanels = currentPrize * THREE_PANEL_MULTIPLIER;

        let adjustedPrize;
        if (panelType === '4') {
          adjustedPrize = prizeForFourPanels;
        } else {
          adjustedPrize = prizeForThreePanels;
        }

        // Cache the prize before responding
        cacheBountyPrize(adjustedPrize);

        res.status(200).json({ bountyPrize: adjustedPrize });
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const bonusPercentage = 0.5 / 100;  // Set to 0.5% but can be adjusted later

cron.schedule('0 0 * * *', async () => {
  console.log('Running scheduled task: Calculating referral bets and bonuses');

  try {
    // Query to fetch total bets grouped by referral_code
    const query = `
      SELECT ur.referralCode, SUM(b.amount_bet) AS total_bet
      FROM users u
      JOIN game_outcomes b ON u.user_id = b.user_id
      JOIN user_referrals ur ON ur.user_id = u.user_id
      WHERE ur.referralCode IS NOT NULL
      GROUP BY ur.referralCode
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error('Error calculating referral bets:', err);
        return;
      }

      console.log('Referral bet totals:', results);

      // Calculate referral bonus for each referral_code
      results.forEach(result => {
        const { referralCode, total_bet } = result;

        const referralBonus = total_bet * bonusPercentage;

        // Store the results (total bet and referral bonus) in the cache
        cache.set(`referralCode:${referralCode}:total_bet`, total_bet);
        cache.set(`referralCode:${referralCode}:referral_bonus`, referralBonus); 
      });
    });
  } catch (error) {
    console.error('Error during scheduled referral calculation:', error);
  }
});

// Endpoint to fetch referral bonus
app.get('/referral/referral-bonus', async (req, res) => {
  const { referral_code } = req.query;

  try {
    const referralBonus = await cache.get(`referralCode:${referralCode}:referral_bonus`);

    if (referralBonus) {
      res.json({ success: true, referralBonus });
    } else {
      res.json({ success: false, message: 'No data found for this referral code' });
    }
  } catch (error) {
    console.error('Error fetching referral bonus:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


app.post('/deposit', authenticate, (req, res) => {
    const { user_id, username, balance } = req.user; // Extract user info from the token
    const { amount } = req.body;

    // Insert deposit request into the database
    const query = `
        INSERT INTO deposit_requests (user_id, username, balance, amount, status)
        VALUES (?, ?, ?, ?, 'pending')
    `;
    db.query(query, [user_id, username, balance, amount], (err, result) => {
        if (err) {
            console.error('Error inserting deposit request:', err);
            return res.status(500).json({ error: 'Error submitting deposit request' });
        }
        res.status(200).json({ message: 'Deposit request submitted successfully' });
    });
});

// POST /tournaments (Admin only)
app.post('/tournaments', authenticateAdmin, (req, res) => {
    const { name, prize_pool, start_time, max_players, registration_fee } = req.body;
    if (!name || !prize_pool || !start_time || !max_players || !registration_fee) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    db.query(
        'INSERT INTO tournaments (name, prize_pool, start_time, max_players, registration_fee) VALUES (?, ?, ?, ?, ?)',
        [name, prize_pool, start_time, max_players, registration_fee],
        (err, result) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.status(201).json({ message: 'Tournament created', id: result.insertId });
        }
    );
});

// GET /tournaments (Authenticated users)
app.get('/tournaments', authenticate, (req, res) => {
    const user_id = req.user_id;
    db.query(
        `SELECT t.*,
                (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.id) as registered_players,
                IF(EXISTS(SELECT 1 FROM tournament_registrations WHERE tournament_id = t.id AND user_id = ?), 1, 0) as is_registered
         FROM tournaments t`,
        [user_id],
        (err, results) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json(results);
        }
    );
});

app.post('/withdraw', authenticate, (req, res) => {
    const { amount } = req.body;
    const userId = req.user_id; // Extracted from the token

    // Fetch user balance and account details
    db.query('SELECT balance, bank_name, bank_account_number, account_name FROM users WHERE user_id = ?', [userId], (err, result) => {
        if (err) {
            console.error('Error fetching user data:', err);
            return res.status(500).json({ error: 'Error fetching user data' });
        }

        if (result.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result[0];
        const balance = parseFloat(user.balance);

        // Validate withdrawal amount
        if (amount > balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        if (amount < 1000) {
            return res.status(400).json({ error: 'Minimum withdrawal is ₦1000' });
        }

        // Insert withdrawal request into the database
        const query = `
            INSERT INTO withdrawal_requests (user_id, username, balance, amount, bank_name, bank_account_number, account_name, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `;
        db.query(query, [userId, user.username, balance, amount, user.bank_name, user.bank_account_number, user.account_name], (err, result) => {
            if (err) {
                console.error('Error inserting withdrawal request:', err);
                return res.status(500).json({ error: 'Error submitting withdrawal request' });
            }

            // Deduct the withdrawal amount from the user's balance
            const newBalance = balance - amount;
            db.query('UPDATE users SET balance = ? WHERE user_id = ?', [newBalance, userId], (err, result) => {
                if (err) {
                    console.error('Error updating user balance:', err);
                    return res.status(500).json({ error: 'Error updating user balance' });
                }

                res.status(200).json({ message: 'Withdrawal request submitted successfully', newBalance });
            });
        });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
