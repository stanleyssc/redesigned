let currentPanelCount = 4;
let gameInPlay = false;
let holder = [];
let spinSpeed = 10;  // Initial speed
let userBalance = "";
let selectedBet = null;
const spinButton = document.querySelector(".spin-button");
const betButtons = document.querySelectorAll(".bet-button");
const panelSelectors = document.querySelectorAll(".panel-selector");
let panel = [];
const cardHeight = 130;
let game = { ani: null };
let serverResponse = [];
let isSpinning = false;
let userWelcome = document.getElementById(".welcome-message");
let jackpotTriggered = null;

let cardSet = ["circle_1.png", "circle_2.png", "circle_3.png", "circle_4.png", "circle_5.png", "circle_7.png", "circle_8.png", "circle_10.png", "circle_11.png", "circle_12.png", "circle_13.png", "circle_14.png", "triangle_1.png", "triangle_2.png", "triangle_3.png", "triangle_4.png", "triangle_5.png", "triangle_7.png", "triangle_8.png", "triangle_10.png", "triangle_11.png","triangle_12.png", "triangle_13.png", "triangle_14.png","cross_1.png","cross_2.png", "cross_3.png", "cross_5.png", "cross_7.png", "cross_10.png", "cross_11.png", "cross_13.png", "cross_14.png", "square_1.png", "square_2.png", "square_3.png", "square_5.png", "square_7.png", "square_10.png", "square_11.png", "square_13.png", "square_14.png", "star_1.png", "star_2.png", "star_3.png", "star_4.png", "star_5.png", "star_7.png", "star_8.png", "whot_20.png",
];

document.addEventListener("DOMContentLoaded", function () {
  displayUserInfo();
  init();

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
        // await initializeGame(currentPanelCount);
        startSpin();
        updateBalanceOnDisplay(userBalance);
        await updateBalanceOnServer(userBalance);
      } catch (error) {
        console.error("An error occurred during the spin:", error);
      } finally {
        isSpinning = false;
        userBalance -= selectedBet;
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
  // applyStyles();
}

function startSpin() {
  if (!selectedBet || userBalance < selectedBet) {
    const message =
      userBalance < selectedBet
        ? "Insufficient balance."
        : "Please select a bet amount.";
    updateMessage(message, true);
    return;
  }

  // Deduct bet and update balance
  userBalance -= selectedBet;
  updateBalanceOnDisplay(userBalance);
  updateMessage(`Spinning... Bet: ₦${selectedBet}.`);
  disableButtons();

  gameInPlay = true;
  isSpinning = true;
  spinSpeed = 30; // Reset spin speed

  // Assign random spin count for each wheel
  for (let i = 0; i < currentPanelCount; i++) {
    const wheel = panel[i].querySelector(".wheel");
    panel[i].mover = Math.floor(Math.random() * 800 + 10);
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
      offsetY += spinSpeed; // Speed up the spin effect

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

// Utility function to check if all elements in an array match a condition
const allMatch = (array, condition) => array.every(condition);

// Function to handle win message and update payout
const handleWin = (winType, payout) => {
  updateMessage(`You won ₦${payout}! ${winType} win!`);
  playSound();
  jackpotTriggered = winType;
};

// Define the payout multipliers in an object
const payoutMultipliers = {
  ultimate: 1000,
  platinum: 500,
  gold: 300,
  silver: 50,
  bounty: 5000,
};

// Function to calculate payout
function calculatePayout() {
  const panelCards = holder;
  let payout = 0;

  if (panelCards.every((card) => card === "whot_20.png")) {
    payout = payoutMultipliers.ultimate * selectedBet;
    updateMessage(`You won ₦${payout}! Ultimate win!`);
    playSound();
    jackpotTriggered = "Ultimate";
  } else if (panelCards.every((card) => card === panelCards[0])) {
    payout = payoutMultipliers.platinum * selectedBet;
    updateMessage(`You won ₦${payout}! Platinum win!`);
    playSound();
    jackpotTriggered = "Platinum";
  } else if (
    panelCards.every(
      (card) => card.split("_")[1] === panelCards[0].split("_")[1]
    )
  ) {
    payout = payoutMultipliers.gold * selectedBet;
    updateMessage(`You won ₦${payout}! Gold win!`);
    playSound();
    jackpotTriggered = "Gold";
  } else if (
    panelCards.every(
      (card) => card.split("_")[0] === panelCards[0].split("_")[0]
    )
  ) {
    payout = payoutMultipliers.silver * selectedBet;
    updateMessage(`You won ₦${payout}! Silver win!`);
    playSound();
    jackpotTriggered = "Silver";
  } else {
    const jackpotCards = [
      "circle_1.png",
      "circle_4.png",
      "cross_5.png",
      "cross_13.png",
    ];
    const isJackpot =
      panelCards.includes(jackpotCards[0]) &&
      panelCards.includes(jackpotCards[1]) &&
      panelCards.includes(jackpotCards[2]) &&
      panelCards.includes(jackpotCards[3]);

    if (isJackpot) {
      payout = payoutMultipliers.bounty * selectedBet;
      updateMessage(`You won ₦${payout}! Weekly Jackpot!`);
      celebrateWin();
      playSound();
      jackpotTriggered = "Bounty Jackpot";
    }
  }

  if (payout === 0) {
    updateMessage("No win this time. Try again.");
    jackpotTriggered = null;
  }

  if (payout > 0) {
    userBalance += payout;
    updateBalanceOnDisplay(userBalance);
    updateBalanceOnServer(userBalance);
  }

  return payout;
}

// async function fetchCards(numPanels) {
//   try {
//     const response = await fetch(
//       "https://randomiser-ongf.onrender.com/getCards",
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({ numPanels }),
//       }
//     );

//     if (!response.ok) {
//       throw new Error("Failed to fetch cards: " + response.statusText);
//     }

//     const data = await response.json();
//     if (data.error) {
//       console.error("Server Error:", data.error);
//       return [];
//     }

//     return data.cards;
//   } catch (error) {
//     console.error("Error:", error);
//     return [];
//   }
// }

async function initializeGame(numPanels) {
  serverResponse = await fetchCards(numPanels);

  if (serverResponse.length > 0) {
    console.log("Cards received from server:", serverResponse);
  } else {
    updateMessage("Server is temporarily down. Please refresh the page", true);
  }
}

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
}

const getUserInfo = () => {
  const token = localStorage.getItem("token");

  if (!token) {
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
      userBalance = Math.floor(data.balance);
      userWelcome.innerHTML = `Welcome, ${data.username}`;
    })
    .catch((error) => {
      console.error("Error fetching user info:", error);
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

// Function to fetch winners and update the banner
const fetchWinners = async () => {
  try {
    const response = await fetch(
      "https://slot-backend-f32n.onrender.com/winners"
    );
    const data = await response.json();
    if (data.winners && data.winners.length > 0) {
      const winnersText = data.winners.join(" ");
      document.getElementById(
        "winners-banner"
      ).innerHTML = `<div class="winner-marquee">${winnersText}</div>`;
    }
  } catch (error) {}
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

// Fetch and display user info
const displayUserInfo = () => {
  const token = localStorage.getItem("token");

  if (!token) {
    console.log("No token found");
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
      console.error("Error fetching user info:", error);
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
  const token = localStorage.getItem("token"); // Get the stored token

  if (!token) {
    console.error("No token available.");
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
    console.log("Game outcome saved:", data.message);
  } catch (error) {
    console.error("Error saving game outcome:", error);
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

// Function to apply styles based on the number of panels
// function applyStyles() {
//   const panels = document.querySelectorAll(".panel");
//   const wheels = document.querySelectorAll(".wheel");
//   const cardContainers = document.querySelectorAll(".card-container");
//   const cards = document.querySelectorAll(".card");

//   panels.forEach((panel) => {
//     panel.style.width = "15dvw";
//     panel.style.height = `${cardHeight}px`;
//   });

//   wheels.forEach((wheel) => {
//     wheel.style.width = "15dvw";
//     wheel.style.height = `${cardHeight}px`;
//   });

//   cardContainers.forEach((cardContainer) => {
//     cardContainer.style.width = "15dvw";
//     cardContainer.style.height = `${cardHeight}px`;
//   });

//   cards.forEach((card) => {
//     card.style.width = "15dvw";
//     card.style.height = `${cardHeight}px`;
//   });
// }

function getToken() {
  const token = localStorage.getItem("token");
  return token;
}

function playSound() {
  const sound = new Audio("sound.mp3");
  sound.play();
}

function updateBalanceOnDisplay(balance) {
  const userBalanceDisplay = document.getElementById("userBalance");

  // Remove decimal points and format with commas
  const integerBalance = Math.trunc(balance); 
  const formattedBalance = integerBalance.toLocaleString('en-NG', { 
    style: 'currency', 
    currency: 'NGN' 
  });

  userBalanceDisplay.innerHTML = `Balance: ${formattedBalance}`;
}

// Load the confetti script dynamically if not already loaded
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

// Function to celebrate a big win
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
document.getElementById("viewProfile").addEventListener("click", function () {
  modal.style.display = "block";
  // Fetch user data and populate the form fields
  fetchUserProfile();
});

// Close the modal when the close button is clicked
let isFormChanged = false; // To track if any field has been changed

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
  // Send PUT request to update the profile
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
        modal.style.display = "none"; // Close the modal
        isFormChanged = false; // Reset the change flag
      } else {
        alert("Error updating profile: " + data.error);
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("An error occurred while updating the profile");
    });
});

// Fetch user profile data (e.g., when opening the modal)
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
      // Set default values or placeholders if fields are empty
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
      console.error("Error fetching user profile:", error);
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
    isFormChanged = true; // Mark as changed if any field is modified
  });
});

document.addEventListener("DOMContentLoaded", function () {
  const dropdownButton = document.getElementById("accountSettings");
  const dropdownMenu = document.getElementById("dropdownMenu");

  // Flag to track if dropdown is open
  let isDropdownOpen = false;

  // Function to toggle the dropdown menu
  function toggleDropdown() {
    if (isDropdownOpen) {
      dropdownMenu.style.display = "none"; // Close the dropdown
    } else {
      dropdownMenu.style.display = "block"; // Open the dropdown
    }
    isDropdownOpen = !isDropdownOpen; // Toggle the state
  }

  // Open dropdown when button is clicked or hovered over
  dropdownButton.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleDropdown();
  });

  // Close dropdown if clicking anywhere outside
  document.addEventListener("click", function (event) {
    if (
      !dropdownButton.contains(event.target) &&
      !dropdownMenu.contains(event.target)
    ) {
      if (isDropdownOpen) {
        dropdownMenu.style.display = "none"; // Hide the dropdown
        isDropdownOpen = false; // Update the state
      }
    }
  });

  // Prevent closing dropdown when clicking inside the menu
  dropdownMenu.addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent the document click listener from closing the dropdown
  });
});
