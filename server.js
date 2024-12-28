const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

// Homepage endpoint to check if the server is live
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is live and running!b',
  });
});

// 1. Database Connection Handling - Using MySQL Connection Pool
const db = mysql.createPool({
  connectionLimit: 50,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// 2. Database Connection Retry Logic
db.on('error', (err) => {
  console.error('Database error:', err);
});

// 3. Token Security - Use environment variable for the JWT secret
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user_id = decoded.user_id;
    next();
  });
};

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501',
    'https://naijagamer.netlify.app',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const generateToken = (userId) => {
  return jwt.sign(
    { user_id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password, email, phone_number } = req.body;

  if (!username || !password || (!email && !phone_number)) {
    return res.status(400).json({ error: 'Username, password, and either email or phone number are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      'INSERT INTO users (username, password, balance, email, phone_number) VALUES (?, ?, ?, ?, ?)',
      [username, hashedPassword, 1000, email, phone_number],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username, email, or phone number already exists' });
          }
          console.error('Error registering user:', err);
          return res.status(500).json({ error: 'Error registering user' });
        }

        const token = generateToken(result.insertId);
        res.status(201).json({ message: 'User registered successfully', token });
      }
    );
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;

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

      // Update the last_seen field
      db.query(
        'UPDATE users SET last_seen = ? WHERE user_id = ?',
        [new Date(), user.user_id],
        (updateErr) => {
          if (updateErr) {
            console.error('Error updating last seen:', updateErr);
          }
        }
      );

      const token = generateToken(user.user_id);
      res.status(200).json({ token, username: user.username });
    });
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

// Fetch user info
app.get('/user-info', authenticate, (req, res) => {
  db.query('SELECT username, balance FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error fetching user info or user not found:', err);
      return res.status(500).json({ error: 'Error fetching user info' });
    }
    res.status(200).json({
      username: result[0].username,
      balance: result[0].balance,
    });
  });
});

// Admin-only endpoint for deposits and withdrawals
app.post('/transaction', (req, res) => {
  const { adminSecret, userId, type, amount } = req.body;

  // Ensure the request is authorized
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized access' });
  }

  if (!userId || !type || !amount || isNaN(amount) || (type !== 'deposit' && type !== 'withdrawal')) {
    return res.status(400).json({ error: 'Invalid request data' });
  }

  // Fetch the user's current balance
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

// Update user profile
app.put('/update-profile', authenticate, (req, res) => {
  const { username, email, phone_number } = req.body;

  // Validate the inputs
  if (!email && !phone_number) {
    return res.status(400).json({ error: 'Either email or phone number must be provided' });
  }

  // Update the profile
  let updateQuery = 'UPDATE users SET ';
  let values = [];

  if (email) {
    updateQuery += 'email = ?, ';
    values.push(email);
  }
  if (phone_number) {
    updateQuery += 'phone_number = ?, ';
    values.push(phone_number);
  }

  // Remove the trailing comma
  updateQuery = updateQuery.slice(0, -2);
  updateQuery += ' WHERE user_id = ?';
  values.push(req.user_id);

  db.query(updateQuery, values, (err, result) => {
    if (err) {
      console.error('Error updating profile:', err);
      return res.status(500).json({ error: 'Error updating profile' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ message: 'Profile updated successfully' });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
