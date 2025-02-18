const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
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
    "http://127.0.0.1:5501",
    'https://naijagamer.netlify.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Allow cookies/session-based auth if needed
}));

// Handle CORS Preflight Requests
app.options('*', cors());

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

// JWT Authentication Middleware
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

const generateToken = (userId) => {
  return jwt.sign(
    { user_id: userId },
    process.env.JWT_SECRET
  );
};

// Endpoint to fetch user details
app.get('/user', authenticate, (req, res) => {
  db.query('SELECT username, balance FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error fetching user details or user not found:', err);
      return res.status(500).json({ error: 'Error fetching user details' });
    }
    res.status(200).json(result[0]);
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
  console.log("Received payload:", req.body);
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
        db.query(
          'SELECT referralCode FROM users WHERE referralCode = ?',
          [referrerCode],
          (err, result) => {
            if (err) reject(err);
            resolve(result);
          }
        );
      });

      if (!referrerResult || referrerResult.length === 0) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }

      referrerId = referrerCode;
    }

    const newUserId = await registerUser(username, hashedPassword, email, phone_number, referralCode, referrerId, formattedDob);
    const token = jwt.sign({ userId: newUserId }, 'your_secret_key', { expiresIn: '7d' });

    // Fetch newly registered user data
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

// Reset Password Functionality with Date of Birth Validation
app.post('/reset-password', (req, res) => {
  const { username, dob, newPassword } = req.body;

  if (!username || !dob || !newPassword) {
    return res.status(400).json({ error: 'Username, date of birth, and new password are required' });
  }

  // Normalize date format: Ensure dob in the request is in YYYY-MM-DD format
  const normalizedDob = new Date(dob).toISOString().split('T')[0]; // Format date to YYYY-MM-DD

  // Validate the date of birth
  db.query(
    'SELECT user_id, date_of_birth FROM users WHERE username = ?',
    [username],
    (err, result) => {
      if (err) {
        console.error('Error querying database:', err.message);
        return res.status(500).json({ error: 'Error verifying user information' });
      }

      if (result.length === 0) {
        return res.status(400).json({ error: 'User not found' });
      }

      const storedDob = result[0].date_of_birth;

      // Normalize stored DOB as well in case it contains time
      const normalizedStoredDob = new Date(storedDob).toISOString().split('T')[0];

      if (normalizedStoredDob !== normalizedDob) {
        return res.status(400).json({ error: 'Invalid date of birth' });
      }

      // Hash the new password
      bcrypt.hash(newPassword, 10, (hashErr, hashedPassword) => {
        if (hashErr) {
          return res.status(500).json({ error: 'Error hashing the password' });
        }

        // Update the password
        db.query(
          'UPDATE users SET password = ? WHERE username = ?',
          [hashedPassword, username],
          (updateErr, updateResult) => {
            if (updateErr) {
              console.error('Error updating password:', updateErr.message);
              return res.status(500).json({ error: 'Error updating password' });
            }

            if (updateResult.affectedRows === 0) {
              return res.status(400).json({ error: 'User not found' });
            }

            // Generate a new token
            const newToken = jwt.sign({ userId: result[0].user_id }, 'your_secret_key', { expiresIn: '7d' });

            // Send the new token in the response
            return res.status(200).json({ message: 'Password reset successfully', token: newToken });
          }
        );
      });
    }
  );
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

      // Update last_seen timestamp
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
          balance: user.balance
        }
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
