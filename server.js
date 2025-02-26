const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sesClient = new SESClient({
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'YOUR_AWS_ACCESS_KEY_ID', // Replace after SES setup
        secretAccessKey: 'YOUR_AWS_SECRET_ACCESS_KEY' // Replace after SES setup
    }
});

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
  // console.error('Database error:', err);
});

// Initiate Payment
app.post('/paystack/initiate', authenticate, async (req, res) => {
    const { amount } = req.body;
    const userId = req.user_id;

    if (!amount || isNaN(amount) || amount <= 0) {
        console.error('Invalid amount provided:', { amount, userId });
        return res.status(400).json({ error: 'Valid amount required' });
    }

    // Fetch user details
    db.query('SELECT email, username FROM users WHERE user_id = ?', [userId], async (err, result) => {
        if (err || result.length === 0) {
            console.error('Error fetching user data:', { err, userId });
            return res.status(500).json({ error: 'Error fetching user data' });
        }

        const { email, username } = result[0];
        const reference = `NG_${Date.now()}_${userId}`; // Unique reference

        try {
            // Store pending transaction with the reference
            const query = `
                INSERT INTO payment_transactions (user_id, username, amount, reference, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', NOW())
            `;
            db.query(query, [userId, username, amount, reference], (err, result) => {
                if (err) {
                    console.error('Error inserting transaction into database:', { err, reference, userId });
                    return res.status(500).json({ error: 'Error creating transaction' });
                }

                console.log('Transaction initiated successfully:', { reference, userId, amount, insertId: result.insertId });
                res.status(200).json({
                    reference,
                    email,
                    amount: amount * 100, // Convert to kobo for Paystack
                    publicKey: process.env.PAYSTACK_PUBLIC_KEY
                });
            });
        } catch (error) {
            console.error('Unexpected error in payment initiation:', { error, reference, userId });
            res.status(500).json({ error: 'Server error during payment initiation' });
        }
    });
});

// Verify Payment
app.post('/paystack/verify', authenticate, async (req, res) => {
    const { reference } = req.body;
    const userId = req.user_id;

    if (!reference || typeof reference !== 'string') {
        console.error('Invalid reference provided:', { reference, userId });
        return res.status(400).json({ error: 'Valid reference required' });
    }

    try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log('Paystack verify response:', data);

        if (!data.status || data.data.status !== 'success') {
            console.error('Paystack verification failed:', { reference, userId, data });
            return res.status(400).json({ status: 'failed', message: 'Payment verification failed' });
        }

        const amount = data.data.amount / 100; // Convert from kobo
        const paystackUsername = data.data.customer.email.split('@')[0]; // Extract username from email

        db.query('SELECT user_id, amount FROM payment_transactions WHERE reference = ? AND status = "pending"', 
            [reference], (err, result) => {
                if (err) {
                    console.error('Database error during verification:', { err, reference, userId });
                    return res.status(500).json({ error: 'Database error' });
                }

                if (result.length === 0) {
                    console.warn('Transaction not found, inserting fallback:', { reference, userId });
                    // Insert fallback transaction if not found, leveraging unique constraint
                    db.query(
                        'INSERT INTO payment_transactions (user_id, username, amount, reference, status, created_at) VALUES (?, ?, ?, ?, "pending", NOW()) ON DUPLICATE KEY UPDATE status = "pending"',
                        [userId, paystackUsername, amount, reference],
                        (insertErr) => {
                            if (insertErr) {
                                console.error('Error inserting fallback transaction:', { insertErr, reference, userId });
                                return res.status(500).json({ error: 'Error creating fallback transaction' });
                            }
                            console.log('Fallback transaction inserted or updated:', { reference, userId });
                            proceedWithVerification(reference, userId, amount, res);
                        }
                    );
                } else if (result[0].user_id !== userId) {
                    console.error('Unauthorized transaction access:', { reference, userId, foundUserId: result[0].user_id });
                    return res.status(403).json({ error: 'Unauthorized transaction access' });
                } else {
                    console.log('Transaction found and authorized:', { reference, userId });
                    proceedWithVerification(reference, userId, amount, res);
                }
            });
    } catch (error) {
        console.error('Payment verification error:', { error, reference, userId });
        res.status(500).json({ error: 'Server error during verification' });
    }
});

// Helper function to proceed with verification
function proceedWithVerification(reference, userId, amount, res) {
    db.query('UPDATE payment_transactions SET status = "success" WHERE reference = ?', [reference], (err) => {
        if (err) {
            console.error('Error updating transaction status:', { err, reference, userId });
            return res.status(500).json({ error: 'Error updating transaction' });
        }

        db.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [amount, userId], (err) => {
            if (err) {
                console.error('Error updating user balance:', { err, userId, amount });
                return res.status(500).json({ error: 'Error updating balance' });
            }
            console.log('Payment verified and balance updated:', { reference, userId, amount });
            res.status(200).json({ status: 'success', message: 'Payment verified and balance updated' });
        });
    });
}

// Paystack Webhook Handler
app.post('/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(req.body))
        .digest('hex');
    if (hash !== req.headers['x-paystack-signature']) {
        console.error('Invalid webhook signature:', { received: req.headers['x-paystack-signature'], expected: hash });
        return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body;

    if (event.event === 'charge.success') {
        const reference = event.data.reference;
        const amount = event.data.amount / 100; // Convert from kobo

        db.query('SELECT user_id, amount FROM payment_transactions WHERE reference = ? AND status = "pending"', 
            [reference], (err, result) => {
                if (err || result.length === 0) {
                    console.warn('Webhook: Transaction not found or already processed:', { reference });
                    return res.sendStatus(200); // Acknowledge but don't process
                }

                const { user_id } = result[0];

                db.query('UPDATE payment_transactions SET status = "success" WHERE reference = ?', [reference], (err) => {
                    if (err) {
                        console.error('Webhook transaction update error:', { err, reference });
                    }

                    db.query('UPDATE users SET balance = balance + ? WHERE user_id = ?', [amount, user_id], (err) => {
                        if (err) {
                            console.error('Webhook balance update error:', { err, user_id, amount });
                        }
                        console.log('Webhook: Payment verified and balance updated:', { reference, user_id, amount });
                        res.sendStatus(200);
                    });
                });
            });
    } else {
        console.log('Webhook event ignored:', { event: event.event });
        res.sendStatus(200); // Acknowledge other events
    }
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

            // Update last_seen and isFirstLogin if true
            const updates = { last_seen: new Date() };
            if (user.isFirstLogin) {
                updates.isFirstLogin = false;
            }

            db.query(
                'UPDATE users SET last_seen = ?, isFirstLogin = ? WHERE user_id = ?',
                [updates.last_seen, updates.isFirstLogin || user.isFirstLogin, user.user_id],
                (updateErr) => {
                    if (updateErr) {
                        return;
                    }
                }
            );

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
                    role: user.role,
                    isFirstLogin: user.isFirstLogin // Send flag to client
                }
            });
        });
    });
});

app.get('/user', authenticate, (req, res) => {
  db.query('SELECT user_id, username, email, phone_number, balance, referralCode, bank_name, bank_account_number, account_name FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching user details' });
    }
    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result[0];
    res.status(200).json({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      phone_number: user.phone_number,
      balance: user.balance,
      referralCode: user.referralCode,
      bank_name: user.bank_name,
      bank_account_number: user.bank_account_number,
      account_name: user.account_name
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
        return res.status(500).json({ error: 'Error updating password' });
      }
      res.status(200).json({ success: true, message: 'Password updated successfully' });
    });
  });
});

// Fetch list of tournaments
app.get('/tournaments', authenticate, (req, res) => {
    const userId = req.user_id;

    const query = `
        SELECT t.*,
               (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.id) AS registered_players,
               IF(EXISTS(SELECT 1 FROM tournament_registrations WHERE tournament_id = t.id AND user_id = ?), 1, 0) AS is_registered
        FROM tournaments t
    `;

    db.query(query, [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Error fetching tournaments' });
        }
        res.status(200).json(results);
    });
});

app.post('/tournaments', authenticate, (req, res) => {
    // Add admin check if required (e.g., if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' }))
    const { name, prize_pool, start_time, max_players, registration_fee } = req.body;

    if (!name || !prize_pool || !start_time || !max_players || !registration_fee) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const query = `
        INSERT INTO tournaments (name, prize_pool, start_time, max_players, registration_fee)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(query, [name, prize_pool, start_time, max_players, registration_fee], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Error creating tournament' });
        }
        res.status(201).json({ message: 'Tournament created', id: result.insertId });
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
        return res.status(500).json({ error: 'Failed to save game outcome' });
      }
      res.status(200).json({ message: 'Game outcome saved successfully', id: result.insertId });
    }
  );
});


// Function to register a new user
async function registerUser(username, password, email, phone_number, referralCode, referrerCode, above18) {
    return new Promise((resolve, reject) => {

        db.query(
            'INSERT INTO users (username, password, balance, email, phone_number, referralCode, referrer_code, above18, isFirstLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [username, password, 1000, email, phone_number, referralCode, referrerCode, above18, true],
            (err, insertResult) => {
                if (err) {
                    reject(err);
                } else {
                    const newUserId = insertResult.insertId;
                    resolve(newUserId);
                }
            }
        );
    });
}

// Registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { username, password, email, phone_number, referrerCode, above18 } = req.body;
        if (!username || !password || (!email && !phone_number)) {
            return res.status(400).json({ error: 'Username, password, and either email or phone number are required' });
        }

        const phoneRegex = /^[0-9]{11}$/;
        if (phone_number && !phoneRegex.test(phone_number)) {
            return res.status(400).json({ error: 'Phone number must be exactly 11 digits and contain only numbers' });
        }

        if (!above18 || above18 !== true) {
            return res.status(400).json({ error: 'You must confirm you are above 18 years old' });
        }

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

        const newUserId = await registerUser(username, hashedPassword, email, phone_number, referralCode, referrerId, above18);
        const token = jwt.sign({ userId: newUserId }, process.env.JWT_SECRET, { expiresIn: '7d' });

        db.query('SELECT * FROM users WHERE user_id = ?', [newUserId], (err, result) => {
            if (err || result.length === 0) {
                return res.status(500).json({ error: 'Error retrieving user data' });
            }
            const user = result[0];
            console.log('User registered');
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
                    balance: user.balance, // Ensure balance is included
                    isFirstLogin: user.isFirstLogin
                }
            });
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.message.includes('users.username')) {
                return res.status(400).json({ error: 'Username already exists' });
            } else if (err.message.includes('users.email')) {
                return res.status(400).json({ error: 'User with this email already exists' });
            } else if (err.message.includes('users.phone_number')) {
                return res.status(400).json({ error: 'User with this phone number already exists' });
            }
        }
        return res.status(500).json({ error: 'An error occurred. Please try again.' });
    }
});

module.exports = app;

const resetOTPs = new Map();

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/initiate-reset-password', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    db.query('SELECT user_id, email FROM users WHERE username = ?', [username], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Error verifying user information' });
        }
        if (result.length === 0 || !result[0].email) {
            return res.status(400).json({ error: 'User not found or no email registered' });
        }

        const user = result[0];
        const otp = generateOTP();
        resetOTPs.set(user.user_id, { otp, expires: Date.now() + 15 * 60 * 1000 });

        const command = new SendEmailCommand({
            Source: 'hello@naijagamers.com',
            Destination: { ToAddresses: [user.email] },
            Message: {
                Subject: { Data: 'Naija Gamers Password Reset OTP' },
                Body: { Text: { Data: `Your OTP is ${otp}. It expires in 15 minutes.` } }
            }
        });

        sesClient.send(command)
            .then(() => res.status(200).json({ message: 'OTP sent to your email' }))
            .catch(error => {
                res.status(500).json({ error: 'Error sending OTP' });
            });
    });
});

app.post('/reset-password', (req, res) => {
    const { username, otp, newPassword } = req.body;
    if (!username || !otp || !newPassword) {
        return res.status(400).json({ error: 'Username, OTP, and new password are required' });
    }

    db.query('SELECT user_id FROM users WHERE username = ?', [username], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Error verifying user information' });
        }
        if (result.length === 0) {
            return res.status(400).json({ error: 'User not found' });
        }

        const userId = result[0].user_id;
        const storedOTP = resetOTPs.get(userId);

        if (!storedOTP || storedOTP.otp !== otp || Date.now() > storedOTP.expires) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
            if (hashErr) {
                return res.status(500).json({ error: 'Error hashing the password' });
            }
            db.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, userId], (updateErr, updateResult) => {
                if (updateErr) {
                    return res.status(500).json({ error: 'Error updating password' });
                }
                if (updateResult.affectedRows === 0) {
                    return res.status(400).json({ error: 'User not found' });
                }
                resetOTPs.delete(userId);
                const newToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
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
      return res.status(500).json({ error: 'Error fetching winners' });
    }

    const winners = result.map((winner) => {
      return `${winner.username} has won a ${winner.jackpot_type} jackpot for N${winner.payout.toLocaleString()}!!!`;
    });

    res.status(200).json({ winners });
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
        return res.status(500).json({ error: 'Error updating balance' });
      }

      // Log the transaction
      const query = `
        INSERT INTO transactions (user_id, type, amount, balance_after)
        VALUES (?, ?, ?, ?)
      `;
      db.query(query, [userId, type, amount, newBalance], (logErr) => {
        if (logErr) {
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
      return res.status(500).json({ error: 'Error updating profile' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.query('SELECT user_id, referralCode, username, email, phone_number, bank_name, bank_account_number, account_name FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
      if (err) {
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

const bonusPercentage = 0.5 / 100;  // Set to 0.5% but can be adjusted later

cron.schedule('0 0 * * *', async () => {
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
        return;
      }

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
      return;
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
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
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
                // console.error('Error inserting withdrawal request:', err);
                return res.status(500).json({ error: 'Error submitting withdrawal request' });
            }

            // Deduct the withdrawal amount from the user's balance
            const newBalance = balance - amount;
            db.query('UPDATE users SET balance = ? WHERE user_id = ?', [newBalance, userId], (err, result) => {
                if (err) {
                    // console.error('Error updating user balance:', err);
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
