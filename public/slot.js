let currentPanelCount =4; 
let gameInPlay = false;
let holder = [];
let spinSpeed = 7;
let userBalance = 10000; 
let selectedBet = null;
const spinButton = document.querySelector('.spin-button');
const betButtons = document.querySelectorAll('.bet-button');
const panelSelectors = document.querySelectorAll('.panel-selector');
let panel = [];
const cardHeight = 130;
let game = { ani: null };
let serverResponse = [];
let isSpinning = true;
userWelcome = document.getElementById('welcome-message');

let cardSet = [
  "circle_1.png", "circle_2.png", "circle_3.png", "circle_4.png", "circle_5.png",
  "circle_7.png", "circle_8.png", "circle_10.png", "circle_11.png", "circle_12.png",
  "circle_13.png", "circle_14.png", "triangle_1.png", "triangle_2.png", "triangle_3.png",
  "triangle_4.png", "triangle_5.png", "triangle_7.png", "triangle_8.png", "triangle_10.png",
  "triangle_11.png", "triangle_12.png", "triangle_13.png", "triangle_14.png", "cross_1.png",
  "cross_2.png", "cross_3.png", "cross_5.png", "cross_7.png", "cross_10.png", "cross_11.png",
  "cross_13.png", "cross_14.png", "square_1.png", "square_2.png", "square_3.png", "square_5.png",
  "square_7.png", "square_10.png", "square_11.png", "square_13.png", "square_14.png",
  "star_1.png", "star_2.png", "star_3.png", "star_4.png", "star_5.png", "star_7.png",
  "star_8.png", "whot_20.png",
];

document.addEventListener("DOMContentLoaded", function () { 
  updateBalanceDisplay(); 
  init(); 

  // Event Listeners for bet buttons 
  betButtons.forEach(button => { 
    button.addEventListener('click', () => { 
      betButtons.forEach(btn => btn.classList.remove('active')); 
      button.classList.add('active'); 
      selectedBet = parseInt(button.textContent.replace('₦', ''), 10); 
      spinButton.disabled = false; 
    }); 
  }); 

  // Event Listener for spin button 
  spinButton.addEventListener('click', async () => { 
    if (!selectedBet || userBalance < selectedBet) {
      const message = userBalance < selectedBet ? 'Insufficient balance.' : 'Please select a bet amount.';
      updateMessage(message, true);
      return;
    }
    if (!gameInPlay) {
      await initializeGame(currentPanelCount); 
      startSpin(); 
    }
    userBalance -= selectedBet; 
    updateBalanceDisplay(); 
  }); 

  // Event Listeners for panel selection buttons 
  panelSelectors.forEach(button => { 
    button.addEventListener('click', () => { 
      console.log("Button clicked:", button.id);
      currentPanelCount = button.id === "three-panels" ? 3 : 4; 
      panelSelectors.forEach(btn => btn.classList.remove('active')); 
      button.classList.add('active'); 
      init(); 
    }); 
  }); 
});

// Fetch and update user details
async function updateUserDetails() {
    try {
        const response = await fetch('https://slot-backend-f32n.onrender.com/user-info', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user details: ' + response.statusText);
        }

        const data = await response.json();

        // Update username
        if (data.username) {
            userWelcome.textContent = `Welcome, ${data.username}`;
        }

        // Update balance
        if (data.balance !== undefined) {
            userBalance = data.balance;
            updateBalanceDisplay();
        }
    } catch (error) {
        console.error('Error fetching user details:', error);
        updateMessage('Failed to fetch user details. Please refresh the page.', true);
    }
}

// Update balance display
function updateBalanceDisplay() {
    const balanceElement = document.querySelector('.account-balance');
    if (balanceElement) {
        balanceElement.textContent = `Balance: ₦${userBalance}`;
    }
}

  // Utility function to create elements
  function makeElement(parent, element, myClass) {
    const el = document.createElement(element);
    el.classList.add(myClass);
    parent.append(el);
    return el;
  }

  // Function to apply styles based on the number of panels
  function applyStyles() {
    const panels = document.querySelectorAll('.panel');
    const wheels = document.querySelectorAll('.wheel');
    const cardContainers = document.querySelectorAll('.card-container');
    const cards = document.querySelectorAll('.card');

    panels.forEach(panel => {
      panel.style.width = '15dvw';
      panel.style.height = `${cardHeight}px`;
    });
  
    wheels.forEach(wheel => {
      wheel.style.width = '15dvw';
      wheel.style.height = `${cardHeight}px`; 
    });
  
    cardContainers.forEach(cardContainer => {
      cardContainer.style.width = '15dvw';
      cardContainer.style.height = `${cardHeight}px`; 
    });
  
    cards.forEach(card => {
      card.style.width = '15dvw';
      card.style.height = `${cardHeight}px`;
    });
  }

function init() {
    const slotDisplay = document.querySelector(".slot-display");

    slotDisplay.innerHTML = "";

    for (let i = 0; i < currentPanelCount; i++) {
        panel[i] = makeElement(slotDisplay, "div", "panel");
        const wheel = makeElement(panel[i], "div", "wheel");

        // Shuffle cards individually for each panel
        const shuffledCards = shuffle([...cardSet]);

        shuffledCards.forEach((card) => {
            const cardContainer = makeElement(wheel, "div", "card-container");
            const cardDiv = makeElement(cardContainer, "div", "card");
            const img = document.createElement("img");
            img.src = `cards/${card}`;
            img.alt = card;
            cardDiv.append(img);
        });
    }

    applyStyles();
}

  init();

//Start spinning animation
function startSpin(){
  gameInPlay = true;
  disableButtons();
  updateMessage(`Spinning... Bet: ₦${selectedBet}.`);

  for (let i = 0; i < currentPanelCount; i++) {
    const wheel = panel[i].querySelector('.wheel');
    const currentCard = wheel.firstChild.querySelector('img').src.split('/').pop();
    const targetCard = serverResponse[i];

    const currentIndex = cardSet.indexOf(currentCard);
    const targetIndex = cardSet.indexOf(targetCard);

    const spins = (currentIndex - targetIndex + cardSet.length) % cardSet.length + 10;
    panel[i].mover = Math.floor(spins) * 8;
  }
  
  game.ani = requestAnimationFrame(spin);    
}

function spin(){
  let allStopped = true;

  for (let i = 0; i < currentPanelCount; i++) {
      let el = panel[i];
      const wheel = el.querySelector('.wheel');
      let offsetY = parseFloat(getComputedStyle(wheel).top) || 0;

      if (el.mover > 0) {
          el.mover--;
          offsetY += spinSpeed;

          if (offsetY > -cardHeight) {
              offsetY -= cardHeight;
              const lastCard = wheel.lastElementChild;
              wheel.prepend(lastCard);
          }
          if (el.mover == 0 && 
              (offsetY % cardHeight != 0 || 
               cardSet.indexOf(wheel.firstChild.querySelector('img').src.split('/').pop()) !== cardSet.indexOf(serverResponse[i]))) {
              el.mover++;
          }

          allStopped = false;
      }

      wheel.style.top = `${offsetY}px`;
  }

  if (allStopped) {
      stopGameplay();
  } else {
      game.ani = requestAnimationFrame(spin);
  }
}

function stopGameplay() {
  gameInPlay = false;
  cancelAnimationFrame(game.ani);
  enableButtons();

  holder = [];

  for (let i = 0; i < currentPanelCount; i++) {
    const wheel = panel[i].querySelector('.wheel');
    const secondCard = wheel.children[1].querySelector('img').src.split('/').pop();
    holder.push(secondCard);
  }
  calculatePayout();
  saveGameOutcome();

  console.log("Final card names in holder:", holder);
}

function disableButtons() {
  spinButton.disabled = true;
  betButtons.forEach(button => button.disabled = true);
  panelSelectors.forEach(button => button.disabled = disabled);
}

function enableButtons() {
  spinButton.disabled = false;
  betButtons.forEach(button => button.disabled = false);
  panelSelectors.forEach(button => button.disabled = enabled);
}

function updateMessage(text, isError = false) {
  const messageBox = document.querySelector('.messageBox');
  messageBox.textContent = text;
  messageBox.style.color = isError ? 'red' : '';
}

function calculatePayout() {
  const panelCards = holder;
  let payout = 0;

  // Check for Ultimate (all cards are whot-20)
  const isUltimate = panelCards.every(card => card === "whot_20.png");
  if (isUltimate) {
    payout = currentPanelCount === 4 ? 2000 : 1000;
    updateMessage(`You won ₦${payout}! Ultimate win!`);
    playSound();
    jackpotTrigerred = 'Ultimate';
  }

  // Check for Platinum (all cards have the same suit and number)
  else if (panelCards.every(card => card === panelCards[0])) {
    payout = currentPanelCount === 4 ? 1000 : 500;
    updateMessage(`You won ₦${payout}! Platinum win!`);
    playSound();
    jackpotTrigerred = 'Platinum';
  }

  // Check for Gold (all cards have the same number but can have different suits)
  else if (panelCards.every(card => card.split('_')[1] === panelCards[0].split('_')[1])) {
    payout = currentPanelCount === 4 ? 500 : 300;
    updateMessage(`You won ₦${payout}! Gold win!`);
    playSound();
    jackpotTrigerred = 'Gold';
  }

  // Check for Silver (all cards have the same suit)
  else if (panelCards.every(card => card.split('_')[0] === panelCards[0].split('_')[0])) {
    payout = currentPanelCount === 4 ? 200 : 50;
    updateMessage(`You won ₦${payout}! Silver win!`);
    playSound();
    jackpotTrigerred = 'Silver';
  }

  // Check for Weekly Jackpot (specific predefined set of cards)
  else {
    const jackpotCards = ["circle_1.png", "circle_4.png", "cross_5.png", "cross_13.png"];
    const isJackpot = panelCards.includes(jackpotCards[0]) && panelCards.includes(jackpotCards[1]) && 
                      panelCards.includes(jackpotCards[2]) && panelCards.includes(jackpotCards[3]);

    if (isJackpot) {
      const jackpotPayout = 5000;
      payout = jackpotPayout;
      updateMessage(`You won ₦${payout}! Weekly Jackpot!`);
      playSound();
    jackpotTrigerred = 'Weekly Jackpot';
    }
  }

  // If no win
  if (payout === 0) {
    updateMessage("No win this time. Try again.");
    jackpotTrigerred = null;
  }

  // Update the user balance with the payout
  if (payout > 0) {
    userBalance += payout;
    updateBalanceDisplay();
  }
}

function updateBalanceDisplay() {
  const balanceElement = document.querySelector('.account-balance');
  if (balanceElement) {
    balanceElement.textContent = `Balance: ₦${userBalance}`;
  }
};

async function fetchCards(numPanels) {
    try {
        const response = await fetch('https://randomiser-ongf.onrender.com/getCards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ numPanels }),
        });

        if (!response.ok) {
            throw new Error('Failed to fetch cards: ' + response.statusText);
        }

        const data = await response.json();
        if (data.error) {
            console.error('Server Error:', data.error);
            return [];
        }

        return data.cards;
    } catch (error) {
        console.error('Error:', error);
        return [];
    }
}

async function initializeGame(numPanels) {
    serverResponse = await fetchCards(numPanels);

    if (serverResponse.length > 0) {
        console.log('Cards received from server:', serverResponse);
    } else {
        console.error('Failed to initialize game due to missing card data.');
    }
}

async function checkToken() {
  try {
      const jwt_decode = (await import('jwt-decode')).default;
      const token = getToken();

      if (!token) {
          showSessionExpiredAlert();
          return;
      }

      const decoded = jwt_decode(token);
      const currentTime = Date.now() / 1000; 
      if (decoded.exp < currentTime) {
          showSessionExpiredAlert(); 
      } else {
          return;
      }
  } catch (error) {
      showSessionExpiredAlert();
  }
}

function showSessionExpiredAlert() {
  const alertContainer = document.createElement('div');
  alertContainer.style.position = 'fixed';
  alertContainer.style.top = '50%';
  alertContainer.style.left = '50%';
  alertContainer.style.transform = 'translate(-50%, -50%)';
  alertContainer.style.backgroundColor = '#f8d7da';
  alertContainer.style.color = '#721c24';
  alertContainer.style.padding = '20px';
  alertContainer.style.border = '1px solid #f5c6cb';
  alertContainer.style.borderRadius = '5px';
  alertContainer.style.zIndex = '1000';
  alertContainer.innerHTML = `
      <p>Your session has expired. Please log in again.</p>
      <button id="loginButton" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px;">Log in</button>
  `;

  document.body.appendChild(alertContainer);

  document.getElementById('loginButton').addEventListener('click', () => {
      window.location.href = '/login';
  });
};

function getToken() {
  const token = localStorage.getItem('token');
  return token;
};

async function saveGameOutcome(user_id, betAmount, numberOfPanels, outcome, payout, jackpot_type) {
    const token = getToken();
    if (!token) {
        console.error("Token not found. User might not be logged in.");
        updateMessage('Your session has expired. Please log in again.', true);
        return;
    }

    // Prepare the data to be sent
    const requestData = {
        user_id,
        betAmount,
        numberOfPanels,
        holder: outcome,
        payout,
        jackpot_type,
    };

    // Log the request data to the console
    console.log("Data being sent to backend:", requestData);

    try {
        const response = await fetch("https://slot-backend-f32n.onrender.com/outcome", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Failed to save game outcome:", errorData);
            throw new Error(errorData.message || response.statusText);
        }

        const data = await response.json();

        // Check if the backend returned the updated balance
        if (data.balance_after_spin !== undefined) {
            userBalance = data.balance_after_spin;
            updateBalanceDisplay();
        } else {
            console.warn("balance_after_spin not found in the response:", data);
        }

        console.log("Game outcome saved successfully:", data);
    } catch (error) {
        console.error("Error saving game outcome:", error);
        updateMessage('Failed to save game outcome. Please try again.', true);
    }
}


function playSound() {
  const sound = new Audio('sprites/sound.mp3');
  sound.play();
}

const getUserInfo = () => {
  const token = localStorage.getItem('token');

  if (!token) {
      return;
  }

  fetch('https://slot-backend-f32n.onrender.com/user-info', {
      method: 'GET',
      headers: {
          Authorization: token,
          'Content-Type': 'application/json',
      },
  })
  .then((response) => {
      if (!response.ok) {
          throw new Error('Failed to fetch user info');
      }
      return response.json();
  })
  .then((data) => {
      userBalance = Math.floor(data.balance);
      userWelcome.innerHTML = `Welcome, ${data.username}`;
  })
  .catch((error) => {
      console.error('Error fetching user info:', error);
  });
};

async function updateBalanceOnServer(balance) {
  try {
      const token = getToken();
      if (!token) {
          throw new Error('No authentication token found.');
      }

      const response = await fetch("https://slot-backend-f32n.onrender.com/balance", {
          method: "POST",
          headers: {
              Authorization: token,
              "Content-Type": "application/json",
          },
          body: JSON.stringify({ balance }),
      });

      if (!response.ok) {
          throw new Error("Failed to update user balance on the server.");
      }
  } catch (error) {}
};

// Function to fetch winners and update the banner
const fetchWinners = async () => {
  try {
    const response = await fetch('https://slot-backend-f32n.onrender.com/winners');
    const data = await response.json();
    if (data.winners && data.winners.length > 0) {
      const winnersText = data.winners.join(' ');
      document.getElementById('winner-banner').innerHTML = `<div class="winner-marquee">${winnersText}</div>`;
    }
  } catch (error) {
  }
};

fetchWinners();
setInterval(fetchWinners, 30000); 

// Utility function to shuffle an array
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
