let currentPanelCount = 4;
let gameInPlay = false;
let spinSpeed = 10;
let userBalance = "";
let selectedBet = null;
const spinButton = document.querySelector(".spin-button");
const betButtons = document.querySelectorAll(".bet-button");
let panel = [];
const cardHeight = 130;
let game = { ani: null };
let isSpinning = false;
let userWelcome = document.getElementById(".welcome-message");
let jackpotTriggered = null;
const bountyJackpotCards = [
  "circle_12.png",
  "circle_4.png",
  "cross_5.png",
  "cross_13.png",
];

let cardSet = ["circle_1.png", "circle_2.png", "circle_3.png", "circle_4.png", "circle_5.png", "circle_7.png", "circle_8.png", "circle_10.png", "circle_11.png", "circle_12.png", "circle_13.png", "circle_14.png", "triangle_1.png", "triangle_2.png", "triangle_3.png", "triangle_4.png", "triangle_5.png", "triangle_7.png", "triangle_8.png", "triangle_10.png", "triangle_11.png","triangle_12.png", "triangle_13.png", "triangle_14.png","cross_1.png","cross_2.png", "cross_3.png", "cross_5.png", "cross_7.png", "cross_10.png", "cross_11.png", "cross_13.png", "cross_14.png", "square_1.png", "square_2.png", "square_3.png", "square_5.png", "square_7.png", "square_10.png", "square_11.png", "square_13.png", "square_14.png", "star_1.png", "star_2.png", "star_3.png", "star_4.png", "star_5.png", "star_7.png", "star_8.png", "whot_20.png",
];

document.addEventListener("DOMContentLoaded", function () {
  displayUserInfo();
  init();
  updateBountyJackpotCards(bountyJackpotCards);

  betButtons.forEach((button) => {
    button.addEventListener("click", () => {
      betButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      selectedBet = parseInt(button.textContent.replace("₦", ""), 10);
      spinButton.disabled = false;
    });
  });

  spinButton.addEventListener("click", async () => {
    if (isSpinning) {
      return;
    }
    displayUserInfo();
    if (!selectedBet || userBalance < selectedBet) {
      const message =
        userBalance < selectedBet
          ? "Insufficient balance."
          : "Please select a bet amount.";
      updateMessage(message, true);
      return;
    }

    if (!gameInPlay) {
      isSpinning = true;
      try {
        userBalance -= selectedBet;
        await updateBalanceOnServer(userBalance);
        startSpin();
        displayUserInfo();
      } catch (error) {
        Sentry.captureException(new Error("An error occurred during the spin: " + error));
      } finally {
        isSpinning = false;       
      }
    }
  });
});

function init() {
  const slotDisplay = document.querySelector(".slot-display");

  slotDisplay.innerHTML = "";

  for (let i = 0; i < currentPanelCount; i++) {
    panel[i] = makeElement(slotDisplay, "div", "panel");
    const wheel = makeElement(panel[i], "div", "wheel");

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
}

function startSpin() {
  updateMessage(`Spinning... Bet: ₦${selectedBet}.`);
  disableButtons();

  gameInPlay = true;
  isSpinning = true;
  spinSpeed = 30;

  for (let i = 0; i < currentPanelCount; i++) {
    const wheel = panel[i].querySelector(".wheel");
    panel[i].mover = Math.floor(Math.random() * 800 + 100);
  }
  game.ani = requestAnimationFrame(spin);
}

function spin() {
  let spinner = 1000;
  spinner--;
  if (spinner <= 0) {
    stopGameplay();
    return;
  }

  let holder = [];
  let allStopped = true;

  for (let i = 0; i < currentPanelCount; i++) {
    const el = panel[i];
    const wheel = el.querySelector(".wheel");
    let offsetY = parseFloat(getComputedStyle(wheel).top) || 0;

    if (el.mover > 0) {
      el.mover--;
      offsetY += spinSpeed;

      if (offsetY > -cardHeight) {
        offsetY -= cardHeight;
        const lastCard = wheel.lastElementChild;
        wheel.prepend(lastCard);
      }

      allStopped = false;
      if (el.mover === 0 && offsetY % cardHeight !== 0) {
        el.mover++;
      }
    }

    wheel.style.top = `${offsetY}px`;

    // Store visible card for result aggregation
    if (el.mover === 0) {
      const visibleCard = wheel.children[1].querySelector("img").src.split("/").pop();
      holder.push(visibleCard);
    }
  }

  // Aggregate results when all wheels stop
  if (allStopped) {
    gameInPlay = false;
    cancelAnimationFrame(game.ani);
    stopGameplay();
    return;
  }

  game.ani = requestAnimationFrame(spin);
}

function stopGameplay() {
  gameInPlay = false;
  cancelAnimationFrame(game.ani);
  enableButtons();

  holder = [];
  for (let i = 0; i < currentPanelCount; i++) {
    const wheel = panel[i].querySelector(".wheel");
    const secondCard = wheel.children[1].querySelector("img").src.split("/").pop();
    holder.push(secondCard);
  }

  const outcome = holder;
  const jackpotType = jackpotTriggered;
  payout = calculatePayout();
  saveGameOutcome(
    selectedBet,
    currentPanelCount,
    outcome,
    payout,
    jackpotType,
    userBalance
  );
}

// Function to handle win message and update payout
const handleWin = (winType, payout) => {
  updateMessage(`You won ₦${payout}! ${winType} win!`);
  playSound();
  jackpotTriggered = winType;
};

// Payout multipliers 
const payoutMultipliers = {
  ultimate: 1000,
  platinum: 500,
  gold: 300,
  silver: 50,
  bounty: 5000,
  bonusShape: 10,
  bonusNumber: 5,
};

const allMatch = (array, condition) => array.every(condition);

function handleWinActions(payout, jackpotType, winMessage) {
  updateMessage(winMessage);
  celebrateWin();
  playSound();
  userBalance += payout;
  displayUserInfo();
  updateBalanceOnServer(userBalance);
}

function calculatePayout() {
  const panelCards = holder;
  let payout = 0;
  let jackpotType = null;
  let winMessage = "";

  if (panelCards.includes(bountyJackpotCards[0]) &&
      panelCards.includes(bountyJackpotCards[1]) &&
      panelCards.includes(bountyJackpotCards[2]) &&
      panelCards.includes(bountyJackpotCards[3])) {
    payout = payoutMultipliers.bounty * selectedBet;
    jackpotType = "Bounty";
    winMessage = `${jackpotType}!! You win ₦${payout}!!!`;
    handleWinActions(payout, jackpotType, winMessage);
  }  
  else if (panelCards.every(card => card === "whot_20.png")) {
    payout = payoutMultipliers.ultimate * selectedBet;
    jackpotType = "Ultimate";
    winMessage = `${jackpotType}!! You win ₦${payout}!!!`;
    handleWinActions(payout, jackpotType, winMessage);
  } 
  else if (panelCards.every(card => card === panelCards[0])) {
    payout = payoutMultipliers.platinum * selectedBet;
    jackpotType = "Platinum";
    winMessage = `${jackpotType} JACKPOT!! You win ₦${payout}!!!`;
    handleWinActions(payout, jackpotType, winMessage);
  } 
  else if (allMatch(panelCards, card => card.split("_")[1] === panelCards[0].split("_")[1])) {
    payout = payoutMultipliers.gold * selectedBet;
    jackpotType = "Gold";
    winMessage = `${jackpotType} JACKPOT!! You win ₦${payout}!!!`;
    handleWinActions(payout, jackpotType, winMessage);
  } 
  else if (allMatch(panelCards, card => card.split("_")[0] === panelCards[0].split("_")[0])) {
    payout = payoutMultipliers.silver * selectedBet;
    jackpotType = "Silver";
    winMessage = `${jackpotType} JACKPOT!! You win ₦${payout}!!!`;
    handleWinActions(payout, jackpotType, winMessage);
  } 
  else if (panelCards.filter(card => card.split("_")[1] === panelCards[0].split("_")[1]).length >= 3) {
    payout = payoutMultipliers.bonusShape * selectedBet;
    jackpotType = "Bonus Shape";
    const sameNumber = panelCards[0].split("_")[1];
    winMessage = `You got 3 ${sameNumber}s!! You win ₦${payout} bonus!!`;
    handleWinActions(payout, jackpotType, winMessage);
  } 
  else if (panelCards.filter(card => card.split("_")[0] === panelCards[0].split("_")[0]).length >= 3) {
    payout = payoutMultipliers.bonusNumber * selectedBet;
    jackpotType = "Bonus Number";
    const sameShape = panelCards[0].split("_")[0];
    winMessage = `You got 3 ${sameShape}s!! You win ₦${payout} bonus!!`;
    handleWinActions(payout, jackpotType, winMessage);
  }
  if (payout === 0) {
    updateMessage("No win this time. Try again.");
    jackpotTriggered = null;
  }
  return payout;
};

function updateBountyJackpot(cards, jackpotAmount) {
  const bountyCardBox = document.getElementById('bounty-card-box');
  const bountyAmountElement = document.getElementById('bounty-amount');
  
  bountyCardBox.innerHTML = '';

  cards.forEach(card => {
    const imgElement = document.createElement('img');
    imgElement.src = `cards/${card}`;
    imgElement.alt = `${card} Card`;
    imgElement.classList.add('bounty-card-image');
    bountyCardBox.appendChild(imgElement);
  });

  bountyAmountElement.textContent = `N${jackpotAmount}`;
}

updateBountyJackpot(bountyJackpotCards, "2,000,000");

async function checkToken() {
  try {
    const jwt_decode = (await import("jwt-decode")).default;
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
  const alertContainer = document.createElement("div");
  alertContainer.style.position = "fixed";
  alertContainer.style.top = "50%";
  alertContainer.style.left = "50%";
  alertContainer.style.transform = "translate(-50%, -50%)";
  alertContainer.style.backgroundColor = "#f8d7da";
  alertContainer.style.color = "#721c24";
  alertContainer.style.padding = "20px";
  alertContainer.style.border = "1px solid #f5c6cb";
  alertContainer.style.borderRadius = "5px";
  alertContainer.style.zIndex = "1000";
  alertContainer.innerHTML = `
      <p>Your session has expired. Please log in again.</p>
      <button id="loginButton" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px;">Log in</button>
  `;

  document.body.appendChild(alertContainer);

  document.getElementById("loginButton").addEventListener("click", () => {
    window.location.href = "/login";
  });
};

async function updateBalanceOnServer(balance) {
  try {
    const token = getToken();
    if (!token) {
      throw new Error("No authentication token found.");
    }

    const response = await fetch(
      "https://slot-backend-f32n.onrender.com/balance",
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ balance }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update user balance on the server.");
    }
  } catch (error) {}
}
const throttle = (func, limit) => {
  let lastFunc;
  let lastTime;
  return function() {
    const now = new Date().getTime();
    if (lastTime && now - lastTime < limit) {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(() => {
        lastTime = now;
        func.apply(this, arguments);
      }, limit - (now - lastTime));
    } else {
      lastTime = now;
      func.apply(this, arguments);
    }
  };
};

const fetchWinners = async () => {
  try {
    const response = await fetch("https://slot-backend-f32n.onrender.com/winners");
    const data = await response.json();
    if (data.winners && data.winners.length > 0) {
      const winnersText = data.winners.join(" ");
      document.getElementById("winners-banner").innerHTML = `<div class="winner-marquee">${winnersText}</div>`;
    }
  } catch (error) {
    Sentry.captureException(new Error("Error fetching winners:", error));
  }
};

const throttledFetchWinners = throttle(fetchWinners, 30000);
throttledFetchWinners();
setInterval(throttledFetchWinners, 30000);

let inactivityTimer;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000;

const stopAnimation = () => {
  cancelAnimationFrame(game.ani);
};

const resetInactivityTimer = () => {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(stopAnimation, INACTIVITY_TIMEOUT);
};

window.addEventListener('mousemove', resetInactivityTimer);
window.addEventListener('keydown', resetInactivityTimer);
window.addEventListener('click', resetInactivityTimer);
window.addEventListener('touchstart', resetInactivityTimer);

resetInactivityTimer();


// Utility function to shuffle an array
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Fetch and display user info
const displayUserInfo = () => {
  const token = localStorage.getItem("token");

  if (!token) {
    Sentry.captureException(new Error("No token found"));
    return;
  }

  fetch("https://slot-backend-f32n.onrender.com/user-info", {
    method: "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to fetch user info");
      }
      return response.json();
    })
    .then((data) => {
      const welcomeMessage = document.getElementById("welcome-message");
      const userBalanceDisplay = document.getElementById("userBalance");
      welcomeMessage.innerHTML = `Welcome, ${capitalizeFirstLetter(
        data.username
      )}`;
      userBalanceDisplay.innerHTML = `Balance: ₦${data.balance}`;
      userBalance = data.balance;
    })
    .catch((error) => {
      Sentry.captureException(new Error("Error fetching user info:", error));
    });
};

// Capitalize the first letter of the username
const capitalizeFirstLetter = (username) => {
  return username.charAt(0).toUpperCase() + username.slice(1);
};

async function saveGameOutcome(
  betAmount,
  numberOfPanels,
  outcome,
  payout,
  jackpotType,
  userBalance
) {
  const token = localStorage.getItem("token");

  if (!token) {
    Sentry.captureException(new Error("No token available."));
    return;
  }

  const gameData = {
    betAmount,
    numberOfPanels,
    outcome,
    payout,
    jackpot_type: jackpotType,
    userBalance,
  };

  try {
    const response = await fetch(
      "https://slot-backend-f32n.onrender.com/outcome",
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(gameData),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to save game outcome");
    }

    const data = await response.json();
  } catch (error) {
    Sentry.captureException(new Error("Error saving game outcome:", error));
  }
}

function disableButtons() {
  spinButton.disabled = true;
  betButtons.forEach((button) => (button.disabled = true));
}

function enableButtons() {
  spinButton.disabled = false;
  betButtons.forEach((button) => (button.disabled = false));
}

function updateMessage(text, isError = false) {
  const messageBox = document.querySelector(".messageBox");
  messageBox.textContent = text;
  messageBox.style.color = isError ? "red" : "";
}

// Utility function to create elements
function makeElement(parent, element, myClass) {
  const el = document.createElement(element);
  el.classList.add(myClass);
  parent.append(el);
  return el;
}

function getToken() {
  const token = localStorage.getItem("token");
  return token;
}

function playSound() {
  const sound = new Audio("sound.mp3");
  sound.play();
}

// Load the confetti script
function loadConfettiScript(callback) {
  if (typeof confetti !== "undefined") {
    callback();
    return;
  }

  const script = document.createElement("script");
  script.src =
    "https://cdn.jsdelivr.net/npm/canvas-confetti@1.4.0/dist/confetti.browser.min.js";
  script.onload = callback;
  document.body.appendChild(script);
}

// Confetti
function celebrateWin() {
  loadConfettiScript(() => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  });
}

// Modal elements
const modal = document.getElementById("updateProfileModal");
const closeBtn = document.getElementById("closeProfileModal");
const form = document.getElementById("updateProfileForm");

// Open the modal when the profile link is clicked
document.getElementById("profileLink").addEventListener("click", function () {
  modal.style.display = "block";
  fetchUserProfile();
});

// Close the modal when the close button is clicked
let isFormChanged = false;

closeBtn.addEventListener("click", function () {
  if (isFormChanged) {
    const discardChanges = confirm("Discard changes?");
    if (discardChanges) {
      modal.style.display = "none";
    }
  } else {
    modal.style.display = "none";
  }
});

// Handle form submission
form.addEventListener("submit", function (event) {
  event.preventDefault();

  const userProfile = {
    username: document.getElementById("username").value,
    email: document.getElementById("email").value,
    phone_number: document.getElementById("phone_number").value,
    bank_name: document.getElementById("bank_name").value,
    bank_account_number: document.getElementById("bank_account_number").value,
    account_name: document.getElementById("account_name").value,
  };

  const token = localStorage.getItem("token");
  fetch("https://slot-backend-f32n.onrender.com/update-profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify(userProfile),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.message) {
        alert("Profile updated successfully!");
        modal.style.display = "none";
        isFormChanged = false;
      } else {
        alert("Error updating profile: " + data.error);
      }
    })
    .catch((error) => {
      Sentry.captureException(new Error("Error:", error));
      alert("An error occurred while updating the profile");
    });
});

// Fetch user profile data
function fetchUserProfile() {
  const token = localStorage.getItem("token");
  fetch("https://slot-backend-f32n.onrender.com/user-info", {
    method: "GET",
    headers: {
      Authorization: token,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      // Set default values
      document.getElementById("user_id").value = data.user_id;
      document.getElementById("username").value = data.username || "";
      document.getElementById("email").value = data.email || "";
      document.getElementById("phone_number").value = data.phone_number || "";
      document.getElementById("bank_name").value = data.bank_name || "";
      document.getElementById("bank_account_number").value =
        data.bank_account_number || "";
      document.getElementById("account_name").value = data.account_name || "";

      // Set placeholder text for empty fields
      setPlaceholderText("username", "Enter your username here");
      setPlaceholderText("email", "Enter your email here");
      setPlaceholderText("phone_number", "Enter your phone number here");
      setPlaceholderText("bank_name", "Enter your bank name here");
      setPlaceholderText(
        "bank_account_number",
        "Enter your bank account number here"
      );
      setPlaceholderText("account_name", "Enter your account name here");
    })
    .catch((error) => {
      Sentry.captureException(new Error("Error fetching user profile:", error));
    });
}

// Set placeholder text if the field is empty
function setPlaceholderText(fieldId, placeholderText) {
  const field = document.getElementById(fieldId);
  if (!field.value) {
    field.placeholder = placeholderText;
  }
}

// Track form changes
const formFields = [
  "username",
  "email",
  "phone_number",
  "bank_name",
  "bank_account_number",
  "account_name",
];
formFields.forEach((field) => {
  const input = document.getElementById(field);
  input.addEventListener("input", function () {
    isFormChanged = true;
  });
});

// Handle dropdown and modal functionality
document.addEventListener("DOMContentLoaded", function () {
  const dropdownButton = document.getElementById("accountSettings");
  const dropdownMenu = document.getElementById("accountSettingsDropdown");
  const profileLink = document.getElementById("accountSettingsDropdown");
  const modal = document.getElementById("updateProfileModal");
  const closeModal = document.getElementById("closeProfileModal");

  // Flag to track if dropdown is open
  let isDropdownOpen = false;

  // Function to toggle the dropdown menu
  function toggleDropdown() {
    dropdownMenu.style.display = isDropdownOpen ? "none" : "block";
    isDropdownOpen = !isDropdownOpen;
  }

  // Open dropdown when Account Settings is clicked
  dropdownButton.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleDropdown();
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function (event) {
    if (
      !dropdownButton.contains(event.target) &&
      !dropdownMenu.contains(event.target)
    ) {
      if (isDropdownOpen) {
        dropdownMenu.style.display = "none";
        isDropdownOpen = false;
      }
    }
  });

  // Prevent closing dropdown when clicking inside
  dropdownMenu.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  // Open modal when Profile is clicked
  profileLink.addEventListener("click", function (event) {
    event.preventDefault();
    modal.style.display = "block";
    fetchUserProfile();
  });

  // Close modal on clicking the close button
  closeModal.addEventListener("click", function () {
    modal.style.display = "none";
  });

  // Close modal on clicking outside the modal content
  window.addEventListener("click", function (event) {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });
});

async function fetchBountyJackpotPrize() {
  try {
    const response = await fetch('https://slot-backend-f32n.onrender.com/bounty-jackpot?panelType=4');
    const data = await response.json();
    const jackpotAmount = data.bountyPrize;
    updateBountyJackpot(jackpotAmount);
  } catch (error) {
    Sentry.captureException(new Error('Error fetching jackpot prize: ' + error.message));
  }
}

function updateBountyJackpot(amount) {
  const bountyAmountElement = document.getElementById('bounty-amount');
  if (bountyAmountElement) {
    bountyAmountElement.innerText = `₦${Math.floor(amount).toLocaleString()}`;
  } else {
    Sentry.captureException(new Error('Element with id "bounty-amount" not found.'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchBountyJackpotPrize();
  setInterval(fetchBountyJackpotPrize, 60000);  // Fetch every minute
});

function updateBountyJackpotCards(cards) {
  const bountyCardBox = document.getElementById('bounty-card-box');  
  bountyCardBox.innerHTML = '';

  cards.forEach(card => {
    const imgElement = document.createElement('img');
    imgElement.src = `cards/${card}`;
    imgElement.alt = `${card} Card`;
    imgElement.classList.add('bounty-card-image');
    bountyCardBox.appendChild(imgElement);
  });
};

// Get necessary elements
const logoutButton = document.getElementById('logout');
const playWhotButton = document.getElementById('play-whot');
const playOtherGamesButton = document.getElementById('landing-page');

// Function to log out the user and invalidate the token
function logoutUser() {
  // Remove token and user-related data from localStorage
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('referral_code');

  // Redirect to the login page
  window.location.href = 'index.html';
}

// Redirect to the landing page when clicking "Play WHOT" or "Play Other Games"
function redirectToLandingPage() {
  window.location.href = 'landing-page.html';
}

// Attach event listeners
logoutButton.addEventListener('click', logoutUser);
playWhotButton.addEventListener('click', redirectToLandingPage);
playOtherGamesButton.addEventListener('click', redirectToLandingPage);

