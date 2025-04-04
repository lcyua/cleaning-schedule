const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const KST_OFFSET = 9 * 60 * 60 * 1000; // 한국 표준시 (UTC+9)

async function initDB() {
    const db = await open({
        filename: "./cleaning.db",
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE IF NOT EXISTS areas (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY, student_id INTEGER, area_id INTEGER, week INTEGER, year INTEGER);
        CREATE TABLE IF NOT EXISTS last_update (id INTEGER PRIMARY KEY, timestamp TEXT);
    `);

    // 학생 데이터 강제 삽입
    await db.run("DELETE FROM students");
    const initialStudents = ["박찬진", "이동현", "정지훈", "정한영", "하현일", "허윤재"];
    for (let i = 0; i < initialStudents.length; i++) {
        await db.run("INSERT INTO students (id, name) VALUES (?, ?)", i + 1, initialStudents[i]);
    }

    // 청소 구역 데이터 강제 삽입
    await db.run("DELETE FROM areas");
    const initialAreas = [
        "빗자루, 대걸래, 분리수거",
        "빗자루, 대걸래, 분리수거",
        "환기, 빗자루, 대걸래",
        "손걸래, 세절기",
        "손걸래, 세절기",
        "교사쓰레기통, 전체 쓰레기통 정리"
    ];
    for (let i = 0; i < initialAreas.length; i++) {
        await db.run("INSERT INTO areas (id, name) VALUES (?, ?)", i + 1, initialAreas[i]);
    }

    return db;
}

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function assignCleaningAreas(db) {
    const now = new Date(Date.now() + KST_OFFSET);
    const weekNum = getWeekNumber(now);
    const year = now.getFullYear();

    const lastUpdate = await db.get("SELECT timestamp FROM last_update WHERE id = 1");
    const shouldUpdate = !lastUpdate || 
        (now.getDay() === 1 && now.getHours() >= 8 && 
        (weekNum !== getWeekNumber(new Date(lastUpdate.timestamp)) || year !== new Date(lastUpdate.timestamp).getFullYear()));

    console.log("shouldUpdate:", shouldUpdate);
    if (shouldUpdate) {
        const students = await db.all("SELECT id, name FROM students");
        const areas = await db.all("SELECT id, name FROM areas");
        console.log("Students:", students);
        console.log("Areas:", areas);

        const shuffledStudents = shuffleArray(students);

        await db.run("DELETE FROM assignments");
        for (let i = 0; i < shuffledStudents.length; i++) {
            await db.run(
                "INSERT INTO assignments (student_id, area_id, week, year) VALUES (?, ?, ?, ?)",
                shuffledStudents[i].id, areas[i].id, weekNum, year
            );
        }
        await db.run(
            "INSERT OR REPLACE INTO last_update (id, timestamp) VALUES (1, ?)",
            now.toISOString()
        );
        console.log("Assignments updated successfully.");
    }
}

async function startServer() {
    const db = await initDB();

    cron.schedule("0 8 * * 1", () => assignCleaningAreas(db), { timezone: "Asia/Seoul" });

    // 강제로 배정 실행
    await db.run("DELETE FROM last_update");
    await assignCleaningAreas(db);

    app.get("/", (req, res) => {
        res.send("청소 구역 배정 서버가 실행 중입니다. /schedule 경로를 통해 데이터를 확인하세요.");
    });

    app.get("/schedule", async (req, res) => {
        const assignments = await db.all(`
            SELECT s.name as student, a.name as area 
            FROM assignments 
            JOIN students s ON s.id = assignments.student_id 
            JOIN areas a ON a.id = assignments.area_id
        `);
        console.log("Assignments sent to client:", assignments);
        res.json(assignments);
    });

    app.post("/students", async (req, res) => {
        const { students } = req.body;
        if (students.length === 6) {
            await db.run("DELETE FROM students");
            for (let i = 0; i < students.length; i++) {
                await db.run("INSERT INTO students (id, name) VALUES (?, ?)", i + 1, students[i]);
            }
            res.sendStatus(200);
        } else {
            res.status(400).send("학생은 정확히 6명이어야 합니다.");
        }
    });

    app.post("/areas", async (req, res) => {
        const { areas } = req.body;
        if (areas.length === 6) {
            await db.run("DELETE FROM areas");
            for (let i = 0; i < areas.length; i++) {
                await db.run("INSERT INTO areas (id, name) VALUES (?, ?)", i + 1, areas[i]);
            }
            res.sendStatus(200);
        } else {
            res.status(400).send("청소 구역은 정확히 6개여야 합니다.");
        }
    });

    app.listen(3000, () => console.log("서버가 3000번 포트에서 실행 중입니다."));
}

startServer();
