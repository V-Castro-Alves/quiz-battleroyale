// Server setup (app.js)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs

// Initialize Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const gameState = {
    status: 'waiting', // waiting, pairing, active, finished
    players: new Map(), // Map of player IDs to player objects
    questionTime: 30,
    admin: null, // Admin connection
    activePairs: [], // Array of active player pairs
    questions: [
        {
            id: 1,
            text: "What is 2+2?",
            options: ["3", "4", "5", "22"],
            answer: "4"
        },
        {
            id: 2,
            text: "What is the capital of France?",
            options: ["London", "Berlin", "Paris", "Madrid"],
            answer: "Paris"
        },
        {
            id: 3,
            text: "Who wrote Romeo and Juliet?",
            options: ["Charles Dickens", "Jane Austen", "Shakespeare", "Mark Twain"],
            answer: "Shakespeare"
        },
        // Add more questions
    ],
    currentRound: 0,
    winners: [] // Players who have won their rounds
};

// Helper function to send data to a specific client
function sendToClient(client, type, data) {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data }));
    }
}

// Helper function to broadcast to all clients
function broadcast(type, data, excludeClient = null) {
    wss.clients.forEach(client => {
        if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

function broadcastPlayerCount() {
    const count = gameState.players.size;
    broadcast('player_count_update', { count });
}

// Pair players for competition
function pairPlayers() {
    const activePlayers = Array.from(gameState.players.values())
        .filter(player => player.active);

    // Reset active pairs
    gameState.activePairs = [];

    // If odd number of players, one gets a bye to the next round
    if (activePlayers.length % 2 !== 0 && activePlayers.length > 0) {
        const luckyPlayer = activePlayers.pop();
        gameState.winners.push(luckyPlayer.id);
        sendToClient(luckyPlayer.connection, 'bye_round', {
            message: "You've received a bye and advance to the next round!"
        });
    }

    // Create pairs
    for (let i = 0; i < activePlayers.length; i += 2) {
        if (i + 1 < activePlayers.length) {
            const pair = {
                player1: activePlayers[i],
                player2: activePlayers[i + 1],
                questionId: Math.floor(Math.random() * gameState.questions.length),
                answers: new Map(),
                winnerId: null
            };

            gameState.activePairs.push(pair);

            // Send match info to players
            const question = gameState.questions[pair.questionId];
            sendToClient(pair.player1.connection, 'match_started', {
                opponent: pair.player2.name,
                question: question.text,
                options: question.options,
                timeLimit: gameState.questionTime
            });

            sendToClient(pair.player2.connection, 'match_started', {
                opponent: pair.player1.name,
                question: question.text,
                options: question.options,
                timeLimit: gameState.questionTime

            });
        }
    }

    // Update game status
    if (gameState.activePairs.length > 0) {
        gameState.status = 'active';
        if (gameState.admin) {
            sendToClient(gameState.admin, 'round_started', {
                pairs: gameState.activePairs.map(pair => ({
                    player1: pair.player1.name,
                    player2: pair.player2.name,
                    question: gameState.questions[pair.questionId].text,
                    options: gameState.questions[pair.questionId].options
                }))
            });
        }
    } else {
        finishGame();
    }
}

// Handle end of a round
function endRound() {
    gameState.currentRound++;

    // Reset active status for next round
    gameState.players.forEach(player => {
        player.active = gameState.winners.includes(player.id);
    });

    // Clear winners for the next round
    gameState.winners = [];

    // If we have more than one active player, start a new round
    const activePlayers = Array.from(gameState.players.values())
        .filter(player => player.active);

    if (activePlayers.length > 1) {
        // Delay the next round to give players a breather
        setTimeout(() => {
            broadcast('next_round', { round: gameState.currentRound });
            pairPlayers();
        }, 5000);
    } else if (activePlayers.length === 1) {
        // We have a winner!
        const winner = activePlayers[0];
        gameState.status = 'finished';
        broadcast('game_over', {
            winner: winner.name,
            message: `${winner.name} is the champion!`
        });
    } else {
        // No players left (shouldn't happen but just in case)
        gameState.status = 'finished';
        broadcast('game_over', {
            message: "Game over! No winners."
        });
    }
}

// Handle game finish
function finishGame() {
    gameState.status = 'finished';
    broadcast('game_over', {
        message: "The game has ended."
    });

    // Reset game state for a new game
    setTimeout(() => {
        gameState.status = 'waiting';
        gameState.currentRound = 0;
        gameState.winners = [];
        gameState.activePairs = [];
        gameState.players.forEach(player => {
            player.active = true;
        });

        if (gameState.admin) {
            sendToClient(gameState.admin, 'game_reset', {
                message: "Game has been reset. You can start a new game."
            });
        }
    }, 10000);
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New client connected');

    // Set up player data
    const playerId = uuidv4();
    let playerData = {
        id: playerId,
        name: null,
        connection: ws,
        active: true,
        isAdmin: false
    };

    // Handle messages from clients
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'register':
                    // Handle player registration
                    playerData.name = data.name;
                    gameState.players.set(playerId, playerData);

                    sendToClient(ws, 'registered', {
                        id: playerId,
                        message: `Welcome ${playerData.name}!`
                    });

                    // Notify admin of new player
                    if (gameState.admin) {
                        sendToClient(gameState.admin, 'player_joined', {
                            id: playerId,
                            name: playerData.name
                        });
                    }
                    broadcastPlayerCount();
                    break;

                case 'register_admin':
                    if (!gameState.admin && data.adminKey === 'admin123') { // Simple admin key
                        playerData.isAdmin = true;
                        gameState.admin = ws;
                        sendToClient(ws, 'admin_registered', {
                            message: "You are now the admin.",
                            players: Array.from(gameState.players.values()).map(p => ({
                                id: p.id,
                                name: p.name,
                                active: p.active
                            }))
                        });
                    } else {
                        sendToClient(ws, 'error', {
                            message: "Admin already exists or invalid key."
                        });
                    }
                    break;

                case 'start_game':
                    if (playerData.isAdmin && gameState.status === 'waiting') {
                        if (gameState.players.size < 2) {
                            sendToClient(ws, 'error', {
                                message: "Need at least 2 players to start the game."
                            });
                            return;
                        }

                        gameState.status = 'pairing';
                        broadcast('game_starting', {
                            message: "The game is starting now!"
                        });

                        // Start the first round
                        gameState.currentRound = 1;
                        pairPlayers();
                    }
                    break;

                case 'submit_answer':
                    // Handle player answer submission
                    if (gameState.status === 'active') {
                        // Find the pair this player is in
                        const pair = gameState.activePairs.find(p =>
                            (p.player1.id === playerId || p.player2.id === playerId) &&
                            p.winnerId === null
                        );

                        if (pair) {
                            const question = gameState.questions[pair.questionId];
                            const isTimeout = data.timeout === true;
                            const answer = isTimeout ? "[No answer - time out]" : data.answer;
                            const correct = data.answer.toLowerCase() === question.answer.toLowerCase();

                            // Record the answer
                            pair.answers.set(playerId, {
                                answer: answer,
                                correct,
                                timeout: isTimeout,
                                timestamp: Date.now()
                            });

                            // If both players have answered
                            if (pair.answers.size === 2) {
                                const player1Answer = pair.answers.get(pair.player1.id);
                                const player2Answer = pair.answers.get(pair.player2.id);

                                // Determine winner
                                if (player1Answer.correct && !player2Answer.correct) {
                                    pair.winnerId = pair.player1.id;
                                } else if (!player1Answer.correct && player2Answer.correct) {
                                    pair.winnerId = pair.player2.id;
                                } else if (player1Answer.correct && player2Answer.correct) {
                                    // Both correct, fastest wins
                                    pair.winnerId = player1Answer.timestamp < player2Answer.timestamp ?
                                        pair.player1.id : pair.player2.id;
                                } else {
                                    // Both wrong, fastest correct answer in follow-up
                                    // For simplicity, we'll just let both progress for now
                                    // In a real implementation, you might want to give them another question
                                    pair.winnerId = 'tie';
                                }

                                // Notify players of results
                                const winnerName = pair.winnerId === 'tie' ?
                                    'Both advance' :
                                    (pair.winnerId === pair.player1.id ? pair.player1.name : pair.player2.name);

                                sendToClient(pair.player1.connection, 'round_result', {
                                    winner: winnerName,
                                    yourAnswer: player1Answer.answer,
                                    opponentAnswer: player2Answer.answer,
                                    correctAnswer: question.answer,
                                    advance: pair.winnerId === pair.player1.id || pair.winnerId === 'tie'
                                });

                                sendToClient(pair.player2.connection, 'round_result', {
                                    winner: winnerName,
                                    yourAnswer: player2Answer.answer,
                                    opponentAnswer: player1Answer.answer,
                                    correctAnswer: question.answer,
                                    advance: pair.winnerId === pair.player2.id || pair.winnerId === 'tie'
                                });

                                // Update winners list
                                if (pair.winnerId === 'tie') {
                                    gameState.winners.push(pair.player1.id);
                                    gameState.winners.push(pair.player2.id);
                                } else {
                                    gameState.winners.push(pair.winnerId);
                                }

                                // Check if all pairs have finished
                                const allPairsFinished = gameState.activePairs.every(p => p.winnerId !== null);
                                if (allPairsFinished) {
                                    endRound();
                                }
                            }
                        }
                    }
                    break;

                case 'reset_game':
                    if (playerData.isAdmin) {
                        // Reset the game
                        gameState.status = 'waiting';
                        gameState.currentRound = 0;
                        gameState.winners = [];
                        gameState.activePairs = [];
                        gameState.players.forEach(player => {
                            player.active = true;
                        });

                        broadcast('game_reset', {
                            message: "The game has been reset by the admin."
                        });
                    }
                    break;
            }

        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log('Client disconnected');

        // Check if this was the admin
        if (playerData.isAdmin) {
            gameState.admin = null;
        } else if (gameState.players.has(playerId)) {
            // Remove the player
            gameState.players.delete(playerId);

            broadcastPlayerCount();

            // Notify admin
            if (gameState.admin) {
                sendToClient(gameState.admin, 'player_left', {
                    id: playerId,
                    name: playerData.name
                });
            }

            // Handle case where player was in an active match
            if (gameState.status === 'active') {
                const pairIndex = gameState.activePairs.findIndex(p =>
                    (p.player1.id === playerId || p.player2.id === playerId) &&
                    p.winnerId === null
                );

                if (pairIndex !== -1) {
                    const pair = gameState.activePairs[pairIndex];
                    // The other player automatically wins
                    const winnerId = pair.player1.id === playerId ? pair.player2.id : pair.player1.id;
                    const winner = gameState.players.get(winnerId);

                    pair.winnerId = winnerId;
                    gameState.winners.push(winnerId);

                    if (winner) {
                        sendToClient(winner.connection, 'opponent_left', {
                            message: "Your opponent has left the game. You advance to the next round!"
                        });
                    }

                    // Check if all pairs have finished
                    const allPairsFinished = gameState.activePairs.every(p => p.winnerId !== null);
                    if (allPairsFinished) {
                        endRound();
                    }
                }
            }
        }
    });

    // Send initial state to the client
    sendToClient(ws, 'welcome', {
        message: "Welcome to the Quiz Game!",
        status: gameState.status,
        playerCount: gameState.players.size
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});