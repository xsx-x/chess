// --- הגדרות משתנים גלובליים ---
let board = null;
let game = new Chess();
let peer = null;
let conn = null;
let playerColor = 'w';

// --- מנוע סאונד עצמאי לחלוטין (ללא קבצים!) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'move') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } 
    else if (type === 'capture') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
    else if (type === 'check') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.setValueAtTime(400, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.start(); osc.stop(audioCtx.currentTime + 0.6);
    }
}

// --- אנימציות ---
function triggerCaptureAnimation() {
    const wrapper = document.getElementById('board-wrapper');
    wrapper.classList.remove('shake-effect');
    void wrapper.offsetWidth; // טריק לאיפוס האנימציה
    wrapper.classList.add('shake-effect');
}

function highlightMove(source, target) {
    $('.square-55d63').removeClass('highlight-square'); // מחיקת סימונים קודמים
    $('.square-' + source).addClass('highlight-square');
    $('.square-' + target).addClass('highlight-square');
}


// --- אתחול ---
window.onload = () => {
    // אתחול סאונד בלחיצה ראשונה במסך (מדיניות דפדפנים)
    document.body.addEventListener('click', () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    const hash = window.location.hash.substring(1); 
    let roomHash = hash.split('?')[0];
    let urlParams = new URLSearchParams(hash.substring(roomHash.length + 1));
    let loadedFen = urlParams.get('fen');
    let opponentColor = urlParams.get('color');

    if (roomHash) {
        playerColor = opponentColor || 'b'; 
        if (loadedFen) game.load(decodeURIComponent(loadedFen)); 
        initJoiner(roomHash);
    } else {
        document.getElementById('create-btn').addEventListener('click', () => initCreator());
        document.getElementById('resume-btn').addEventListener('click', resumeGame);
    }
};

// --- WebRTC ---
function initCreator(startingFen = null, myColor = 'w') {
    const createBtn = document.getElementById('create-btn');
    createBtn.innerText = "מייצר חדר קרב... ⏳"; 
    createBtn.disabled = true;
    
    playerColor = myColor;
    const gameId = Math.random().toString(36).substring(2, 8);
    peer = new Peer(gameId);
    
    peer.on('open', (id) => {
        createBtn.style.display = 'none';
        document.getElementById('resume-btn').parentElement.style.display = 'none';
        
        let link = window.location.href.split('#')[0] + '#' + id;
        if (startingFen && typeof startingFen === 'string') {
            const oppColor = myColor === 'w' ? 'b' : 'w';
            link += `?fen=${encodeURIComponent(startingFen)}&color=${oppColor}`;
        }
        
        document.getElementById('invite-link').value = link;
        document.getElementById('invite-container').style.display = 'block';
    });

    peer.on('error', (err) => {
        alert("שגיאה ביצירת חדר: " + err);
        createBtn.innerText = "צור משחק קרב חדש";
        createBtn.disabled = false;
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });
}

function initJoiner(hostId) {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    peer = new Peer(); 
    peer.on('open', () => {
        document.getElementById('status').innerText = "מתחבר לשדה הקרב...";
        conn = peer.connect(hostId); 
        setupConnection();
    });
}

function setupConnection() {
    conn.on('open', () => {
        document.getElementById('menu').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initChessboard();
        updateStatus();
    });

    conn.on('data', (data) => {
        if (data.type === 'move') {
            const moveResult = game.move({ from: data.from, to: data.to, promotion: 'q' });
            board.position(game.fen());
            
            // הפעלת דרמה אצל השחקן המקבל
            highlightMove(data.from, data.to);
            if (moveResult && moveResult.captured) {
                playSound('capture');
                triggerCaptureAnimation();
            } else {
                playSound('move');
            }
            updateStatus();
        } else if (data.type === 'restart') {
            game.reset();
            board.start();
            $('.square-55d63').removeClass('highlight-square');
            updateStatus();
        }
    });

    conn.on('close', () => {
        document.getElementById('status').innerText = "היריב ברח מהמערכה! 🏳️";
    });
}

// --- הגדרות הלוח ---
function initChessboard() {
    const currentFen = game.fen();
    const isStartPos = currentFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    const config = {
        draggable: true,
        position: isStartPos ? 'start' : currentFen,
        orientation: playerColor === 'w' ? 'white' : 'black',
        pieceTheme: 'https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/{piece}.png',
        moveSpeed: 'slow', // תזוזה דרמטית
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    
    board = Chessboard('board', config);
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
    if ((game.turn() === 'w' && playerColor === 'b') ||
        (game.turn() === 'b' && playerColor === 'w')) {
        return false;
    }
}

function onDrop(source, target) {
    let move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    // הפעלת אפקטים לשחקן שזז
    highlightMove(source, target);
    if (move.captured) {
        playSound('capture');
        triggerCaptureAnimation();
    } else {
        playSound('move');
    }

    conn.send({ type: 'move', from: source, to: target });
    updateStatus();
}

function onSnapEnd() {
    board.position(game.fen());
}

// --- ניהול תצוגה ומצב ---
function updateStatus() {
    let statusHTML = '';
    let moveColor = game.turn() === 'w' ? 'לבן' : 'שחור';
    let isMyTurn = game.turn() === playerColor;

    // הסרת מסך שח כברירת מחדל
    document.body.classList.remove('in-check');

    if (game.in_checkmate()) {
        statusHTML = `🔥 מט! השחקן ה${moveColor === 'לבן' ? 'שחור' : 'לבן'} השמיד את היריב! 🔥`;
        document.getElementById('restart-btn').style.display = 'block';
        if (typeof confetti === 'function') {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } }); // פיצוץ קונפטי!
        }
    } 
    else if (game.in_draw()) {
        statusHTML = '⚔️ תיקו! קרב צמוד.';
        document.getElementById('restart-btn').style.display = 'block';
    } 
    else {
        statusHTML = isMyTurn ? '🟢 התור שלך לתקוף' : '🔴 ממתין למהלך היריב';
        if (game.in_check()) {
            statusHTML += ' <br> ⚠️ <b>שח! המלך בסכנה!</b> ⚠️';
            document.body.classList.add('in-check'); // מדליק את האור האדום!
            playSound('check');
        }
        document.getElementById('restart-btn').style.display = 'none';
    }

    document.getElementById('status').innerHTML = statusHTML;
}

// --- פונקציות טעינה ושמירה ---
function resumeGame() {
    const fen = document.getElementById('fen-input').value.trim();
    const selectedColor = document.getElementById('resume-color').value;

    if (!fen) { alert("אנא הדבק קוד משחק (FEN)"); return; }
    if (!game.load(fen)) { alert("קוד המשחק לא תקין!"); return; }

    initCreator(fen, selectedColor);
}

document.getElementById('copy-btn').addEventListener('click', () => {
    document.getElementById('invite-link').select();
    document.execCommand('copy');
    document.getElementById('copy-btn').innerText = 'הועתק בהצלחה! ⚔️';
});

document.getElementById('restart-btn').addEventListener('click', () => {
    game.reset();
    board.start();
    $('.square-55d63').removeClass('highlight-square');
    conn.send({ type: 'restart' });
    updateStatus();
});

document.getElementById('save-btn').addEventListener('click', () => {
    const fen = game.fen();
    navigator.clipboard.writeText(fen).then(() => {
        const btn = document.getElementById('save-btn');
        btn.innerText = '✅ הקוד נשמר!';
        setTimeout(() => { btn.innerText = '💾 שמור משחק'; }, 3000);
    });
});
