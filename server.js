const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORD_BANK = [
    "teknologi", "komputer", "jaringan", "aplikasi", "algoritma", "database",
    "kecepatan", "ketepatan", "tantangan", "kompetisi", "juara", "strategi",
    "sistem", "program", "kreatif", "inovasi", "layar", "papan", "ketik",
    "internet", "server", "klien", "data", "informasi", "kode", "fungsi",
    "variabel", "logika", "struktur", "desain", "antarmuka", "pengguna"
];

const rooms = {};
let quickMatchQueue = null; // Menyimpan socket pemain yang sedang mencari lawan

function generateWords(count = 22) {
    return Array.from({ length: count }, () => WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]).join(" ");
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

io.on('connection', (socket) => {
    function joinPlayerToRoom(sock, roomCode, playerData) {
        const room = rooms[roomCode];
        sock.join(roomCode);
        sock.roomCode = roomCode;

        room.players[sock.id] = {
            id: sock.id,
            name: playerData.name || 'Pemain',
            avatar: playerData.avatar || '🦊',
            level: playerData.level || 1,
            mmr: playerData.mmr || 1000,
            progress: 0,
            wpm: 0,
            ready: false,
            finished: false
        };

        io.to(roomCode).emit('roomUpdate', room);
    }

    // 1. Buat Custom Room
    socket.on('createRoom', (playerData) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            text: generateWords(22),
            status: 'waiting',
            players: {}
        };
        joinPlayerToRoom(socket, roomCode, playerData);
    });

    // 2. Gabung Custom Room
    socket.on('joinRoom', ({ roomCode, playerData }) => {
        const code = roomCode.toUpperCase().trim();
        const room = rooms[code];
        if (!room) return socket.emit('errorMsg', 'Kode Room tidak ditemukan!');
        if (Object.keys(room.players).length >= 2) return socket.emit('errorMsg', 'Room sudah penuh!');
        if (room.status !== 'waiting') return socket.emit('errorMsg', 'Pertandingan sudah dimulai!');
        joinPlayerToRoom(socket, code, playerData);
    });

    // 3. Quick Match (Auto-Matchmaking)
    socket.on('quickMatch', (playerData) => {
        if (quickMatchQueue && quickMatchQueue.socket.connected && quickMatchQueue.socket.id !== socket.id) {
            // Lawan ditemukan! Buat room otomatis untuk berdua
            const opponent = quickMatchQueue;
            quickMatchQueue = null;

            const roomCode = generateRoomCode();
            rooms[roomCode] = {
                code: roomCode,
                text: generateWords(22),
                status: 'waiting',
                players: {}
            };

            joinPlayerToRoom(opponent.socket, roomCode, opponent.playerData);
            joinPlayerToRoom(socket, roomCode, playerData);
        } else {
            // Masuk antrean menunggu lawan
            quickMatchQueue = { socket, playerData };
            socket.emit('searchingMatch');
        }
    });

    socket.on('cancelQuickMatch', () => {
        if (quickMatchQueue && quickMatchQueue.socket.id === socket.id) {
            quickMatchQueue = null;
        }
    });

    // 4. Pemain Ready
    socket.on('playerReady', () => {
        const room = rooms[socket.roomCode];
        if (!room || !room.players[socket.id]) return;

        room.players[socket.id].ready = true;
        io.to(socket.roomCode).emit('roomUpdate', room);

        const playerList = Object.values(room.players);
        if (playerList.length === 2 && playerList.every(p => p.ready)) {
            room.status = 'countdown';
            io.to(socket.roomCode).emit('startCountdown', room.text);

            setTimeout(() => {
                if (rooms[socket.roomCode]) {
                    rooms[socket.roomCode].status = 'playing';
                    io.to(socket.roomCode).emit('raceStarted');
                }
            }, 3000);
        }
    });

    // 5. Progres Mengetik
    socket.on('typingProgress', ({ progress, wpm }) => {
        const room = rooms[socket.roomCode];
        if (!room || room.status !== 'playing' || !room.players[socket.id]) return;

        const player = room.players[socket.id];
        player.progress = Math.min(100, progress);
        player.wpm = wpm;

        if (player.progress >= 100 && !player.finished) {
            player.finished = true;
            room.status = 'finished';

            const results = Object.values(room.players).map(p => {
                const isWinner = p.id === socket.id;
                const xpGained = (isWinner ? 120 : 50) + Math.round(p.wpm * 1.5);
                return {
                    id: p.id,
                    name: p.name,
                    avatar: p.avatar,
                    wpm: p.wpm,
                    isWinner,
                    mmrChange: isWinner ? +25 : -18,
                    xpGained
                };
            });

            io.to(socket.roomCode).emit('raceFinished', results);
        } else {
            io.to(socket.roomCode).emit('progressUpdate', room.players);
        }
    });

    // 6. Disconnect
    socket.on('disconnect', () => {
        if (quickMatchQueue && quickMatchQueue.socket.id === socket.id) {
            quickMatchQueue = null;
        }
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            delete rooms[roomCode].players[socket.id];
            if (Object.keys(rooms[roomCode].players).length === 0) {
                delete rooms[roomCode];
            } else {
                rooms[roomCode].status = 'waiting';
                io.to(roomCode).emit('opponentLeft');
            }
        }
    });
});

const PORT = process.env.PORT || 3000; server.listen(PORT, () => console.log('BERHASIL! TypeArena Full PvP berjalan di http://localhost:3000'));