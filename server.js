const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json()); 

// Homepage endpoint to check if server is live
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is live and running!',
  });
});

// 1. Database Connection Handling - Using MySQL Connection Pool
const db = mysql.createPool({
  connectionLimit: 50, // Set an appropriate connection limit
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
    req.user_id = decoded.user_id; // Attach user ID to the request object
    next();
  });
};

// Middleware
app.use(
  cors({
    origin: 'https://naijagamer.netlify.app',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

const generateToken = (userId) => {
  return jwt.sign(
    { user_id: userId }, 
    'secretkey',   
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

    // Insert user data into the database
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

        // Generate a token after successful registration
        const token = generateToken(result.insertId);
        res.status(201).json({ message: 'User registered successfully', token });
      }
    );
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

      const token = generateToken(user.user_id);
      // Return both token and username
      res.status(200).json({ token, username: user.username });
    });
  });
});

// Get and update user balance
app.route('/balance')
  .get((req, res) => {
    const token = req.headers['authorization'];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, 'secretkey', (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      db.query('SELECT balance FROM users WHERE user_id = ?', [decoded.user_id], (err, result) => {  
        if (err || result.length === 0) {
          console.error('Error fetching balance or user not found:', err);
          return res.status(500).json({ error: 'Error fetching balance' });
        }
        res.status(200).json({ balance: result[0].balance });
      });
    });
  })
  .post((req, res) => {
    const { balance } = req.body;
    const token = req.headers['authorization'];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (balance === undefined || isNaN(balance)) {
      return res.status(400).json({ error: 'Valid balance value required' });
    }
    jwt.verify(token, 'secretkey', (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      db.query('UPDATE users SET balance = ? WHERE user_id = ?', [balance, decoded.user_id], (err, result) => {
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
  });

// Store game outcome
app.post('/outcome', (req, res) => {
  const token = req.headers['authorization'];
  const { betAmount, numberOfPanels, outcome, payout, jackpot_type } = req.body;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, 'secretkey', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Fetch current balance
    db.query('SELECT balance FROM users WHERE user_id = ?', [decoded.user_id], (err, result) => {  
      if (err || result.length === 0) {
        return res.status(500).json({ error: 'Error fetching balance' });
      }
      const currentBalance = result[0].balance;
      const balanceAfter = currentBalance + payout - betAmount;

      if (betAmount > currentBalance) {
        return res.status(400).json({ error: 'Insufficient balance' });
      };

// Log game outcome
const query = `
  INSERT INTO game_outcomes (user_id, bet_amount, panels, outcome, payout, balance_after, jackpot_type, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const values = [decoded.user_id, betAmount, numberOfPanels, JSON.stringify(outcome), payout, balanceAfter, jackpot_type, new Date()];

db.query(query, values, (err) => {
  if (err) {
    return res.status(500).json({ error: 'Error logging game outcome' });
  }

  // Update user balance
  db.query('UPDATE users SET balance = ? WHERE user_id = ?', [balanceAfter, decoded.user_id], (err) => {
    if (err) {
      console.error('Error updating user balance:', err);
      return res.status(500).json({ error: 'Error updating user balance' });
    }
    
    res.status(200).json({
      message: 'Game outcome processed successfully',
      balanceAfter,
          });
        });
      });
    });
  });
});

app.get('/winners', (req, res) => {
  const query = `
    SELECT users.username, game_outcomes.jackpot_type, game_outcomes.payout, game_outcomes.created_at
    FROM game_outcomes
    JOIN users ON game_outcomes.user_id = users.user_id
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


// Add user-info endpoint
app.get('/user-info', (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, 'secretkey', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    db.query(
      'SELECT username, balance FROM users WHERE user_id = ?',
      [decoded.user_id],
      (err, result) => {
        if (err || result.length === 0) {
          console.error('Error fetching user info or user not found:', err);
          return res.status(500).json({ error: 'Error fetching user info' });
        }
        res.status(200).json({
          username: result[0].username,
          balance: result[0].balance,
        });
      }
    );
  });
});

const PORT = process.env.PORT || 3000; // Set to 3000 if PORT is not defined in .env


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
