// Connect to WebSocket server
const socket = new WebSocket(`ws://${window.location.host}`);
let playerId = null;
let playerName = null;
let isAdmin = false;
let timerInterval = null;
let remainingTime = 0;

// DOM Elements
const screens = {
    login: document.getElementById('login'),
    waiting: document.getElementById('waiting'),
    game: document.getElementById('game'),
    admin: document.getElementById('admin'),
    result: document.getElementById('result')
};

// Helper to show a specific screen
function showScreen(screenName) {
    Object.keys(screens).forEach(name => {
        screens[name].classList.remove('active');
    });
    screens[screenName].classList.add('active');
}

// Add this function to update the timer display
function updateTimerDisplay() {
    const timerElement = document.getElementById('questionTimer');
    timerElement.textContent = remainingTime;

    // Add visual cues based on time remaining
    timerElement.classList.remove('warning', 'danger');

    if (remainingTime <= 10 && remainingTime > 5) {
        timerElement.classList.add('warning');
    } else if (remainingTime <= 5) {
        timerElement.classList.add('danger');
    }
};

function clearGameTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
};

// Helper Functions
function updatePlayerList(players) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';

    players.forEach(player => {
        const playerItem = document.createElement('li');
        playerItem.id = `player-${player.id}`;
        playerItem.textContent = `${player.name} ${player.active ? '' : '(Eliminated)'}`;
        playerList.appendChild(playerItem);
    });
};

// WebSocket event handlers
socket.onopen = () => {
    console.log('Connected to server');
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received:', data);

    switch (data.type) {
        case 'welcome':
            document.getElementById('playerCount').textContent = data.data.playerCount;
            break;

        case 'player_count_update':
            document.getElementById('playerCount').textContent = data.data.count;
            break;

        case 'registered':
            playerId = data.data.id;
            showScreen('waiting');
            document.getElementById('waitingMessage').textContent = data.data.message;
            break;

        case 'admin_registered':
            isAdmin = true;
            showScreen('admin');
            document.getElementById('gameStatus').textContent = 'Waiting';

            // Display players
            if (data.data.players) {
                updatePlayerList(data.data.players);
            }
            break;

        case 'player_joined':
            if (isAdmin) {
                // Add player to list
                const playerList = document.getElementById('playerList');
                const playerItem = document.createElement('li');
                playerItem.id = `player-${data.data.id}`;
                playerItem.textContent = data.data.name;
                playerList.appendChild(playerItem);
            }
            break;

        case 'player_left':
            if (isAdmin) {
                // Remove player from list
                const playerItem = document.getElementById(`player-${data.data.id}`);
                if (playerItem) {
                    playerItem.remove();
                }
            }
            break;

        case 'game_starting':
            if (!isAdmin) {
                document.getElementById('waitingMessage').textContent = data.data.message;
            } else {
                document.getElementById('gameStatus').textContent = 'Starting';
            }
            break;

        case 'match_started':
            if (!isAdmin) {
                showScreen('game');
                document.getElementById('opponentName').textContent = data.data.opponent;
                document.getElementById('questionText').textContent = data.data.question;

                // Clear previous options and reset
                const optionsContainer = document.getElementById('optionsContainer');
                optionsContainer.innerHTML = '';
                document.getElementById('submitAnswer').disabled = true;

                // Clear any existing timer
                if (timerInterval) {
                    clearInterval(timerInterval);
                    timerInterval = null;
                }

                // Set initial timer value
                remainingTime = data.data.timeLimit || 30;
                updateTimerDisplay();

                // Start countdown
                timerInterval = setInterval(() => {
                    remainingTime--;
                    updateTimerDisplay();

                    if (remainingTime <= 0) {
                        clearInterval(timerInterval);
                        timerInterval = null;

                        // Auto-submit timeout (no answer selected)
                        socket.send(JSON.stringify({
                            type: 'submit_answer',
                            answer: '',
                            timeout: true
                        }));

                        // Disable all options
                        document.querySelectorAll('.option-btn').forEach(btn => {
                            btn.disabled = true;
                        });
                        document.getElementById('submitAnswer').disabled = true;
                    }
                }, 1000);

                // Add options as buttons (same as before)
                data.data.options.forEach((option, index) => {
                    const optionBtn = document.createElement('button');
                    optionBtn.className = 'option-btn';
                    optionBtn.textContent = option;
                    optionBtn.dataset.value = option;

                    optionBtn.addEventListener('click', function () {
                        // Remove selected class from all options
                        document.querySelectorAll('.option-btn').forEach(btn => {
                            btn.classList.remove('selected');
                        });

                        // Add selected class to clicked option
                        this.classList.add('selected');

                        // Enable submit button
                        document.getElementById('submitAnswer').disabled = false;
                    });

                    optionsContainer.appendChild(optionBtn);
                });
            }
            break;

        case 'round_started':
            if (isAdmin) {
                document.getElementById('gameStatus').textContent = 'Active';

                // Display active matches
                const matchesDiv = document.getElementById('activeMatches');
                matchesDiv.innerHTML = '';

                data.data.pairs.forEach((pair, index) => {
                    const matchDiv = document.createElement('div');
                    matchDiv.innerHTML = `
            <p><strong>Match ${index + 1}:</strong> ${pair.player1} vs ${pair.player2}</p>
            <p>Question: ${pair.question}</p>
            <hr>
          `;
                    matchesDiv.appendChild(matchDiv);
                });
            }
            break;

        case 'round_result':
            if (!isAdmin) {
                clearGameTimer();
                showScreen('result');
                document.getElementById('resultMessage').textContent =
                    data.data.advance ?
                        `${data.data.winner} won! You advance to the next round.` :
                        `${data.data.winner} won. Better luck next time!`;

                document.getElementById('correctAnswer').textContent = data.data.correctAnswer;
                document.getElementById('yourAnswer').textContent = data.data.yourAnswer;
                document.getElementById('opponentAnswer').textContent = data.data.opponentAnswer;

                if (!data.data.advance) {
                    document.getElementById('waitingNext').textContent = 'You have been eliminated.';
                }
            }
            break;

        case 'next_round':
            if (!isAdmin) {
                document.getElementById('roundNumber').textContent = data.data.round;
            }
            break;

        case 'bye_round':
            if (!isAdmin) {
                showScreen('result');
                document.getElementById('resultMessage').textContent = data.data.message;
                document.getElementById('correctAnswer').textContent = 'N/A';
                document.getElementById('yourAnswer').textContent = 'N/A';
                document.getElementById('opponentAnswer').textContent = 'N/A';
            }
            break;

        case 'game_over':
            if (isAdmin) {
                document.getElementById('gameStatus').textContent = 'Finished';
                document.getElementById('activeMatches').innerHTML =
                    `<p><strong>Game Over:</strong> ${data.data.message}</p>`;
            } else {
                showScreen('result');
                document.getElementById('resultMessage').textContent = data.data.message;
                document.getElementById('waitingNext').textContent = 'Game has ended.';
            }
            break;

        case 'game_reset':
            if (isAdmin) {
                document.getElementById('gameStatus').textContent = 'Waiting';
                document.getElementById('activeMatches').innerHTML = '';
            } else {
                showScreen('waiting');
                document.getElementById('waitingMessage').textContent = data.data.message;
            }
            break;

        case 'error':
            alert(data.data.message);
            break;
    }
};

socket.onclose = () => {
    console.log('Disconnected from server');
    clearGameTimer();
    alert('Connection to server lost. Please refresh the page.');
  };

// Event Listeners - Added after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('joinBtn').addEventListener('click', () => {
        playerName = document.getElementById('playerName').value.trim();
        if (playerName) {
            socket.send(JSON.stringify({
                type: 'register',
                name: playerName
            }));
        } else {
            alert('Please enter your name');
        }
    });

    document.getElementById('adminBtn').addEventListener('click', () => {
        const adminKey = document.getElementById('adminKey').value.trim();
        if (adminKey) {
            socket.send(JSON.stringify({
                type: 'register_admin',
                adminKey: adminKey
            }));
        } else {
            alert('Please enter admin key');
        }
    });

    document.getElementById('submitAnswer').addEventListener('click', () => {
        const selectedOption = document.querySelector('.option-btn.selected');

        if (selectedOption) {
            const answer = selectedOption.dataset.value;

            // Clear the timer
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }

            socket.send(JSON.stringify({
                type: 'submit_answer',
                answer: answer
            }));

            // Disable all option buttons and submit button
            document.querySelectorAll('.option-btn').forEach(btn => {
                btn.disabled = true;
            });
            document.getElementById('submitAnswer').disabled = true;
        } else {
            alert('Please select an answer');
        }
    });

    document.getElementById('startGameBtn').addEventListener('click', () => {
        socket.send(JSON.stringify({
            type: 'start_game'
        }));
    });

    document.getElementById('resetGameBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to reset the game?')) {
            socket.send(JSON.stringify({
                type: 'reset_game'
            }));
        }
    });

    // Handle key press in input fields
    document.getElementById('playerName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('joinBtn').click();
    });

    document.getElementById('adminKey').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('adminBtn').click();
    });

    document.getElementById('answerInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('submitAnswer').click();
    });
});