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

// Homepage endpoint to check if the server is live
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is live and running!o',
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

// Function to register a user
async function registerUser(username, password, email, phone_number, referralCode, referrerId) {
  return new Promise((resolve, reject) => {
    db.query(
      'INSERT INTO users (username, password, balance, email, phone_number, referralCode) VALUES (?, ?, ?, ?, ?, ?)',
      [username, password, 200, email, phone_number, referralCode],
      (err, insertResult) => {
        if (err) {
          console.error('Error registering user:', err.message);
          reject(err);
        } else {
          const newUserId = insertResult.insertId;

          // Log referral if referrerId is provided
          if (referrerId) {
            db.query(
              'INSERT INTO user_referrals (referrer_id, referred_id) VALUES (?, ?)',
              [referrerId, newUserId],
              (referralErr) => {
                if (referralErr) {
                  console.error('Error logging referral:', referralErr.message);
                }
              }
            );
          }
          resolve(newUserId);
        }
      }
    );
  });
}

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { username, password, email, phone_number, referrerCode } = req.body;

    if (!username || !password || (!email && !phone_number)) {
      return res.status(400).json({
        error: 'Username, password, and either email or phone number are required',
      });
    }

    // Generate a unique referral code
    const referralCode = await generateUniqueReferralCode();

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Validate referral code if provided
    let referrerId = null;
    if (referrerCode) {
      const referrerResult = await new Promise((resolve, reject) => {
        db.query(
          'SELECT user_id FROM users WHERE referralCode = ?',
          [referrerCode],
          (err, result) => {
            if (err) reject(err);
            resolve(result);
          }
        );
      });

      if (referrerResult.length === 0) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }

      referrerId = referrerResult[0].user_id;
    }

    // Register the user
    const newUserId = await registerUser(username, hashedPassword, email, phone_number, referralCode, referrerId);

    // Generate token for the new user
    const token = jwt.sign({ userId: newUserId }, 'your_secret_key', { expiresIn: '7d' });

    return res.status(201).json({ message: 'User registered successfully', token });
  } catch (err) {
    console.error('Error during registration:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;

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
      
      res.status(200).json({
        token,
        username: user.username,
        isSuperuser: user.isSuperuser, 
        superuserCode: user.superuserCode,
      });
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
      referral_code: user.referral_code,
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

    db.query('SELECT user_id, referral_code, username, email, phone_number, bank_name, bank_account_number, account_name FROM users WHERE user_id = ?', [req.user_id], (err, result) => {
      if (err) {
        console.error('Error fetching updated user data:', err);
        return res.status(500).json({ error: 'Error fetching updated user data' });
      }

      const updatedUser = result[0];
      res.status(200).json({
        message: 'Profile updated successfully',
        user_id: updatedUser.user_id,
        referral_code: updatedUser.referral_code,
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


const redis = require('redis');

// Extract credentials and host information from the Redis URL
const redisUrl = process.env.REDIS_URL || 'redis://red-ctpeidjqf0us73ebbcp0:6379'; // Use your Redis URL
const redisClient = redis.createClient({
  url: redisUrl,
});

// Event listeners for Redis connection
redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

redisClient.on('ready', () => {
  console.log('Redis client is ready');
});

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

// Graceful shutdown of Redis
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down Redis client');
  await redisClient.quit();
  process.exit();
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
    console.log('Redis connection established');
  } catch (error) {
    console.error('Error connecting to Redis:', error);
  }
})();

// Cache functions
const getCachedBountyPrize = async () => {
  try {
    const data = await redisClient.get('bountyPrize');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error fetching cached bounty prize:', error);
    throw error;
  }
};

const cacheBountyPrize = async (prize) => {
  try {
    await redisClient.setEx('bountyPrize', 180, JSON.stringify(prize)); // Updated to `setEx` method
    console.log('Bounty prize cached successfully');
  } catch (error) {
    console.error('Error caching bounty prize:', error);
  }
};

// Bounty prize route
app.get('/bounty-jackpot', async (req, res) => {
  try {
    const panelType = req.query.panelType;
    if (!panelType || (panelType !== '3' && panelType !== '4')) {
      return res.status(400).json({ error: 'Invalid panel type. Please use "3" or "4".' });
    }

    // Check Redis cache for the bounty prize
    const cachedPrize = await getCachedBountyPrize();
    if (cachedPrize) {
      return res.status(200).json({ bountyPrize: cachedPrize });
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
      SELECT ur.referral_code, SUM(b.amount_bet) AS total_bet
      FROM users u
      JOIN games_outcomes b ON u.user_id = b.user_id
      JOIN user_referrals ur ON ur.user_id = u.user_id
      WHERE ur.referral_code IS NOT NULL
      GROUP BY ur.referral_code
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error('Error calculating referral bets:', err);
        return;
      }

      console.log('Referral bet totals:', results);

      // Calculate referral bonus for each referral_code
      results.forEach(result => {
        const { referral_code, total_bet } = result;

        const referralBonus = total_bet * bonusPercentage;

        // Store the results (total bet and referral bonus) in the cache
        cache.set(`referral_code:${referral_code}:total_bet`, total_bet);
        cache.set(`referral_code:${referral_code}:referral_bonus`, referralBonus); 
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
    const referralBonus = await cache.get(`referral_code:${referral_code}:referral_bonus`);

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
