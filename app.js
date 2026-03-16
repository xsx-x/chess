// --- הגדרות משתנים גלובליים ---
let board = null;
let game = new Chess();
let peer = null;
let conn = null;
let playerColor = 'w'; // שחקן יוצר תמיד לבן, מצטרף תמיד שחור

// אלמנטים ב-DOM
const menuEl = document.getElementById('menu');
const gameContainerEl = document.getElementById('game-container');
const inviteContainerEl = document.getElementById('invite-container');
const inviteLinkEl = document.getElementById('invite-link');
const statusEl = document.getElementById('status');
// --- אתחול (בדיקה האם אנחנו יוצרים או מצטרפים) ---
const hash = window.location.hash.substring(1); 

// פונקציית עזר לחילוץ נתונים מה-URL (לדוגמה: #ROOMID?fen=...&color=b)
let roomHash = hash.split('?')[0];
let urlParams = new URLSearchParams(hash.substring(roomHash.length + 1));
let loadedFen = urlParams.get('fen');
let opponentColor = urlParams.get('color');

if (roomHash) {
    // שחקן ב' מצטרף
    playerColor = opponentColor || 'b'; // אם לא הוגדר צבע בקישור, הוא שחור
    if (loadedFen) {
        game.load(decodeURIComponent(loadedFen)); // טעינת המצב מהקישור
    }
    initJoiner(roomHash);
} else {
    // שחקן א' במסך הראשי
    document.getElementById('create-btn').addEventListener('click', () => initCreator());
    document.getElementById('resume-btn').addEventListener('click', resumeGame);
}
// --- אתחול (בדיקה האם אנחנו יוצרים או מצטרפים) ---
const roomHash = window.location.hash.substring(1); // מזהה החדר מה-URL
if (roomHash) {
    // שלב ב: שחקן ב' מצטרף דרך לינק
    playerColor = 'b';
    initJoiner(roomHash);
} else {
    // שלב א: שחקן א' נכנס לאתר הראשי
    document.getElementById('create-btn').addEventListener('click', initCreator);
}

// --- פונקציות WebRTC ---

function initCreator(startingFen = null, myColor = 'w') {
    document.getElementById('menu').children[0].style.display = 'none'; // הסתרת כפתורים
    document.getElementById('menu').children[1].style.display = 'none'; 
    playerColor = myColor; // קביעת הצבע של שחקן א'

    const gameId = Math.random().toString(36).substring(2, 8);
    peer = new Peer(gameId);
    
    peer.on('open', (id) => {
        let link = window.location.href.split('#')[0] + '#' + id;
        
        // אם זה משחק משוחזר, נוסיף את הנתונים לקישור של היריב
        if (startingFen) {
            const oppColor = myColor === 'w' ? 'b' : 'w';
            link += `?fen=${encodeURIComponent(startingFen)}&color=${oppColor}`;
        }
        
        inviteLinkEl.value = link;
        inviteContainerEl.style.display = 'block';
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });
}
function initJoiner(hostId) {
    menuEl.style.display = 'none';
    gameContainerEl.style.display = 'block';
    
    peer = new Peer(); // שחקן ב' לא צריך מזהה קבוע
    peer.on('open', () => {
        statusEl.innerText = "מתחבר לשחקן א'...";
        conn = peer.connect(hostId); // חיבור לשחקן א'
        setupConnection();
    });
}

function setupConnection() {
    conn.on('open', () => {
        // התחברות הצליחה!
        menuEl.style.display = 'none';
        gameContainerEl.style.display = 'block';
        initChessboard();
        updateStatus();
    });

    // האזנה להודעות מהצד השני
    conn.on('data', (data) => {
        if (data.type === 'move') {
            game.move({ from: data.from, to: data.to, promotion: 'q' });
            board.position(game.fen());
            updateStatus();
        } else if (data.type === 'restart') {
            game.reset();
            board.start();
            updateStatus();
        }
    });

    conn.on('close', () => {
        statusEl.innerText = "היריב התנתק!";
    });
}

// --- הגדרות לוח השחמט ---

function initChessboard() {
    const config = {
        draggable: true,
        // אם יש מצב שמור נטען אותו, אחרת נתחיל מחדש
        position: game.fen() === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' ? 'start' : game.fen(),
        orientation: playerColor === 'w' ? 'white' : 'black',
        
        // --- הפתרון לבעיית התמונות: משיכת הכלים משרת חיצוני ---
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    
    board = Chessboard('board', config);
}

// בדיקה האם מותר להרים כלי
function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    
    // שחקן יכול להזיז רק כלים בצבע שלו
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
    
    // מותר להזיז רק אם זה התור שלך
    if ((game.turn() === 'w' && playerColor === 'b') ||
        (game.turn() === 'b' && playerColor === 'w')) {
        return false;
    }
}

// בדיקת חוקיות מהלך בזמן עזיבת העכבר
function onDrop(source, target) {
    let move = game.move({
        from: source,
        to: target,
        promotion: 'q' // אוטומטית מקדם למלכה לפשטות
    });

    // אם המהלך לא חוקי - הכלי יחזור למקום
    if (move === null) return 'snapback';

    // אם תקין - שולח ליריב דרך WebRTC
    conn.send({ type: 'move', from: source, to: target });
    updateStatus();
}

// עדכון אנימציה אחרי המהלך
function onSnapEnd() {
    board.position(game.fen());
}

// --- ניהול תצוגה ומצב ---

function updateStatus() {
    let statusHTML = '';
    let moveColor = game.turn() === 'w' ? 'לבן' : 'שחור';
    let isMyTurn = game.turn() === playerColor;

    if (game.in_checkmate()) {
        statusHTML = `מט! השחקן ה${moveColor === 'לבן' ? 'שחור' : 'לבן'} ניצח! 🎉`;
        document.getElementById('restart-btn').style.display = 'block';
    } 
    else if (game.in_draw()) {
        statusHTML = 'תיקו!';
        document.getElementById('restart-btn').style.display = 'block';
    } 
    else {
        statusHTML = isMyTurn ? '🟢 תור שלך' : '🔴 תור היריב';
        if (game.in_check()) {
            statusHTML += ' (שח!)';
        }
        document.getElementById('restart-btn').style.display = 'none';
    }

    statusEl.innerHTML = statusHTML;
}

// --- מאזינים נוספים ---

// העתקת קישור
document.getElementById('copy-btn').addEventListener('click', () => {
    inviteLinkEl.select();
    document.execCommand('copy');
    document.getElementById('copy-btn').innerText = 'הועתק!';
});

// בקשת משחק חדש
document.getElementById('restart-btn').addEventListener('click', () => {
    game.reset();
    board.start();
    conn.send({ type: 'restart' });
    updateStatus();
});
// --- פונקציות שמירה וטעינה (FEN) ---

// שחזור משחק מהמסך הראשי
function resumeGame() {
    const fen = document.getElementById('fen-input').value.trim();
    const selectedColor = document.getElementById('resume-color').value;

    if (!fen) {
        alert("אנא הדבק קוד משחק (FEN)");
        return;
    }

    // בדיקה שהקוד תקין
    const validation = game.load(fen);
    if (!validation) {
        alert("קוד המשחק לא תקין!");
        return;
    }

    // אם הקוד תקין, מתחילים כיוצר חדר עם ה-FEN הזה
    initCreator(fen, selectedColor);
}

// שמירת משחק (העתקה ללוח)
document.getElementById('save-btn').addEventListener('click', () => {
    const fen = game.fen(); // שולף את מצב המשחק הנוכחי
    navigator.clipboard.writeText(fen).then(() => {
        const btn = document.getElementById('save-btn');
        btn.innerText = '✅ הקוד הועתק!';
        setTimeout(() => { btn.innerText = '💾 שמור משחק (העתק קוד)'; }, 3000);
    }).catch(err => {
        alert("שגיאה בהעתקה: " + fen);
    });
});
